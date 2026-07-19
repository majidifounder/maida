/**
 * INVARIANT GUARDS · Auth & Session
 *
 * Regression guards for verified invariants (docs/architecture/INVARIANTS.md):
 *   INV-3  token-type confusion rejected; algorithms pinned to RS256
 *   INV-4  refresh rotation is atomic single-use (incl. under concurrency)
 *   —      role separation: exact-match requireRole (docs/architecture/01-system-map.md §4)
 *
 * Skipped guards document DESIRED invariants that current code does not hold —
 * they are mapped to backlog findings and must stay skipped until the finding
 * is fixed (never delete them; un-skip in the fixing PR).
 *   M-3/CI-H1  password reset does not revoke live access tokens
 *   L-5/CI-H2  no refresh-token reuse-family detection
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from '../helpers/server.js';
import { loginUser, type TestCredentials } from '../helpers/auth.js';
import { cleanupTestUsers } from '../helpers/db.js';
import { env } from '../../env.js';

let server: FastifyInstance;
const userIds: string[] = [];

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await cleanupTestUsers(userIds);
  await server.close();
});

async function freshLogin(role: 'diner' | 'owner' = 'diner'): Promise<TestCredentials> {
  const creds = await loginUser(server, { role });
  userIds.push(creds.userId);
  return creds;
}

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

describe('INV-3 · token-type confusion is rejected in both directions', () => {
  it('a refresh token is NOT accepted as a bearer access token', async () => {
    const creds = await freshLogin();
    const res = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${creds.refreshToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('an access token is NOT accepted as a refresh token', async () => {
    const creds = await freshLogin();
    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.accessToken },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('INV-3 · algorithm pinning (RS256 only)', () => {
  it('rejects an unsigned alg:none token', async () => {
    const creds = await freshLogin();
    const now = Math.floor(Date.now() / 1000);
    const noneToken =
      b64url({ alg: 'none', typ: 'JWT' }) +
      '.' +
      b64url({ sub: creds.userId, role: 'diner', jti: randomUUID(), iat: now, exp: now + 900 }) +
      '.';
    const res = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${noneToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an HS256 token forged with the PUBLIC key as HMAC secret', async () => {
    // Classic RS/HS confusion attack: if verification accepted HS256, the
    // public key (which is public) would become a valid signing secret.
    const creds = await freshLogin();
    const now = Math.floor(Date.now() / 1000);
    const forged = jwt.sign(
      { sub: creds.userId, role: 'owner', jti: randomUUID(), iat: now, exp: now + 900 },
      env.JWT_PUBLIC_KEY,
      { algorithm: 'HS256', noTimestamp: true },
    );
    const res = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('INV-4 · refresh rotation is atomic single-use', () => {
  it('sequential: a used refresh token is dead on second use', async () => {
    const creds = await freshLogin();
    const first = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    expect(first.statusCode).toBe(200);

    const replay = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('concurrent: two simultaneous refreshes with the same token → exactly one 200', async () => {
    // Guards the race half of INV-4 (auth.service.ts:311-316 deleteMany+count)
    // — the gap named GT-2 in docs/architecture/07-testing-review.md.
    const creds = await freshLogin();
    const [a, b] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: creds.refreshToken },
      }),
      server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: creds.refreshToken },
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 401]);
  });
});

describe('Role separation · requireRole is an exact-match gate', () => {
  it('a diner token is rejected (403) on an owner-only route', async () => {
    const diner = await freshLogin('diner');
    const res = await server.inject({
      method: 'GET',
      // Any owner-gated route works; ownership is checked AFTER the role gate,
      // so a random UUID still proves the 403 comes from requireRole.
      url: `/restaurants/${randomUUID()}/reservations`,
      headers: { authorization: `Bearer ${diner.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('an owner token is rejected (403) on a diner-only route', async () => {
    const owner = await freshLogin('owner');
    const res = await server.inject({
      method: 'GET',
      url: '/reservations',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Open findings — desired invariants NOT yet held (skipped, do not delete)', () => {
  // BACKLOG M-3 / CI-H1: password reset deletes all refresh tokens
  // (auth.service.ts:494-511) but does NOT deny-list live access tokens, so a
  // stolen access token survives a password reset for up to 15 minutes. This
  // guard asserts the DESIRED behavior and must stay skipped until M-3 is
  // fixed; un-skip it in the fixing PR.
  it.skip('M-3: after password reset, previously issued access tokens are revoked', async () => {
    const creds = await freshLogin();
    // (reset flow omitted — when implementing the fix, drive /auth/forgot +
    // /auth/reset here, then assert the old access token gets 401:)
    const res = await server.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  // BACKLOG L-5 / CI-H2: presenting an already-rotated refresh token is merely
  // a 401 — it does not revoke the descendant token family, so a thief who
  // rotated first keeps a valid session. Desired: reuse detection revokes the
  // whole family. Skipped until L-5 is implemented.
  it.skip('L-5: reuse of a rotated refresh token revokes the descendant family', async () => {
    const creds = await freshLogin();
    const first = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    const rotated = (JSON.parse(first.body) as { refreshToken: string }).refreshToken;

    // Attacker replays the OLD token → 401 (already true) AND the new family
    // should now be revoked (not yet true):
    await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: creds.refreshToken },
    });
    const familyUse = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rotated },
    });
    expect(familyUse.statusCode).toBe(401);
  });
});
