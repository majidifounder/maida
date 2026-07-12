import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@restaurant/db';

export interface TestCredentials {
  email: string;
  password: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export function uniqueEmail(): string {
  return `test-${randomUUID()}@integration-test.local`;
}

export async function registerUser(
  server: FastifyInstance,
  opts: {
    email?: string;
    password?: string;
    role?: 'diner' | 'owner';
    /** Fixtures are verified by default — set true to test the unverified gate. */
    unverified?: boolean;
  } = {},
): Promise<{ email: string; password: string; userId: string }> {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? 'TestPass1!';
  const role = opts.role ?? 'diner';

  const res = await server.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, role },
  });

  if (res.statusCode !== 201) {
    throw new Error(`Register failed: ${res.statusCode} ${res.body}`);
  }

  const body = JSON.parse(res.body) as { user: { id: string } };

  // Registration creates UNVERIFIED users; almost every test needs an
  // established (verified) account, so verify by default.
  if (!opts.unverified) {
    await prisma.user.update({
      where: { id: body.user.id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  return { email, password, userId: body.user.id };
}

export async function loginUser(
  server: FastifyInstance,
  opts: {
    email?: string;
    password?: string;
    role?: 'diner' | 'owner';
    /** Fixtures are verified by default — set true to test the unverified gate. */
    unverified?: boolean;
    /** Owner subscription override; 'none' skips row (lazy trial on first access). */
    subscriptionPlan?:
      | 'STARTER'
      | 'PRO'
      | 'PREMIUM'
      | 'TRIAL'
      | 'TRIAL_EXPIRED'
      | 'EXPIRED'
      | 'none';
  } = {},
): Promise<TestCredentials> {
  const { email, password, userId } = await registerUser(server, opts);

  if (opts.role === 'owner') {
    const plan = opts.subscriptionPlan ?? 'PREMIUM';

    if (plan === 'none') {
      await prisma.subscription.deleteMany({ where: { userId } });
    } else if (plan === 'EXPIRED') {
      // A paid subscription that lapsed: the webhook forces plan → STARTER and
      // status → EXPIRED. Operability then falls back to the free Starter tier.
      await prisma.subscription.upsert({
        where: { userId },
        create: { userId, plan: 'STARTER', status: 'EXPIRED' },
        update: { plan: 'STARTER', status: 'EXPIRED', trialStartedAt: null },
      });
    } else if (plan === 'TRIAL' || plan === 'TRIAL_EXPIRED') {
      const trialStartedAt =
        plan === 'TRIAL_EXPIRED'
          ? new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
          : new Date();
      await prisma.subscription.upsert({
        where: { userId },
        create: {
          userId,
          plan: 'STARTER',
          status: 'TRIALING',
          trialStartedAt,
        },
        update: {
          plan: 'STARTER',
          status: 'TRIALING',
          trialStartedAt,
          lemonSqueezyId: null,
        },
      });
    } else {
      await prisma.subscription.upsert({
        where: { userId },
        create: { userId, plan, status: 'ACTIVE' },
        update: { plan, status: 'ACTIVE', trialStartedAt: null },
      });
    }
  }

  const res = await server.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });

  if (res.statusCode !== 200) {
    throw new Error(`Login failed: ${res.statusCode} ${res.body}`);
  }

  const body = JSON.parse(res.body) as {
    accessToken: string;
  };

  const setCookieHeader = res.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookieHeader)
    ? setCookieHeader.find((c) => c.startsWith('__Host-refresh='))
    : setCookieHeader?.startsWith('__Host-refresh=')
      ? setCookieHeader
      : undefined;
  const refreshToken =
    cookieStr?.split(';')[0]?.replace('__Host-refresh=', '') ?? '';

  return {
    email,
    password,
    userId,
    accessToken: body.accessToken,
    refreshToken,
  };
}
