import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '@restaurant/db';
import { buildTestServer } from './helpers/server.js';
import { cleanupTestUsers } from './helpers/db.js';
import { loginUser } from './helpers/auth.js';

describe('POST /feedback', () => {
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

  it('accepts feedback from a diner', async () => {
    const diner = await loginUser(app, { role: 'diner' });
    trackedUserIds.push(diner.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { Authorization: `Bearer ${diner.accessToken}` },
      payload: { message: 'The booking flow could show clearer duration info.' },
    });

    expect(res.statusCode).toBe(201);
    const row = await prisma.productFeedback.findFirst({
      where: { userId: diner.userId },
    });
    expect(row?.role).toBe('DINER');
    expect(row?.message).toContain('booking flow');
  });

  it('accepts feedback from an owner', async () => {
    const owner = await loginUser(app, { role: 'owner' });
    trackedUserIds.push(owner.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      payload: { message: 'Would love bulk table import in the dashboard.' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('rejects messages that are too short', async () => {
    const diner = await loginUser(app, { role: 'diner' });
    trackedUserIds.push(diner.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { Authorization: `Bearer ${diner.accessToken}` },
      payload: { message: 'short' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/feedback',
      payload: { message: 'Anonymous feedback should not work here.' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('service hours validation', () => {
  it('allows 24-hour configuration via API schema', async () => {
    const { CreateRestaurantSchema } = await import(
      '../modules/restaurant/restaurant.schema.js'
    );
    const parsed = CreateRestaurantSchema.safeParse({
      name: 'Late Night',
      description: 'Always open kitchen for testing validation only.',
      cuisine: 'AMERICAN',
      address: '1 Open St',
      city: 'Testville',
      openMinutes: 0,
      closeMinutes: 1440,
    });
    expect(parsed.success).toBe(true);
  });
});
