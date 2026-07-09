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
  invalidateAvailabilityCacheForDate,
  writeAvailabilityCache,
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
