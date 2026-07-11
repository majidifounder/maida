import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from './helpers/server.js';
import { cleanupTestUsers } from './helpers/db.js';
import { loginUser } from './helpers/auth.js';
import {
  futureDate,
  createTestRestaurant,
  createTestTables,
  cleanupTestRestaurants,
} from './helpers/restaurant.js';
import {
  createTestReservation,
  cleanupTestReservations,
} from './helpers/reservation.js';
import { getRedisClient } from '../lib/redis.js';
import {
  availabilityCacheIndexKey,
  availabilityCacheKey,
  bumpAvailabilityVersion,
  invalidateAvailabilityCacheForDate,
  readAvailabilityEntry,
  writeAvailabilityCache,
  writeAvailabilityEntry,
} from '../lib/availability-cache.js';

const createdUserIds: string[] = [];
const createdRestaurantIds: string[] = [];
const createdReservationIds: string[] = [];

let server: FastifyInstance;
let ownerToken: string;
let dinerToken: string;
let restaurantId: string;
let redisAvailable = false;

beforeAll(async () => {
  server = await buildTestServer();

  try {
    const redis = getRedisClient();
    await redis.ping();
    redisAvailable = true;
  } catch {
    redisAvailable = false;
  }

  const [owner, diner] = await Promise.all([
    loginUser(server, { role: 'owner' }),
    loginUser(server, { role: 'diner' }),
  ]);
  ownerToken = owner.accessToken;
  dinerToken = diner.accessToken;
  createdUserIds.push(owner.userId, diner.userId);

  const r = await createTestRestaurant(server, ownerToken);
  restaurantId = r.id;
  createdRestaurantIds.push(restaurantId);

  await createTestTables(server, restaurantId, ownerToken, [
    { name: 'Cache Table 1', maxPartySize: 4 },
    { name: 'Cache Table 2', maxPartySize: 6 },
  ]);
});

afterAll(async () => {
  await server.close();
  await cleanupTestReservations(createdReservationIds);
  await cleanupTestRestaurants(createdRestaurantIds);
  await cleanupTestUsers(createdUserIds);
});

describe('availability cache invalidation', () => {
  it('invalidateAvailabilityCacheForDate removes every tracked party-size key', async () => {
    if (!redisAvailable) {
      console.warn('[availability-cache.test] Redis unavailable — skipping');
      return;
    }

    const date = futureDate(50);
    const redis = getRedisClient();
    const key2 = availabilityCacheKey(restaurantId, date, 2);
    const key4 = availabilityCacheKey(restaurantId, date, 4);
    const indexKey = availabilityCacheIndexKey(restaurantId, date);

    await writeAvailabilityCache(restaurantId, date, 2, JSON.stringify({ times: [] }));
    await writeAvailabilityCache(restaurantId, date, 4, JSON.stringify({ times: [] }));

    expect(await redis.exists(key2)).toBe(1);
    expect(await redis.exists(key4)).toBe(1);
    const tracked = await redis.smembers(indexKey);
    expect(tracked.sort()).toEqual([key2, key4].sort());

    await invalidateAvailabilityCacheForDate(restaurantId, date);

    expect(await redis.exists(key2)).toBe(0);
    expect(await redis.exists(key4)).toBe(0);
    expect(await redis.exists(indexKey)).toBe(0);
  });

  it('creating a reservation clears all cached party-size variants for that date', async () => {
    if (!redisAvailable) {
      console.warn('[availability-cache.test] Redis unavailable — skipping');
      return;
    }

    const date = futureDate(51);
    const redis = getRedisClient();
    const key2 = availabilityCacheKey(restaurantId, date, 2);
    const key4 = availabilityCacheKey(restaurantId, date, 4);
    const indexKey = availabilityCacheIndexKey(restaurantId, date);

    const availRes = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/availability?date=${date}&partySize=2`,
    });
    expect(availRes.statusCode).toBe(200);
    const availBody = JSON.parse(availRes.body) as {
      times: Array<{ startsAt: string }>;
    };
    expect(availBody.times.length).toBeGreaterThan(0);

    await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/availability?date=${date}&partySize=4`,
    });

    expect(await redis.exists(key2)).toBe(1);
    expect(await redis.exists(key4)).toBe(1);
    expect((await redis.smembers(indexKey)).sort()).toEqual([key2, key4].sort());

    const reservation = await createTestReservation(server, dinerToken, {
      restaurantId,
      partySize: 2,
      startsAt: availBody.times[0]!.startsAt,
    });
    createdReservationIds.push(reservation.id);

    expect(await redis.exists(key2)).toBe(0);
    expect(await redis.exists(key4)).toBe(0);
    expect(await redis.exists(indexKey)).toBe(0);
  });
});

describe('versioned availability entries', () => {
  it('a version bump orphans every cached entry for the restaurant', async () => {
    if (!redisAvailable) {
      console.warn('[availability-cache.test] Redis unavailable — skipping');
      return;
    }

    const date = futureDate(52);
    const entry = {
      times: [
        {
          startsAt: '2026-09-01T18:00:00.000Z',
          endsAt: '2026-09-01T19:30:00.000Z',
          durationMins: 90,
        },
      ],
      serviceWindows: [
        { open: '2026-09-01T10:00:00.000Z', close: '2026-09-01T22:00:00.000Z' },
      ],
      standardDurationMins: 90,
    };

    await writeAvailabilityEntry(restaurantId, date, 2, entry);

    const hit = await readAvailabilityEntry(restaurantId, date, 2);
    expect(hit?.times).toHaveLength(1);
    expect(hit?.standardDurationMins).toBe(90);

    // A config-shaped mutation bumps the version: same key, now a miss.
    await bumpAvailabilityVersion(restaurantId);
    expect(await readAvailabilityEntry(restaurantId, date, 2)).toBeNull();

    // Entries written AFTER the bump are valid under the new version.
    await writeAvailabilityEntry(restaurantId, date, 2, entry);
    expect(await readAvailabilityEntry(restaurantId, date, 2)).not.toBeNull();
  });

  it('changing the weekly schedule takes effect on the next availability read', async () => {
    if (!redisAvailable) {
      console.warn('[availability-cache.test] Redis unavailable — skipping');
      return;
    }

    const date = futureDate(53);

    // Warm the cache with the default always-open schedule.
    const before = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/availability?date=${date}&partySize=2`,
    });
    expect(before.statusCode).toBe(200);
    expect(before.json<{ times: unknown[] }>().times.length).toBeGreaterThan(0);

    // Owner closes the restaurant on that weekday (window removed for it).
    const targetWeekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const withoutThatDay = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      openMinute: 660,
      closeMinute: 1380,
    })).filter((p) => p.dayOfWeek !== targetWeekday);

    const emptied = await server.inject({
      method: 'PUT',
      url: `/restaurants/${restaurantId}/schedule`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { periods: withoutThatDay },
    });
    expect(emptied.statusCode).toBe(200);

    // A fully empty week is rejected — it would silently fall back to the
    // legacy always-open window (pre-migration backstop).
    const rejected = await server.inject({
      method: 'PUT',
      url: `/restaurants/${restaurantId}/schedule`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { periods: [] },
    });
    expect(rejected.statusCode).toBe(422);

    // The very next read must reflect it — no TTL wait.
    const after = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/availability?date=${date}&partySize=2`,
    });
    expect(after.statusCode).toBe(200);
    const body = after.json<{ times: unknown[]; serviceWindows: unknown[] }>();
    expect(body.times).toHaveLength(0);
    expect(body.serviceWindows).toHaveLength(0);

    // Restore a schedule so later tests in this file see an open restaurant.
    const restored = await server.inject({
      method: 'PUT',
      url: `/restaurants/${restaurantId}/schedule`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        periods: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          openMinute: 660,
          closeMinute: 1380,
        })),
      },
    });
    expect(restored.statusCode).toBe(200);
  });
});
