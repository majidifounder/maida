/**
 * INVARIANT GUARDS · Billing Webhook Pipeline
 *
 * Regression guards for verified invariants (docs/architecture/INVARIANTS.md):
 *   —      HMAC signature validation (raw-body HMAC-SHA256, 401 on mismatch)
 *   INV-6  idempotency: an already-processed event (same event:subId:updated_at)
 *          is skipped — proven by observable DB effect, not response shape
 *   INV-7  ordering: an event older than stored lsUpdatedAt is dropped
 *
 * Unlike subscription.test.ts (which mocks Redis and the service), this file
 * exercises the REAL pipeline end-to-end: real Redis idempotency keys, real
 * upsertSubscriptionFromWebhook, real Postgres rows. Unique per-run LS ids
 * keep reruns from colliding with persisted 7-day idempotency keys.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@restaurant/db';
import { buildTestServer } from '../helpers/server.js';
import { registerUser } from '../helpers/auth.js';
import { cleanupTestUsers } from '../helpers/db.js';

const WEBHOOK_SECRET = 'test_secret'; // pinned by apps/api/vitest.config.ts

let server: FastifyInstance;
let userId: string;
const lsSubId = `guard-ls-${randomUUID()}`;
const T0 = '2026-01-01T10:00:00.000Z'; // older
const T1 = '2026-01-05T10:00:00.000Z'; // newer

beforeAll(async () => {
  server = await buildTestServer();
  ({ userId } = await registerUser(server, { role: 'owner' }));
});

afterAll(async () => {
  await cleanupTestUsers([userId]);
  await server.close();
});

function payload(opts: { variantId: number; updatedAt: string; event?: string }): string {
  return JSON.stringify({
    meta: {
      event_name: opts.event ?? 'subscription_updated',
      custom_data: { user_id: userId },
    },
    data: {
      id: lsSubId,
      type: 'subscriptions',
      attributes: {
        status: 'active',
        variant_id: opts.variantId,
        renews_at: '2026-02-01T00:00:00.000Z',
        ends_at: null,
        cancelled: false,
        updated_at: opts.updatedAt,
      },
    },
  });
}

async function deliver(body: string, signature?: string) {
  return server.inject({
    method: 'POST',
    url: '/webhooks/lemon-squeezy',
    headers: {
      'content-type': 'application/json',
      ...(signature !== undefined ? { 'x-signature': signature } : {}),
    },
    payload: body,
  });
}

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

describe('Webhook signature validation (raw-body HMAC, lemon-squeezy.ts:6-17)', () => {
  it('401 on missing signature', async () => {
    const res = await deliver(payload({ variantId: 200, updatedAt: T1 }));
    expect(res.statusCode).toBe(401);
  });

  it('401 on invalid signature; no state applied', async () => {
    const res = await deliver(payload({ variantId: 200, updatedAt: T1 }), 'deadbeef');
    expect(res.statusCode).toBe(401);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    // Registration seeds a TRIALING/STARTER row — the forged event must not
    // have upgraded it.
    expect(sub?.plan).not.toBe('PRO');
  });
});

describe('INV-7 + INV-6 · ordering then idempotency (real Redis, real service)', () => {
  it('a validly-signed event applies (variant→PRO, lsUpdatedAt stored)', async () => {
    const body = payload({ variantId: 200, updatedAt: T1 }); // LS_VARIANT_PRO=200 in tests
    const res = await deliver(body, sign(body));
    expect(res.statusCode).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.plan).toBe('PRO');
    expect(sub?.status).toBe('ACTIVE');
    expect(sub?.lsUpdatedAt?.toISOString()).toBe(T1);
  });

  it('INV-7: a later-delivered but OLDER event (updated_at T0 < stored T1) is dropped', async () => {
    // Different updated_at ⇒ different idempotency key ⇒ this exercises the
    // ordering guard (subscription.service.ts:328-334), not the idem layer.
    const body = payload({ variantId: 300, updatedAt: T0 }); // would set PREMIUM if applied
    const res = await deliver(body, sign(body));
    expect(res.statusCode).toBe(200); // stale events are ACKed, never retried

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.plan).toBe('PRO'); // unchanged
    expect(sub?.lsUpdatedAt?.toISOString()).toBe(T1);
  });

  it('INV-6: redelivering the exact same event is a no-op (idempotency key short-circuits)', async () => {
    // Sabotage the row out-of-band so a re-application WOULD be visible: the
    // redelivered event carries updated_at == stored lsUpdatedAt, and equal
    // timestamps DO apply (CI-B2) — so if the Redis SET NX layer failed to
    // short-circuit, plan would flip back to PRO. It must stay STARTER.
    await prisma.subscription.update({ where: { userId }, data: { plan: 'STARTER' } });

    const body = payload({ variantId: 200, updatedAt: T1 }); // identical key as first event
    const res = await deliver(body, sign(body));
    expect(res.statusCode).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub?.plan).toBe('STARTER'); // untouched ⇒ handler never re-ran
  });
});
