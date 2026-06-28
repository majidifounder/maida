import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma, type Prisma } from '@restaurant/db';
import { getRedisClient } from '../../lib/redis.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../lib/jwt.js';
import { UnauthorizedError, ConflictError } from '../../errors/index.js';
import { env } from '../../env.js';
import { sendPasswordReset } from '../../services/email.service.js';
import type { RegisterInput, LoginInput } from './auth.schema.js';

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

  const DUMMY_HASH =
    '$2b$12$invalidhashfortimingnormalization000000000000000000000000';
  const passwordMatch = await bcrypt.compare(
    input.password,
    user?.password ?? DUMMY_HASH,
  );

  if (!user || !passwordMatch || user.deletedAt) {
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

    throw new UnauthorizedError('Invalid credentials');
  }

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

    await tx.refreshToken.delete({ where: { id: existing.id } });

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
  const redis = getRedisClient();

  const remainingSeconds = Math.max(
    0,
    meta.exp - Math.floor(Date.now() / 1000),
  );
  if (remainingSeconds > 0) {
    await redis.set(`deny:${meta.jti}`, '1', 'EX', remainingSeconds);
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
    return;
  }

  const appBaseUrl =
    user.role === 'OWNER' ? env.DASHBOARD_URL : env.WEB_URL;

  const token = randomUUID();
  const redis = getRedisClient();
  const resetUrl = `${appBaseUrl}/reset-password?token=${token}`;

  await redis.set(RESET_KEY(token), user.id, 'EX', RESET_TOKEN_TTL);

  try {
    await sendPasswordReset({ toEmail: input.email, resetUrl });
  } catch (err) {
    console.error(
      '[Auth] password reset email failed (non-fatal):',
      (err as Error).message,
    );
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
  const redis = getRedisClient();
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
