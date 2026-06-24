import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

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
  opts: { email?: string; password?: string; role?: 'diner' | 'owner' } = {},
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
  opts: { email?: string; password?: string; role?: 'diner' | 'owner' } = {},
): Promise<TestCredentials> {
  const { email, password, userId } = await registerUser(server, opts);

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
    refreshToken: string;
  };

  return {
    email,
    password,
    userId,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}
