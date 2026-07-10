import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { prisma, SubscriptionStatus } from '@restaurant/db';
import { buildTestServer } from './helpers/server.js';
import { loginUser } from './helpers/auth.js';
import { cleanupTestUsers } from './helpers/db.js';
import { cleanupTestRestaurants } from './helpers/restaurant.js';
import {
  variantIdToPlan,
  lsStatusToInternal,
  verifyLemonSqueezySignature,
  webhookIdempotencyKey,
} from '../lib/lemon-squeezy.js';

const WEBHOOK_SECRET = 'test_secret';

const { mockRedisSet, mockRedisDel, mockRedisGet } = vi.hoisted(() => ({
  mockRedisSet: vi.fn().mockResolvedValue('OK'),
  mockRedisDel: vi.fn().mockResolvedValue(1),
  mockRedisGet: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({
    set: mockRedisSet,
    del: mockRedisDel,
    get: mockRedisGet,
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
  createSubscriberClient: vi.fn(),
}));

const { mockUpsert } = vi.hoisted(() => ({
  mockUpsert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/subscription/subscription.service.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../modules/subscription/subscription.service.js')
    >();
  return {
    ...actual,
    upsertSubscriptionFromWebhook: mockUpsert,
  };
});

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function makeSubPayload(overrides: Record<string, unknown> = {}) {
  const base = {
    meta: {
      event_name: 'subscription_created',
      custom_data: { user_id: 'user-uuid-1' },
    },
    data: {
      id: 'ls-sub-123',
      type: 'subscriptions',
      attributes: {
        status: 'active',
        variant_id: 200,
        renews_at: '2026-07-27T00:00:00.000Z',
        ends_at: null,
        cancelled: false,
        updated_at: '2026-06-27T10:00:00.000Z',
      },
    },
  };
  return structuredClone({ ...base, ...overrides });
}

async function buildWebhookServer() {
  const { webhookRoutes } = await import('../modules/subscription/webhook.routes.js');
  const app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(webhookRoutes);
  await app.ready();
  return app;
}

describe('lemon-squeezy lib', () => {
  it('variantIdToPlan maps env variant IDs', () => {
    expect(variantIdToPlan(100)).toBe('STARTER');
    expect(variantIdToPlan(200)).toBe('PRO');
    expect(variantIdToPlan(300)).toBe('PREMIUM');
    expect(variantIdToPlan(999)).toBeNull();
  });

  it('lsStatusToInternal maps Lemon Squeezy status strings', () => {
    expect(lsStatusToInternal('on_trial')).toBe(SubscriptionStatus.TRIALING);
    expect(lsStatusToInternal('active')).toBe(SubscriptionStatus.ACTIVE);
    expect(lsStatusToInternal('past_due')).toBe(SubscriptionStatus.PAST_DUE);
    expect(lsStatusToInternal('unpaid')).toBe(SubscriptionStatus.PAST_DUE);
    expect(lsStatusToInternal('expired')).toBe(SubscriptionStatus.EXPIRED);
    expect(lsStatusToInternal('bogus_status')).toBe(SubscriptionStatus.PAST_DUE);
  });

  it('verifyLemonSqueezySignature accepts valid HMAC', () => {
    const body = '{"test":true}';
    const sig = sign(body);
    expect(verifyLemonSqueezySignature(body, sig)).toBe(true);
    expect(verifyLemonSqueezySignature(body, 'deadbeef')).toBe(false);
  });

  it('webhookIdempotencyKey is stable and unique per updatedAt', () => {
    const k1 = webhookIdempotencyKey('subscription_updated', '1', 't1');
    const k2 = webhookIdempotencyKey('subscription_updated', '1', 't2');
    expect(k1).toContain('ls-event:');
    expect(k1).not.toBe(k2);
  });
});

describe('POST /webhooks/lemon-squeezy', () => {
  let app: Awaited<ReturnType<typeof buildWebhookServer>>;

  beforeEach(async () => {
    app = await buildWebhookServer();
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    mockUpsert.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when X-Signature header is missing', async () => {
    const body = JSON.stringify(makeSubPayload());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/lemon-squeezy',
      payload: body,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when signature is invalid', async () => {
    const body = JSON.stringify(makeSubPayload());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/lemon-squeezy',
      payload: body,
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sign('tampered'),
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 and skips order events', async () => {
    const payload = {
      meta: { event_name: 'order_created', custom_data: {} },
      data: { id: '1', type: 'orders', attributes: {} },
    };
    const body = JSON.stringify(payload);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/lemon-squeezy',
      payload: body,
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sign(body),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 200 and upserts on subscription_created', async () => {
    const payload = makeSubPayload();
    const body = JSON.stringify(payload);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/lemon-squeezy',
      payload: body,
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sign(body),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockUpsert.mock.calls[0]![0]).toMatchObject({
      userId: 'user-uuid-1',
      lemonSqueezyId: 'ls-sub-123',
      variantId: 200,
    });
  });

  it('returns 200 and skips upsert on idempotent duplicate', async () => {
    mockRedisSet.mockResolvedValueOnce(null);
    const body = JSON.stringify(makeSubPayload());
    await app.inject({
      method: 'POST',
      url: '/webhooks/lemon-squeezy',
      payload: body,
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sign(body),
      },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('deletes idempotency key and returns 500 when upsert fails', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('DB down'));
    const body = JSON.stringify(makeSubPayload());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/lemon-squeezy',
      payload: body,
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sign(body),
      },
    });
    expect(res.statusCode).toBe(500);
    expect(mockRedisDel).toHaveBeenCalledOnce();
  });

  it('returns 200 for unknown event names without upsert', async () => {
    const payload = makeSubPayload({
      meta: {
        event_name: 'subscription_future_event',
        custom_data: { user_id: 'u1' },
      },
    });
    const body = JSON.stringify(payload);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/lemon-squeezy',
      payload: body,
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sign(body),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 200 without upsert when custom_data.user_id is absent', async () => {
    const payload = makeSubPayload({
      meta: { event_name: 'subscription_created', custom_data: {} },
    });
    const body = JSON.stringify(payload);
    await app.inject({
      method: 'POST',
      url: '/webhooks/lemon-squeezy',
      payload: body,
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sign(body),
      },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('upsertSubscriptionFromWebhook (integration)', () => {
  const trackedUserIds: string[] = [];

  afterEach(async () => {
    await cleanupTestUsers(trackedUserIds);
    trackedUserIds.length = 0;
  });

  it('maps variant to PRO and EXPIRED forces STARTER plan', async () => {
    const server = await buildTestServer();
    const owner = await loginUser(server, {
      role: 'owner',
      subscriptionPlan: 'none',
    });
    trackedUserIds.push(owner.userId);
    await server.close();

    const { upsertSubscriptionFromWebhook } = await vi.importActual<
      typeof import('../modules/subscription/subscription.service.js')
    >('../modules/subscription/subscription.service.js');

    const applied = await upsertSubscriptionFromWebhook({
      userId: owner.userId,
      lemonSqueezyId: 'ls-1',
      lsStatus: 'active',
      variantId: 200,
      renewsAt: '2026-07-27T00:00:00.000Z',
      endsAt: null,
      cancelled: false,
      updatedAt: '2026-07-01T10:00:00.000Z',
    });
    expect(applied).toBe(true);

    let sub = await prisma.subscription.findUnique({
      where: { userId: owner.userId },
    });
    expect(sub?.plan).toBe('PRO');
    expect(sub?.status).toBe('ACTIVE');
    expect(sub?.lemonSqueezyVariantId).toBe('200');

    await upsertSubscriptionFromWebhook({
      userId: owner.userId,
      lemonSqueezyId: 'ls-1',
      lsStatus: 'expired',
      variantId: 300,
      renewsAt: null,
      endsAt: '2026-08-01T00:00:00.000Z',
      cancelled: false,
      updatedAt: '2026-07-02T10:00:00.000Z',
    });

    sub = await prisma.subscription.findUnique({
      where: { userId: owner.userId },
    });
    expect(sub?.plan).toBe('STARTER');
    expect(sub?.status).toBe('EXPIRED');

    // A late out-of-order delivery (older updated_at) must NOT resurrect the
    // expired subscription.
    const staleApplied = await upsertSubscriptionFromWebhook({
      userId: owner.userId,
      lemonSqueezyId: 'ls-1',
      lsStatus: 'active',
      variantId: 200,
      renewsAt: '2026-07-27T00:00:00.000Z',
      endsAt: null,
      cancelled: false,
      updatedAt: '2026-07-01T12:00:00.000Z',
    });
    expect(staleApplied).toBe(false);

    sub = await prisma.subscription.findUnique({
      where: { userId: owner.userId },
    });
    expect(sub?.plan).toBe('STARTER');
    expect(sub?.status).toBe('EXPIRED');
  });
});

describe('GET /subscriptions/me', () => {
  const trackedUserIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildTestServer>>;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    await cleanupTestUsers(trackedUserIds);
    trackedUserIds.length = 0;
  });

  it('lazy-initializes a trial subscription when no row exists', async () => {
    const owner = await loginUser(app, {
      role: 'owner',
      subscriptionPlan: 'none',
    });
    trackedUserIds.push(owner.userId);

    const res = await app.inject({
      method: 'GET',
      url: '/subscriptions/me',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscription.status).toBe('TRIALING');
    expect(body.subscription.billingTier).toBe('TRIAL');
    expect(body.subscription.isTrialActive).toBe(true);
    // Trial = full PRO limits for 14 days (R8) — the deadline converts, not
    // artificial scarcity during evaluation.
    expect(body.limits.restaurants).toBe(5);
    expect(body.limits.reservationsPerMonth).toBe(1000);
    expect(body.planComparison).toHaveLength(4);

    const row = await prisma.subscription.findUnique({
      where: { userId: owner.userId },
    });
    expect(row?.status).toBe('TRIALING');
    expect(row?.trialStartedAt).toBeTruthy();
  });

  it('returns 403 for diner role', async () => {
    const diner = await loginUser(app, { role: 'diner' });
    trackedUserIds.push(diner.userId);

    const res = await app.inject({
      method: 'GET',
      url: '/subscriptions/me',
      headers: { Authorization: `Bearer ${diner.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Plan enforcement — POST /restaurants', () => {
  const trackedUserIds: string[] = [];
  const trackedRestaurantIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildTestServer>>;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    await cleanupTestRestaurants(trackedRestaurantIds);
    trackedRestaurantIds.length = 0;
    await cleanupTestUsers(trackedUserIds);
    trackedUserIds.length = 0;
  });

  it('returns 403 when STARTER owner already has 1 restaurant', async () => {
    const owner = await loginUser(app, {
      role: 'owner',
      subscriptionPlan: 'STARTER',
    });
    trackedUserIds.push(owner.userId);

    const first = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      payload: {
        name: 'First Bistro',
        cuisine: 'ITALIAN',
        description: 'First place',
        address: '1 Main St',
        city: 'Paris',
        maxCapacity: 4,
      },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    trackedRestaurantIds.push(firstBody.restaurant.id);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      payload: {
        name: 'Second Bistro',
        cuisine: 'ITALIAN',
        description: 'Another place',
        address: '2 Main St',
        city: 'Paris',
        maxCapacity: 4,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe('Plan limit reached');
    expect(body.upgrade).toBe('/subscriptions/checkout');
  });
});

describe('POST /subscriptions/checkout', () => {
  const trackedUserIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildTestServer>>;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    await cleanupTestUsers(trackedUserIds);
    trackedUserIds.length = 0;
    vi.unstubAllGlobals();
  });

  it('returns 201 with checkout URL from Lemon Squeezy API', async () => {
    const owner = await loginUser(app, { role: 'owner' });
    trackedUserIds.push(owner.userId);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { attributes: { url: 'https://checkout.lemonsqueezy.com/test' } },
          }),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/subscriptions/checkout',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      payload: { plan: 'PRO' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      checkoutUrl: 'https://checkout.lemonsqueezy.com/test',
    });
  });
});

describe('POST /subscriptions/cancel', () => {
  const trackedUserIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildTestServer>>;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    await cleanupTestUsers(trackedUserIds);
    trackedUserIds.length = 0;
    vi.restoreAllMocks();
  });

  it('returns 422 when owner has no Lemon Squeezy subscription', async () => {
    const owner = await loginUser(app, {
      role: 'owner',
      subscriptionPlan: 'none',
    });
    trackedUserIds.push(owner.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/subscriptions/cancel',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });

    expect(res.statusCode).toBe(422);
  });

  it('returns 200 and sets cancelAtPeriodEnd when subscription exists', async () => {
    const owner = await loginUser(app, { role: 'owner' });
    trackedUserIds.push(owner.userId);

    await prisma.subscription.update({
      where: { userId: owner.userId },
      data: { lemonSqueezyId: 'ls-cancel-test' },
    });

    vi.spyOn(await import('../lib/lemon-squeezy.js'), 'lsRequest').mockResolvedValue(
      {},
    );

    const res = await app.inject({
      method: 'POST',
      url: '/subscriptions/cancel',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });

    expect(res.statusCode).toBe(200);

    const sub = await prisma.subscription.findUnique({
      where: { userId: owner.userId },
    });
    expect(sub?.cancelAtPeriodEnd).toBe(true);
  });
});

describe('POST /subscriptions/resume', () => {
  const trackedUserIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildTestServer>>;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    await cleanupTestUsers(trackedUserIds);
    trackedUserIds.length = 0;
    vi.restoreAllMocks();
  });

  it('returns 409 when subscription is not scheduled for cancellation', async () => {
    const owner = await loginUser(app, { role: 'owner' });
    trackedUserIds.push(owner.userId);

    await prisma.subscription.update({
      where: { userId: owner.userId },
      data: { lemonSqueezyId: 'ls-resume-test', cancelAtPeriodEnd: false },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/subscriptions/resume',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 200 and clears cancelAtPeriodEnd when scheduled to cancel', async () => {
    const owner = await loginUser(app, { role: 'owner' });
    trackedUserIds.push(owner.userId);

    await prisma.subscription.update({
      where: { userId: owner.userId },
      data: {
        lemonSqueezyId: 'ls-resume-test',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });

    const lsSpy = vi
      .spyOn(await import('../lib/lemon-squeezy.js'), 'lsRequest')
      .mockResolvedValue({});

    const res = await app.inject({
      method: 'POST',
      url: '/subscriptions/resume',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(lsSpy).toHaveBeenCalledOnce();

    const sub = await prisma.subscription.findUnique({
      where: { userId: owner.userId },
    });
    expect(sub?.cancelAtPeriodEnd).toBe(false);
  });
});

describe('Owner trial lifecycle', () => {
  const trackedUserIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildTestServer>>;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    await cleanupTestUsers(trackedUserIds);
    trackedUserIds.length = 0;
  });

  it('blocks restaurant creation when trial has expired', async () => {
    const owner = await loginUser(app, {
      role: 'owner',
      subscriptionPlan: 'TRIAL_EXPIRED',
    });
    trackedUserIds.push(owner.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      payload: {
        name: 'Expired Trial Bistro',
        cuisine: 'ITALIAN',
        description: 'Should fail',
        address: '1 Main St',
        city: 'Paris',
        maxCapacity: 4,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toContain('trial has ended');
  });

  it('applies stricter trial limits than STARTER', async () => {
    const owner = await loginUser(app, {
      role: 'owner',
      subscriptionPlan: 'TRIAL',
    });
    trackedUserIds.push(owner.userId);

    const res = await app.inject({
      method: 'GET',
      url: '/subscriptions/me',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Trial carries full PRO limits (R8).
    expect(body.limits.reservationsPerMonth).toBe(1000);
    expect(body.limits.tablesPerRestaurant).toBe(30);
  });
});
