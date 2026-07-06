import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { prisma } from '@restaurant/db';
import { apiRequest } from './client.js';
import type { E2eContext } from './context.js';
import { uniqueEmail } from './context.js';

export interface Session {
  email: string;
  password: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerAndLogin(
  ctx: E2eContext,
  role: 'diner' | 'owner',
  opts: { email?: string; password?: string } = {},
): Promise<Session> {
  const email = opts.email ?? uniqueEmail(role);
  const password = opts.password ?? 'E2ePass1!';

  const reg = await apiRequest<{ user: { id: string } }>(ctx, 'POST', '/auth/register', {
    body: { email, password, role },
  });
  if (reg.status !== 201) {
    throw new Error(`Register failed (${reg.status}): ${JSON.stringify(reg.body)}`);
  }

  const login = await apiRequest<{ accessToken: string; user: { id: string } }>(
    ctx,
    'POST',
    '/auth/login',
    { body: { email, password } },
  );
  if (login.status !== 200) {
    throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.body)}`);
  }

  ctx.trackUser(login.body.user.id);

  return {
    email,
    password,
    userId: login.body.user.id,
    accessToken: login.body.accessToken,
    refreshToken: login.cookies.find((c) => c.startsWith('__Host-refresh='))
      ?.split(';')[0]
      ?.replace('__Host-refresh=', '') ?? '',
  };
}

export async function setOwnerPlan(
  userId: string,
  plan: 'STARTER' | 'PRO' | 'PREMIUM',
): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, plan, status: 'ACTIVE' },
    update: { plan, status: 'ACTIVE' },
  });
}

export async function createAdminSession(ctx: E2eContext): Promise<Session & { totpSecret: string }> {
  const email = uniqueEmail('admin');
  const password = 'E2eAdmin1!';
  const totpSecret = authenticator.generateSecret(20);
  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hash,
      role: 'ADMIN',
      totpSecret,
    },
  });
  ctx.trackUser(user.id);

  const totpToken = authenticator.generate(totpSecret);
  const login = await apiRequest<{
    accessToken: string;
    user: { id: string };
  }>(ctx, 'POST', '/admin/auth/login', {
    body: { email, password, totpToken },
    skipLoadTestHeader: true,
  });

  if (login.status !== 200 || !login.body.accessToken) {
    throw new Error(`Admin login failed (${login.status}): ${JSON.stringify(login.body)}`);
  }

  return {
    email,
    password,
    userId: user.id,
    accessToken: login.body.accessToken,
    refreshToken: '',
    totpSecret,
  };
}
