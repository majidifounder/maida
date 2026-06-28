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
  return { email, password, userId: body.user.id };
}

export async function loginUser(
  server: FastifyInstance,
  opts: {
    email?: string;
    password?: string;
    role?: 'diner' | 'owner';
    /** Owner subscription plan; 'none' skips subscription row (defaults to virtual STARTER). */
    subscriptionPlan?: 'STARTER' | 'PRO' | 'PREMIUM' | 'none';
  } = {},
): Promise<TestCredentials> {
  const { email, password, userId } = await registerUser(server, opts);

  if (opts.role === 'owner') {
    const plan = opts.subscriptionPlan ?? 'PREMIUM';
    if (plan !== 'none') {
      await prisma.subscription.upsert({
        where: { userId },
        create: { userId, plan, status: 'ACTIVE' },
        update: { plan, status: 'ACTIVE' },
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

  // Refresh token is in the HttpOnly __Host-refresh cookie — extract from Set-Cookie header.
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
