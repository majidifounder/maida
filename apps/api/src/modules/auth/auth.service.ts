import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma, Plan, SubscriptionStatus, type Prisma } from '@restaurant/db';
import { ensureRedisConnected } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../lib/jwt.js';
import { UnauthorizedError, ConflictError } from '../../errors/index.js';
import { env } from '../../env.js';
import { sendPasswordReset } from '../../services/email.service.js';
import type { RegisterInput, LoginInput } from './auth.schema.js';

// --- Account lockout constants ---
const ACCOUNT_LOCKOUT_ATTEMPTS = 10;
const ACCOUNT_LOCKOUT_WINDOW_SEC = 900;   // 15 minutes
const ACCOUNT_LOCKOUT_DURATION_SEC = 1800; // 30 minutes

// --- Lazy-computed dummy bcrypt hash for constant-time login ---
let _dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  if (!_dummyHash) {
    _dummyHash = await bcrypt.hash('__timing_safety_dummy__', env.BCRYPT_ROUNDS);
  }
  return _dummyHash;
}

async function recordFailedLogin(userId: string): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const redis = await ensureRedisConnected(1_500);
    const key = `login:fail:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, ACCOUNT_LOCKOUT_WINDOW_SEC);
    if (count >= ACCOUNT_LOCKOUT_ATTEMPTS) {
      await redis.set(`login:locked:${userId}`, '1', 'EX', ACCOUNT_LOCKOUT_DURATION_SEC);
      logger.warn({ userId, count }, '[Auth] Account locked after failed logins');
    }
  } catch {
    // Non-fatal
  }
}

async function clearFailedLogins(userId: string): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const redis = await ensureRedisConnected(1_500);
    await redis.del(`login:fail:${userId}`);
  } catch {
    // Non-fatal
  }
}

async function isAccountLocked(userId: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'test') return false;
  try {
    const redis = await ensureRedisConnected(1_500);
    const locked = await redis.get(`login:locked:${userId}`);
    return locked !== null;
  } catch {
    return false;
  }
}

const RESET_TOKEN_TTL = 60 * 60;
const RESET_KEY = (token: string) => `pwd_reset:${token}`;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function registerUser(
  input: RegisterInput,
  meta: { ip: string },
) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw new ConflictError('Email already registered');
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      password: passwordHash,
      role: input.role.toUpperCase() as 'DINER' | 'OWNER',
      ...(input.role === 'owner' && {
        subscription: {
          create: {
            status: SubscriptionStatus.TRIALING,
            plan: Plan.STARTER,
            trialStartedAt: new Date(),
          },
        },
      }),
    },
    select: { id: true, email: true, role: true, createdAt: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ip,
    },
  });

  return { user };
}

export async function loginUser(
  input: LoginInput,
  meta: { ip: string; userAgent?: string },
) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, password: true, role: true, createdAt: true, deletedAt: true },
  });

  // Check account lockout before bcrypt (only for existing non-deleted users)
  if (user && !user.deletedAt && await isAccountLocked(user.id)) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // ALWAYS run bcrypt — even when user not found — to prevent timing-based enumeration
  const hashToCompare = user?.password ?? await getDummyHash();
  const passwordMatch = await bcrypt.compare(input.password, hashToCompare);

  if (!user || !passwordMatch || user.deletedAt) {
    // Record failure only for real, non-deleted accounts
    if (user && !user.deletedAt) {
      await recordFailedLogin(user.id);
    }

    await prisma.auditLog
      .create({
        data: {
          actorId: user?.id ?? null,
          action: 'LOGIN_FAILED',
          entityType: 'User',
          entityId: user?.id ?? null,
          ipAddress: meta.ip,
          metadata: { reason: !user ? 'unknown_email' : 'wrong_password' },
        },
      })
      .catch(() => {});

    throw new UnauthorizedError('Invalid email or password');
  }

  // Successful login — clear failure counter
  await clearFailedLogins(user.id);

  const tokenPair = await issueTokenPair(user.id);

  await prisma.auditLog
    .create({
      data: {
        actorId: user.id,
        action: 'LOGIN_SUCCESS',
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ip,
      },
    })
    .catch(() => {});

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    },
    ...tokenPair,
  };
}

export async function refreshTokens(
  rawRefreshToken: string,
  _meta: { ip: string },
) {
  try {
    verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const tokenHash = hashToken(rawRefreshToken);

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.refreshToken.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        jti: true,
        expiresAt: true,
        revokedAt: true,
        userId: true,
      },
    });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token expired or revoked');
    }

    const account = await tx.user.findUnique({
      where: { id: existing.userId },
      select: { deletedAt: true },
    });
    if (!account || account.deletedAt) {
      throw new UnauthorizedError('Account has been deactivated');
    }

    // Race-safe rotation: two concurrent refreshes with the same cookie (multiple
    // tabs, or a mobile client retrying over a flaky network) must not both
    // proceed. The first deletes the row; the loser's deleteMany matches nothing
    // and gets a clean 401 instead of a Prisma P2025 → 500 and a wrecked session.
    const rotated = await tx.refreshToken.deleteMany({
      where: { id: existing.id },
    });
    if (rotated.count === 0) {
      throw new UnauthorizedError('Refresh token already used');
    }

    const role = await getUserRole(existing.userId, tx);
    const accessResult = signAccessToken({ sub: existing.userId, role });
    const refreshResult = signRefreshToken({ sub: existing.userId });

    await tx.refreshToken.create({
      data: {
        jti: refreshResult.jti,
        tokenHash: hashToken(refreshResult.token),
        userId: existing.userId,
        expiresAt: new Date(refreshResult.expiresAt * 1000),
      },
    });

    return {
      accessToken: accessResult.token,
      accessTokenJti: accessResult.jti,
      accessTokenExpiresAt: accessResult.expiresAt,
      refreshToken: refreshResult.token,
      refreshTokenExpiresAt: refreshResult.expiresAt,
      userId: existing.userId,
    };
  });

  return result;
}

export async function logoutUser(
  _accessToken: string,
  rawRefreshToken: string | undefined,
  meta: { userId: string; jti: string; exp: number; ip: string },
) {
  try {
    const redis = await ensureRedisConnected(1_500);
    const remainingSeconds = Math.max(
      0,
      meta.exp - Math.floor(Date.now() / 1000),
    );
    if (remainingSeconds > 0) {
      await redis.set(`deny:${meta.jti}`, '1', 'EX', remainingSeconds);
    }
  } catch {
    // Non-fatal — refresh token revoke below still invalidates the session
  }

  if (rawRefreshToken) {
    const tokenHash = hashToken(rawRefreshToken);
    await prisma.refreshToken
      .updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => {});
  }

  await prisma.auditLog
    .create({
      data: {
        actorId: meta.userId,
        action: 'LOGOUT',
        entityType: 'User',
        entityId: meta.userId,
        ipAddress: meta.ip,
      },
    })
    .catch(() => {});
}

async function issueTokenPair(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, role: true },
  });

  const roleStr = user.role.toLowerCase() as 'diner' | 'owner';
  const accessResult = signAccessToken({ sub: userId, role: roleStr });
  const refreshResult = signRefreshToken({ sub: userId });

  await prisma.refreshToken.create({
    data: {
      jti: refreshResult.jti,
      tokenHash: hashToken(refreshResult.token),
      userId,
      expiresAt: new Date(refreshResult.expiresAt * 1000),
    },
  });

  return {
    accessToken: accessResult.token,
    accessTokenExpiresAt: accessResult.expiresAt,
    accessTokenJti: accessResult.jti,
    refreshToken: refreshResult.token,
    refreshTokenExpiresAt: refreshResult.expiresAt,
  };
}

async function getUserRole(
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<'diner' | 'owner'> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true },
  });
  return user.role.toLowerCase() as 'diner' | 'owner';
}

export async function forgotPassword(
  input: { email: string },
  meta: { ip: string },
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, deletedAt: true, role: true },
  });

  if (!user || user.deletedAt || user.role === 'ADMIN') {
    // Consume time equivalent to token generation + email send to prevent
    // "email exists" enumeration via response-time differences
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 50));
    return;
  }

  const appBaseUrl =
    user.role === 'OWNER' ? env.DASHBOARD_URL : env.WEB_URL;

  const token = randomUUID();
  const redis = await ensureRedisConnected(1_500);
  const resetUrl = `${appBaseUrl}/reset-password?token=${token}`;

  await redis.set(RESET_KEY(token), user.id, 'EX', RESET_TOKEN_TTL);

  try {
    await sendPasswordReset({ toEmail: input.email, resetUrl });
  } catch (err) {
    logger.error({ err }, '[Auth] password reset email failed (non-fatal)');
  }

  await prisma.auditLog
    .create({
      data: {
        actorId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ip,
      },
    })
    .catch(() => {});
}

export async function resetPassword(
  input: { token: string; password: string },
  meta: { ip: string },
): Promise<void> {
  const redis = await ensureRedisConnected(1_500);
  const userId = await redis.get(RESET_KEY(input.token));

  if (!userId) {
    throw new UnauthorizedError(
      'This reset link is invalid or has already been used',
    );
  }

  await redis.del(RESET_KEY(input.token));

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    throw new UnauthorizedError('Account not found');
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { password: passwordHash },
    });

    await tx.refreshToken.deleteMany({ where: { userId } });

    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'PASSWORD_RESET_COMPLETED',
        entityType: 'User',
        entityId: userId,
        ipAddress: meta.ip,
      },
    });
  });
}
