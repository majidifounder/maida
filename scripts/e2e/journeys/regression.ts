import { prisma } from '@restaurant/db';
import { Redis } from 'ioredis';
import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin, setOwnerPlan } from '../lib/auth-helpers.js';
import { futureDatetime } from '../lib/dates.js';

export async function runRegressionJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test('Regression', 'GET /health — process alive', async () => {
    const health = await apiRequest<{ status: string }>(ctx, 'GET', '/health');
    report.assert(health.status === 200, `Health should 200, got ${health.status}`);
    report.assert(health.body.status === 'ok', 'Health status should be ok');
  });

  await report.test('Regression', 'GET /health/ready — DB + Redis healthy', async () => {
    const ready = await apiRequest<{
      status: string;
      checks?: { database: string; redis: string };
    }>(ctx, 'GET', '/health/ready');
    report.assert(ready.status === 200, `Ready should 200, got ${ready.status}`);
    report.assert(ready.body.status === 'ok', 'Ready status should be ok');
    report.assert(
      ready.body.checks?.database === 'ok' && ready.body.checks?.redis === 'ok',
      `DB and Redis checks must pass (got ${JSON.stringify(ready.body.checks)})`,
    );
  });

  await report.test('Regression', 'auth — register, login, me, refresh, logout', async () => {
    const session = await registerAndLogin(ctx, 'diner');

    const me = await apiRequest<{ id: string; email: string }>(ctx, 'GET', '/auth/me', {
      token: session.accessToken,
    });
    report.assert(me.status === 200, `GET /auth/me failed: ${me.status}`);
    report.assert(me.body.id === session.userId, 'Me should return same user id');

    const refresh = await apiRequest<{ accessToken: string }>(ctx, 'POST', '/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });
    report.assert(refresh.status === 200, `Refresh failed: ${refresh.status}`);
    report.assert(!!refresh.body.accessToken, 'Refresh should return new access token');

    const logout = await apiRequest(ctx, 'POST', '/auth/logout', {
      token: refresh.body.accessToken,
    });
    report.assert(logout.status === 200, `Logout failed: ${logout.status}`);
  });

  await report.test('Regression', 'auth — forgot-password returns uniform 200', async () => {
    const session = await registerAndLogin(ctx, 'diner');

    const known = await apiRequest<{ message: string }>(ctx, 'POST', '/auth/forgot-password', {
      body: { email: session.email },
    });
    const unknown = await apiRequest<{ message: string }>(ctx, 'POST', '/auth/forgot-password', {
      body: { email: 'nobody@e2e-test.local' },
    });

    report.assert(known.status === 200 && unknown.status === 200, 'Forgot-password always 200');
    report.assert(
      known.body.message === unknown.body.message,
      'Forgot-password responses must be identical (no enumeration)',
    );
  });

  await report.test('Regression', 'restaurant CRUD — create, read, update, delete', async () => {
    const owner = await registerAndLogin(ctx, 'owner');
    await setOwnerPlan(owner.userId, 'PRO');

    const created = await apiRequest<{ restaurant: { id: string; name: string } }>(
      ctx,
      'POST',
      '/restaurants',
      {
        token: owner.accessToken,
        body: {
          name: 'Regression CRUD',
          description: 'Regression CRUD test restaurant',
          cuisine: 'MEXICAN',
          address: '9 Reg St',
          city: 'RegCity',
        },
      },
    );
    report.assert(created.status === 201, `Create failed: ${created.status}`);
    const id = created.body.restaurant.id;
    ctx.trackRestaurant(id);

    const getPublic = await apiRequest(ctx, 'GET', `/restaurants/${id}`);
    report.assert(getPublic.status === 200, `Public get failed: ${getPublic.status}`);

    const mine = await apiRequest<{ restaurants: Array<{ id: string }> }>(
      ctx,
      'GET',
      '/restaurants/mine',
      { token: owner.accessToken },
    );
    report.assert(mine.status === 200, `Mine failed: ${mine.status}`);
    report.assert(
      mine.body.restaurants.some((r) => r.id === id),
      'Restaurant should appear in /mine',
    );

    const updated = await apiRequest(ctx, 'PATCH', `/restaurants/${id}`, {
      token: owner.accessToken,
      body: { name: 'Regression CRUD Updated' },
    });
    report.assert(updated.status === 200, `Update failed: ${updated.status}`);

    const deleted = await apiRequest(ctx, 'DELETE', `/restaurants/${id}`, {
      token: owner.accessToken,
    });
    report.assert(deleted.status === 204, `Delete failed: ${deleted.status}`);
    ctx.restaurantIds.delete(id);
  });

  await report.test(
    'Regression',
    'reservation create enqueues notification path (201 + queue non-fatal)',
    async () => {
      const owner = await registerAndLogin(ctx, 'owner');
      await setOwnerPlan(owner.userId, 'PRO');

      const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
        token: owner.accessToken,
        body: {
          name: 'Notify Regression',
          description: 'Notification smoke',
          cuisine: 'OTHER',
          address: '10 Reg St',
          city: 'RegCity',
        },
      });
      report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
      ctx.trackRestaurant(rest.body.restaurant.id);

      await apiRequest(ctx, 'POST', `/restaurants/${rest.body.restaurant.id}/tables`, {
        token: owner.accessToken,
        body: { name: 'N1', minPartySize: 2, maxPartySize: 4 },
      });

      const diner = await registerAndLogin(ctx, 'diner');
      const book = await apiRequest(ctx, 'POST', '/reservations', {
        token: diner.accessToken,
        body: {
          restaurantId: rest.body.restaurant.id,
          partySize: 2,
          startsAt: futureDatetime(25, 19),
          reservationType: 'STANDARD',
        },
      });
      report.assert(book.status === 201, `Reservation should 201 even if email async: ${book.status}`);
      ctx.trackReservation((book.body as { reservation: { id: string } }).reservation.id);

      const redisUrl = process.env.REDIS_URL;
      report.assert(!!redisUrl, 'REDIS_URL required for notification idempotency layer');
      const redis = new Redis(redisUrl!, { maxRetriesPerRequest: 1, lazyConnect: true });
      await redis.connect();
      const pong = await redis.ping();
      await redis.quit();
      report.assert(pong === 'PONG', 'Redis must be reachable for notification idempotency layer');
    },
  );
}
