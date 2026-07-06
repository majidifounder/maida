import jwt from 'jsonwebtoken';
import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin } from '../lib/auth-helpers.js';
import { buildWebhookPayload, sendWebhook } from '../lib/webhook.js';
import { uniqueEmail } from '../lib/context.js';

export async function runSecurityJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test('Security', 'cross-owner restaurant mutation returns 404 (IDOR-safe)', async () => {
    const owner1 = await registerAndLogin(ctx, 'owner');
    const owner2 = await registerAndLogin(ctx, 'owner');

    const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
      token: owner1.accessToken,
      body: {
        name: 'Security Target',
        description: 'Cross-owner test',
        cuisine: 'OTHER',
        address: '1 Sec St',
        city: 'SecCity',
      },
    });
    report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
    ctx.trackRestaurant(rest.body.restaurant.id);

    const patch = await apiRequest(ctx, 'PATCH', `/restaurants/${rest.body.restaurant.id}`, {
      token: owner2.accessToken,
      body: { name: 'Hijacked' },
    });
    report.assert(patch.status === 404, `Expected 404 cross-owner patch, got ${patch.status}`);
  });

  await report.test('Security', 'cross-owner reservation routes return 403', async () => {
    const owner1 = await registerAndLogin(ctx, 'owner');
    const owner2 = await registerAndLogin(ctx, 'owner');

    const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
      token: owner1.accessToken,
      body: {
        name: 'Res Security Target',
        description: 'Cross-owner reservation test',
        cuisine: 'OTHER',
        address: '2 Sec St',
        city: 'SecCity',
      },
    });
    report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
    ctx.trackRestaurant(rest.body.restaurant.id);

    const list = await apiRequest(ctx, 'GET', `/restaurants/${rest.body.restaurant.id}/reservations`, {
      token: owner2.accessToken,
    });
    report.assert(list.status === 403, `Expected 403 cross-owner reservations, got ${list.status}`);
  });

  await report.test('Security', 'tampered and revoked JWT rejected with 401', async () => {
    const diner = await registerAndLogin(ctx, 'diner');

    const tampered = `${diner.accessToken}x`;
    const badSig = await apiRequest(ctx, 'GET', '/auth/me', { token: tampered });
    report.assert(badSig.status === 401, `Tampered JWT should 401, got ${badSig.status}`);

    const privateKey = process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n');
    report.assert(!!privateKey, 'JWT_PRIVATE_KEY required for expired token test');
    const expired = jwt.sign(
      {
        sub: diner.userId,
        role: 'diner',
        jti: 'expired-e2e',
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      privateKey!,
      { algorithm: 'RS256', noTimestamp: true },
    );
    const expiredRes = await apiRequest(ctx, 'GET', '/auth/me', { token: expired });
    report.assert(expiredRes.status === 401, `Expired JWT should 401, got ${expiredRes.status}`);

    await apiRequest(ctx, 'POST', '/auth/logout', { token: diner.accessToken });
    const revoked = await apiRequest(ctx, 'GET', '/auth/me', { token: diner.accessToken });
    report.assert(revoked.status === 401, `Revoked JWT should 401, got ${revoked.status}`);
  });

  await report.test('Security', 'search injection-style payloads handled safely', async () => {
    const payloads = [
      "' OR 1=1 --",
      '"; DROP TABLE users; --',
      '<script>alert(1)</script>',
    ];

    for (const q of payloads) {
      const res = await apiRequest(ctx, 'GET', '/restaurants', {
        query: { q, page: 1, limit: 5 },
      });
      report.assert(
        res.status === 200 || res.status === 422,
        `Search with payload should not 500 (got ${res.status})`,
      );
    }
  });

  await report.test('Security', 'invalid webhook signature rejected with 401', async () => {
    const owner = await registerAndLogin(ctx, 'owner');
    const payload = buildWebhookPayload('subscription_created', owner.userId);
    const body = JSON.stringify(payload);

    const res = await apiRequest(ctx, 'POST', '/webhooks/lemon-squeezy', {
      body: payload,
      skipLoadTestHeader: true,
      headers: { 'x-signature': 'deadbeef'.padEnd(64, '0') },
    });
    report.assert(res.status === 401, `Invalid webhook sig should 401, got ${res.status}`);

    const replay = await sendWebhook(ctx.base, payload);
    report.assert(replay.status === 200, `Valid webhook should 200, got ${replay.status}`);
    const replay2 = await sendWebhook(ctx.base, payload);
    report.assert(
      replay2.status === 200,
      `Duplicate webhook should 200 (idempotent skip), got ${replay2.status}`,
    );

    void body;
  });

  await report.test('Security', 'register rate limit returns 429', async () => {
    const ip = `e2e-rate-${Date.now()}`;
    let saw429 = false;

    for (let i = 0; i < 5; i++) {
      const res = await apiRequest(ctx, 'POST', '/auth/register', {
        skipLoadTestHeader: true,
        headers: { 'X-Forwarded-For': ip },
        body: {
          email: uniqueEmail(`rate-${i}`),
          password: 'E2ePass1!',
          role: 'diner',
        },
      });
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }

    report.assert(saw429, 'Expected 429 from register rate limit within 5 attempts');
  });
}
