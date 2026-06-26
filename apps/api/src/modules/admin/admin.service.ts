import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@restaurant/db';
import { getRedisClient } from '../../lib/redis.js';
import {
  signAccessToken,
  signRefreshToken,
} from '../../lib/jwt.js';
import {
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} from '../../errors/index.js';
import type {
  AdminLoginInput,
  AdminUpdatePlanInput,
  AdminPaginationInput,
} from './admin.schema.js';

const TOTP_ISSUER = 'Restaurant Booking Admin';
const TOTP_PENDING_TTL = 600;

// Allow ±1 step (30s) for phone/server clock drift
authenticator.options = { ...authenticator.options, window: 1 };

export async function adminLogin(
  input: AdminLoginInput,
  meta: { ip: string },
) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      email: true,
      password: true,
      role: true,
      totpSecret: true,
      deletedAt: true,
    },
  });

  const DUMMY =
    '$2b$12$invalidhashfortimingnormalization000000000000000000000000';
  const passwordMatch = await bcrypt.compare(
    input.password,
    user?.password ?? DUMMY,
  );

  if (!user || !passwordMatch || user.deletedAt) {
    throw new UnauthorizedError('Invalid credentials');
  }

  if (user.role !== 'ADMIN') {
    throw new UnauthorizedError('Invalid credentials');
  }

  const redis = getRedisClient();

  if (!user.totpSecret) {
    const secret = authenticator.generateSecret(20);
    const otpauthUrl = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    const pendingToken = randomUUID();

    await redis.set(
      `admin:totp:setup:${pendingToken}`,
      JSON.stringify({ userId: user.id, secret }),
      'EX',
      TOTP_PENDING_TTL,
    );

    return {
      requiresTOTPSetup: true as const,
      qrCodeDataUrl,
      pendingToken,
      totpSecret: secret,
    };
  }

  if (!input.totpToken) {
    return { requiresTOTP: true as const };
  }

  const isValid = authenticator.verify({
    token: input.totpToken,
    secret: user.totpSecret,
  });
  if (!isValid) {
    await prisma.auditLog
      .create({
        data: {
          actorId: user.id,
          action: 'ADMIN_LOGIN_TOTP_FAILED',
          entityType: 'User',
          entityId: user.id,
          ipAddress: meta.ip,
        },
      })
      .catch(() => {});
    throw new UnauthorizedError('Invalid TOTP code');
  }

  return issueAdminTokens(user.id, user.email, meta.ip);
}

export async function adminTotpSetup(
  input: { pendingToken: string; totpToken: string },
  meta: { ip: string },
) {
  const redis = getRedisClient();
  const raw = await redis.get(`admin:totp:setup:${input.pendingToken}`);

  if (!raw) {
    throw new UnauthorizedError('Setup session expired — please log in again');
  }

  const { userId, secret } = JSON.parse(raw) as {
    userId: string;
    secret: string;
  };

  const isValid = authenticator.verify({
    token: input.totpToken,
    secret,
  });
  if (!isValid) throw new UnauthorizedError('Invalid TOTP code');

  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: secret },
  });

  await redis.del(`admin:totp:setup:${input.pendingToken}`);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true },
  });

  return issueAdminTokens(user.id, user.email, meta.ip);
}

async function issueAdminTokens(userId: string, email: string, ip: string) {
  const accessResult = signAccessToken({ sub: userId, role: 'admin' });
  const refreshResult = signRefreshToken({ sub: userId });

  const tokenHash = createHash('sha256')
    .update(refreshResult.token)
    .digest('hex');

  await prisma.refreshToken.create({
    data: {
      jti: refreshResult.jti,
      tokenHash,
      userId,
      expiresAt: new Date(refreshResult.expiresAt * 1000),
    },
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: userId,
        action: 'ADMIN_LOGIN_SUCCESS',
        entityType: 'User',
        entityId: userId,
        ipAddress: ip,
      },
    })
    .catch(() => {});

  return {
    accessToken: accessResult.token,
    accessTokenExpiresAt: accessResult.expiresAt,
    refreshToken: refreshResult.token,
    refreshTokenExpiresAt: refreshResult.expiresAt,
    user: { id: userId, email, role: 'admin' as const },
  };
}

export async function getStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalUsers,
    totalOwners,
    totalDiners,
    totalRestaurants,
    totalBookings,
    bookingsThisMonth,
    starterCount,
    proCount,
    premiumCount,
  ] = await prisma.$transaction([
    prisma.user.count({ where: { role: 'DINER', deletedAt: null } }),
    prisma.user.count({ where: { role: 'OWNER', deletedAt: null } }),
    prisma.user.count({ where: { role: 'DINER', deletedAt: null } }),
    prisma.restaurant.count({ where: { deletedAt: null } }),
    prisma.booking.count(),
    prisma.booking.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.subscription.count({ where: { plan: 'STARTER' } }),
    prisma.subscription.count({ where: { plan: 'PRO' } }),
    prisma.subscription.count({ where: { plan: 'PREMIUM' } }),
  ]);

  return {
    users: {
      total: totalUsers + totalOwners,
      diners: totalDiners,
      owners: totalOwners,
    },
    restaurants: { total: totalRestaurants },
    bookings: { total: totalBookings, thisMonth: bookingsThisMonth },
    subscriptions: {
      starter: starterCount,
      pro: proCount,
      premium: premiumCount,
    },
  };
}

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  deletedAt: true,
  subscription: {
    select: { plan: true, status: true, currentPeriodEnd: true },
  },
  _count: {
    select: { restaurants: true },
  },
} as const;

export async function listUsers(input: AdminPaginationInput) {
  const where = input.q
    ? { email: { contains: input.q, mode: 'insensitive' as const } }
    : {};

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, page: input.page, limit: input.limit };
}

export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...USER_SELECT,
      restaurants: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          city: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!user) throw new NotFoundError('User not found');
  return user;
}

export async function banUser(userId: string, adminId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) throw new NotFoundError('User not found');
  if (user.role === 'ADMIN') {
    throw new ForbiddenError('Cannot ban another admin');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'ADMIN_USER_BANNED',
      entityType: 'User',
      entityId: userId,
    },
  });
}

export async function unbanUser(userId: string, adminId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: null },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'ADMIN_USER_UNBANNED',
      entityType: 'User',
      entityId: userId,
    },
  });
}

export async function updateUserPlan(
  userId: string,
  input: AdminUpdatePlanInput,
  adminId: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) throw new NotFoundError('User not found');
  if (user.role !== 'OWNER') {
    throw new ForbiddenError('Plans only apply to owners');
  }

  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, plan: input.plan },
    update: { plan: input.plan },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'ADMIN_PLAN_CHANGED',
      entityType: 'User',
      entityId: userId,
      metadata: { plan: input.plan },
    },
  });
}

export async function listRestaurants(input: AdminPaginationInput) {
  const where = input.q
    ? { name: { contains: input.q, mode: 'insensitive' as const } }
    : {};

  const [restaurants, total] = await prisma.$transaction([
    prisma.restaurant.findMany({
      where,
      select: {
        id: true,
        name: true,
        city: true,
        cuisine: true,
        isActive: true,
        deletedAt: true,
        createdAt: true,
        owner: { select: { id: true, email: true } },
        _count: { select: { bookings: true, slots: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.restaurant.count({ where }),
  ]);

  return { restaurants, total, page: input.page, limit: input.limit };
}

export async function listBookings(input: AdminPaginationInput) {
  const [bookings, total] = await prisma.$transaction([
    prisma.booking.findMany({
      select: {
        id: true,
        partySize: true,
        status: true,
        createdAt: true,
        restaurant: { select: { id: true, name: true } },
        diner: { select: { id: true, email: true } },
        slot: { select: { startsAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.booking.count(),
  ]);

  return { bookings, total, page: input.page, limit: input.limit };
}

export async function listAuditLogs(input: AdminPaginationInput) {
  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.auditLog.count(),
  ]);

  return { logs, total, page: input.page, limit: input.limit };
}

export async function listSubscriptions(input: AdminPaginationInput) {
  const [subs, total] = await prisma.$transaction([
    prisma.subscription.findMany({
      include: { user: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.subscription.count(),
  ]);

  return { subscriptions: subs, total, page: input.page, limit: input.limit };
}
