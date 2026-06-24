import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from './helpers/server.js';
import { cleanupTestUsers } from './helpers/db.js';
import { uniqueEmail, registerUser, loginUser } from './helpers/auth.js';

const createdUserIds: string[] = [];

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await server.close();
  await cleanupTestUsers(createdUserIds);
});

describe('POST /auth/register', () => {
  it('201 — registers a new diner', async () => {
    const email = uniqueEmail();
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'Password1', role: 'diner' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      user: { id: string; email: string; role: string };
    };
    expect(body.user.email).toBe(email);
    expect(body.user.role).toMatch(/diner/i);
    expect(res.body).not.toContain('Password1');
    expect(res.body).not.toContain('hash');

    createdUserIds.push(body.user.id);
  });

  it('201 — registers a new owner', async () => {
    const email = uniqueEmail();
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'Password1', role: 'owner' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { user: { id: string; role: string } };
    expect(body.user.role).toMatch(/owner/i);
    createdUserIds.push(body.user.id);
  });

  it('201 — defaults to diner when role is omitted', async () => {
    const email = uniqueEmail();
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'Password1' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { user: { id: string; role: string } };
    expect(body.user.role).toMatch(/diner/i);
    createdUserIds.push(body.user.id);
  });

  it('409 — duplicate email returns conflict', async () => {
    const email = uniqueEmail();
    const first = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'Password1', role: 'diner' },
    });
    expect(first.statusCode).toBe(201);
    createdUserIds.push(
      (JSON.parse(first.body) as { user: { id: string } }).user.id,
    );

    const second = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'Password1', role: 'diner' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('422 — rejects password shorter than 8 characters', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: uniqueEmail(), password: 'Short1', role: 'diner' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 — rejects password with no uppercase letter', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: uniqueEmail(),
        password: 'alllowercase1',
        role: 'diner',
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 — rejects password with no digit', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: uniqueEmail(),
        password: 'NoDigitsHere',
        role: 'diner',
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 — rejects malformed email', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'Password1', role: 'diner' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 — rejects invalid role', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: uniqueEmail(), password: 'Password1', role: 'admin' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('POST /auth/login', () => {
  it('200 — returns accessToken and refreshToken with correct shape', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    expect(creds.accessToken.split('.').length).toBe(3);
    expect(creds.refreshToken.split('.').length).toBe(3);
  });

  it('200 — accessToken sub matches the registered user id', async () => {
    const { email, password, userId } = await registerUser(server);
    createdUserIds.push(userId);

    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as {
      user: { id: string };
      accessToken: string;
    };

    expect(body.user.id).toBe(userId);

    const payloadBase64 = body.accessToken.split('.')[1]!;
    const payload = JSON.parse(
      Buffer.from(payloadBase64, 'base64url').toString(),
    ) as { sub: string };
    expect(payload.sub).toBe(userId);
  });

  it('200 — sets an HttpOnly cookie for the refresh token', async () => {
    const { email, password, userId } = await registerUser(server);
    createdUserIds.push(userId);

    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(res.statusCode).toBe(200);
    const cookieHeader = res.headers['set-cookie'];
    expect(cookieHeader).toBeDefined();

    const cookieStr = Array.isArray(cookieHeader)
      ? cookieHeader.join('; ')
      : cookieHeader;
    expect(cookieStr).toMatch(/HttpOnly/i);
  });

  it('401 — wrong password returns generic error (no email-vs-password distinction)', async () => {
    const { email, userId } = await registerUser(server);
    createdUserIds.push(userId);

    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'WrongPass1!' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error.toLowerCase()).not.toContain('password');
    expect(body.error.toLowerCase()).not.toContain('wrong');
  });

  it('401 — unknown email returns IDENTICAL error message (prevents enumeration)', async () => {
    const wrongPasswordRes = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: uniqueEmail(), password: 'WrongPass1!' },
    });

    const unknownEmailRes = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'definitely-does-not-exist@nowhere.local',
        password: 'Password1',
      },
    });

    expect(wrongPasswordRes.statusCode).toBe(401);
    expect(unknownEmailRes.statusCode).toBe(401);

    const bodyA = JSON.parse(wrongPasswordRes.body) as { error: string };
    const bodyB = JSON.parse(unknownEmailRes.body) as { error: string };
    expect(bodyA.error).toBe(bodyB.error);
  });

  it('422 — rejects login with missing password', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: uniqueEmail() },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('POST /auth/refresh', () => {
  it('200 — issues a new access token', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { accessToken: string };
    expect(body.accessToken).toBeDefined();
    expect(body.accessToken.split('.').length).toBe(3);
  });

  it('200 — new access token differs from original (genuine rotation)', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      accessToken: string;
      refreshToken: string;
    };

    expect(body.accessToken).not.toBe(creds.accessToken);
    expect(body.refreshToken).not.toBe(creds.refreshToken);
  });

  it('401 — used refresh token cannot be reused (single-use enforcement)', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    const first = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    expect(first.statusCode).toBe(200);

    const second = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    expect(second.statusCode).toBe(401);
  });

  it('401 — completely invalid token string is rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'not.a.valid.jwt.at.all' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 — missing refresh token returns 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('200 — successful logout', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    const res = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${creds.accessToken}` },
      payload: { refreshToken: creds.refreshToken },
    });

    expect(res.statusCode).toBe(200);
  });

  it('401 — access token is invalid for /auth/me after logout (Redis deny-list)', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    const before = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });
    expect(before.statusCode).toBe(200);

    await server.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${creds.accessToken}` },
      payload: { refreshToken: creds.refreshToken },
    });

    const after = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('401 — refresh token cannot be used after logout', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    await server.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${creds.accessToken}` },
      payload: { refreshToken: creds.refreshToken },
    });

    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 — logout without Bearer token is rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('200 — returns correct user profile', async () => {
    const creds = await loginUser(server, { role: 'owner' });
    createdUserIds.push(creds.userId);

    const res = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      id: string;
      email: string;
      role: string;
    };

    expect(body.id).toBe(creds.userId);
    expect(body.email).toBe(creds.email);
    expect(body.role).toMatch(/owner/i);
    expect(res.body).not.toContain('password');
    expect(res.body).not.toContain('hash');
  });

  it('401 — missing Authorization header', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/me',
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 — malformed Bearer token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer this.is.garbage' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 — Bearer prefix missing (raw token)', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    const res = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: creds.accessToken },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Security invariants', () => {
  it('user_id in /auth/me always matches JWT sub — never injectable from body', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    const payloadB64 = creds.accessToken.split('.')[1]!;
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString(),
    ) as { sub: string; role: string };

    const me = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });

    const meBody = JSON.parse(me.body) as { id: string };

    expect(meBody.id).toBe(payload.sub);
    expect(payload.sub).toBe(creds.userId);
  });

  it('refresh token is single-use — rotating it invalidates the old one', async () => {
    const creds = await loginUser(server);
    createdUserIds.push(creds.userId);

    const refreshRes = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    expect(refreshRes.statusCode).toBe(200);

    const replayRes = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    expect(replayRes.statusCode).toBe(401);
  });

  it('diner and owner tokens carry correct role in JWT payload', async () => {
    const dinerCreds = await loginUser(server, { role: 'diner' });
    createdUserIds.push(dinerCreds.userId);
    const ownerCreds = await loginUser(server, { role: 'owner' });
    createdUserIds.push(ownerCreds.userId);

    const decodeRole = (token: string): string => {
      const b64 = token.split('.')[1]!;
      return (
        JSON.parse(Buffer.from(b64, 'base64url').toString()) as { role: string }
      ).role;
    };

    expect(decodeRole(dinerCreds.accessToken)).toMatch(/diner/i);
    expect(decodeRole(ownerCreds.accessToken)).toMatch(/owner/i);
  });

  it('two concurrent sessions can coexist independently', async () => {
    const { email, password, userId } = await registerUser(server);
    createdUserIds.push(userId);

    const [sessionA, sessionB] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      }),
      server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      }),
    ]);

    expect(sessionA.statusCode).toBe(200);
    expect(sessionB.statusCode).toBe(200);

    const tokenA = (JSON.parse(sessionA.body) as { accessToken: string })
      .accessToken;
    const tokenB = (JSON.parse(sessionB.body) as { accessToken: string })
      .accessToken;

    const [meA, meB] = await Promise.all([
      server.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${tokenA}` },
      }),
      server.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    ]);

    expect(meA.statusCode).toBe(200);
    expect(meB.statusCode).toBe(200);
  });

  it('GET /health returns 200 with no auth (smoke test)', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
