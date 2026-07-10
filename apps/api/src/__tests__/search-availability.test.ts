import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@restaurant/db';
import { buildTestServer } from './helpers/server.js';
import { cleanupTestUsers } from './helpers/db.js';
import { loginUser } from './helpers/auth.js';
import {
  createTestRestaurant,
  createTestTables,
  cleanupTestRestaurants,
  futureDate,
} from './helpers/restaurant.js';

/**
 * Search-with-availability (R15): the cache-first, pre-filtered path in
 * findAvailableRestaurantIds. These tests pin the three correctness
 * properties the rework introduced:
 *   1. closed-that-day restaurants never appear,
 *   2. non-operable (lapsed) owners' restaurants never appear,
 *   3. the q text filter applies to the availability candidates themselves.
 */

const createdUserIds: string[] = [];
const createdRestaurantIds: string[] = [];

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await server.close();
  await cleanupTestRestaurants(createdRestaurantIds);
  await cleanupTestUsers(createdUserIds);
});

interface SearchBody {
  restaurants: Array<{ id: string; name: string }>;
  total: number;
}

async function searchByCity(
  city: string,
  date: string,
  extra = '',
): Promise<SearchBody> {
  const res = await server.inject({
    method: 'GET',
    url: `/restaurants?city=${encodeURIComponent(city)}&date=${date}&partySize=2${extra}`,
  });
  expect(res.statusCode).toBe(200);
  return res.json<SearchBody>();
}

describe('GET /restaurants?date&partySize (availability search)', () => {
  it('returns open restaurants and excludes ones closed that day', async () => {
    const owner = await loginUser(server, { role: 'owner' });
    createdUserIds.push(owner.userId);

    const city = `SearchCity-${randomUUID().slice(0, 8)}`;
    const searchDate = futureDate(3);

    const openRestaurant = await createTestRestaurant(server, owner.accessToken, {
      city,
    });
    const closedRestaurant = await createTestRestaurant(server, owner.accessToken, {
      city,
    });
    createdRestaurantIds.push(openRestaurant.id, closedRestaurant.id);

    await createTestTables(server, openRestaurant.id, owner.accessToken, [
      { name: 'T1', maxPartySize: 4 },
    ]);
    await createTestTables(server, closedRestaurant.id, owner.accessToken, [
      { name: 'T1', maxPartySize: 4 },
    ]);

    // Blackout the second restaurant on the search date.
    const closure = await server.inject({
      method: 'POST',
      url: `/restaurants/${closedRestaurant.id}/closures`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { date: searchDate, reason: 'Private event' },
    });
    expect(closure.statusCode).toBe(201);

    const body = await searchByCity(city, searchDate);
    const ids = body.restaurants.map((r) => r.id);
    expect(ids).toContain(openRestaurant.id);
    expect(ids).not.toContain(closedRestaurant.id);
  });

  it('excludes restaurants whose owner can no longer operate (lapsed trial)', async () => {
    const owner = await loginUser(server, { role: 'owner' });
    createdUserIds.push(owner.userId);

    const city = `SearchCity-${randomUUID().slice(0, 8)}`;
    const searchDate = futureDate(3);

    const restaurant = await createTestRestaurant(server, owner.accessToken, {
      city,
    });
    createdRestaurantIds.push(restaurant.id);
    await createTestTables(server, restaurant.id, owner.accessToken, [
      { name: 'T1', maxPartySize: 4 },
    ]);

    // While operable: it shows up.
    let body = await searchByCity(city, searchDate);
    expect(body.restaurants.map((r) => r.id)).toContain(restaurant.id);

    // Lapse the owner (trial expired 15 days ago) — createTestRestaurant set
    // ACTIVE/PREMIUM, so downgrade AFTER creation.
    await prisma.subscription.update({
      where: { userId: owner.userId },
      data: {
        plan: 'STARTER',
        status: 'TRIALING',
        trialStartedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      },
    });

    body = await searchByCity(city, searchDate);
    expect(body.restaurants.map((r) => r.id)).not.toContain(restaurant.id);
  });

  it('applies the q text filter to availability candidates', async () => {
    const owner = await loginUser(server, { role: 'owner' });
    createdUserIds.push(owner.userId);

    const city = `SearchCity-${randomUUID().slice(0, 8)}`;
    const marker = `Marker${randomUUID().slice(0, 8)}`;
    const searchDate = futureDate(3);

    const matching = await createTestRestaurant(server, owner.accessToken, {
      city,
      name: `${marker} Bistro`,
    });
    const other = await createTestRestaurant(server, owner.accessToken, {
      city,
      name: `Other Place ${randomUUID().slice(0, 8)}`,
    });
    createdRestaurantIds.push(matching.id, other.id);

    await createTestTables(server, matching.id, owner.accessToken, [
      { name: 'T1', maxPartySize: 4 },
    ]);
    await createTestTables(server, other.id, owner.accessToken, [
      { name: 'T1', maxPartySize: 4 },
    ]);

    const body = await searchByCity(
      city,
      searchDate,
      `&q=${encodeURIComponent(marker)}`,
    );
    const ids = body.restaurants.map((r) => r.id);
    expect(ids).toContain(matching.id);
    expect(ids).not.toContain(other.id);
  });
});
