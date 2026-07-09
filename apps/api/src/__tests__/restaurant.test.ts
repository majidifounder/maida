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
  type TestRestaurant,
  type TestTable,
} from './helpers/restaurant.js';

const createdUserIds: string[] = [];
const createdRestaurantIds: string[] = [];

let server: FastifyInstance;

let ownerToken: string;
let ownerUserId: string;

let owner2Token: string;
let owner2UserId: string;

let dinerToken: string;
let dinerUserId: string;

beforeAll(async () => {
  server = await buildTestServer();

  const owner = await loginUser(server, { role: 'owner' });
  const owner2 = await loginUser(server, { role: 'owner' });
  const diner = await loginUser(server, { role: 'diner' });

  ownerToken = owner.accessToken;
  ownerUserId = owner.userId;
  owner2Token = owner2.accessToken;
  owner2UserId = owner2.userId;
  dinerToken = diner.accessToken;
  dinerUserId = diner.userId;

  createdUserIds.push(ownerUserId, owner2UserId, dinerUserId);
});

afterAll(async () => {
  await server.close();
  await cleanupTestRestaurants(createdRestaurantIds);
  await cleanupTestUsers(createdUserIds);
});

describe('POST /restaurants', () => {
  it('201 — owner creates a restaurant; response contains expected fields', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'Integration Bistro',
        description: 'Created by the integration test suite for restaurant tests',
        cuisine: 'ITALIAN',
        address: '42 Test Ave',
        city: 'Rome',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      restaurant: TestRestaurant & Record<string, unknown>;
    };
    expect(body.restaurant.id).toBeDefined();
    expect(body.restaurant.name).toBe('Integration Bistro');
    expect(body.restaurant.slug).toMatch(/integration-bistro/);

    createdRestaurantIds.push(body.restaurant.id);
  });

  it('201 — ownerId in response is ABSENT (never exposed publicly)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'Ownership Test Place',
        description: 'Testing that ownerId is never returned',
        cuisine: 'JAPANESE',
        address: '1 Sakura Blvd',
        city: 'Tokyo',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { restaurant: Record<string, unknown> };
    createdRestaurantIds.push(body.restaurant.id as string);

    expect(body.restaurant).not.toHaveProperty('ownerId');
    expect(body.restaurant).not.toHaveProperty('deletedAt');
  });

  it('401 — no token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/restaurants',
      payload: {
        name: 'x',
        description: 'xxxxxxxxxx',
        cuisine: 'FRENCH',
        address: 'x',
        city: 'x',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 — diner role cannot create a restaurant', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        name: 'Diner Attempt',
        description: 'This should be rejected',
        cuisine: 'FRENCH',
        address: '1 Blvd',
        city: 'Paris',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('422 — missing required field (description)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'No Desc', cuisine: 'FRENCH', address: '1 St', city: 'Paris' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 — invalid cuisine value', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'Bad Cuisine',
        description: 'Testing invalid cuisine enum value',
        cuisine: 'KLINGON',
        address: '1 St',
        city: 'Paris',
      },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /restaurants/mine', () => {
  let myRestaurantId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    myRestaurantId = r.id;
    createdRestaurantIds.push(myRestaurantId);
  });

  it("200 — returns only the calling owner's own restaurants", async () => {
    const other = await createTestRestaurant(server, owner2Token);
    createdRestaurantIds.push(other.id);

    const res = await server.inject({
      method: 'GET',
      url: '/restaurants/mine',
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { restaurants: Array<{ id: string }> };

    expect(body.restaurants.some((r) => r.id === myRestaurantId)).toBe(true);
    expect(body.restaurants.some((r) => r.id === other.id)).toBe(false);
  });

  it('401 — no token', async () => {
    const res = await server.inject({ method: 'GET', url: '/restaurants/mine' });
    expect(res.statusCode).toBe(401);
  });

  it('403 — diner cannot call /restaurants/mine', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/restaurants/mine',
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /restaurants (public search)', () => {
  let searchRestaurantId: string;
  const searchCity = `SearchCity-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken, {
      name: 'Searchable Bistro',
      cuisine: 'FRENCH',
      city: searchCity,
    });
    searchRestaurantId = r.id;
    createdRestaurantIds.push(searchRestaurantId);

    await createTestTables(server, searchRestaurantId, ownerToken, [
      { name: 'Search Table 1', maxPartySize: 8 },
      { name: 'Search Table 2', maxPartySize: 8 },
    ]);
  });

  it('200 — returns paginated result with total', async () => {
    const res = await server.inject({ method: 'GET', url: '/restaurants' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      restaurants: unknown[];
      total: number;
      page: number;
      limit: number;
    };
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.restaurants)).toBe(true);
    expect(body.page).toBe(1);
  });

  it('200 — city filter returns only matching restaurants', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?city=${encodeURIComponent(searchCity)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      restaurants: Array<{ city: string }>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    body.restaurants.forEach((r) => {
      expect(r.city.toLowerCase()).toContain(searchCity.toLowerCase());
    });
  });

  it('200 — name search (q) finds the restaurant', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/restaurants?q=Searchable+Bistro',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      restaurants: Array<{ id: string }>;
      total: number;
    };
    expect(body.restaurants.some((r) => r.id === searchRestaurantId)).toBe(true);
  });

  it('200 — cuisine filter narrows results', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?cuisine=FRENCH&city=${encodeURIComponent(searchCity)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      restaurants: Array<{ id: string }>;
      total: number;
    };
    expect(body.restaurants.some((r) => r.id === searchRestaurantId)).toBe(true);
  });

  it('200 — date + partySize availability filter finds restaurant with tables', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?date=${futureDate(5)}&partySize=4&city=${encodeURIComponent(searchCity)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { restaurants: Array<{ id: string }> };
    expect(body.restaurants.some((r) => r.id === searchRestaurantId)).toBe(true);
  });

  it('200 — partySize larger than any table capacity returns 0 for that city', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?date=${futureDate(5)}&partySize=999&city=${encodeURIComponent(searchCity)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { total: number };
    expect(body.total).toBe(0);
  });

  it('200 — restaurant with no tables returns 0 for availability filter', async () => {
    const noTableCity = `NoTableCity-${Math.random().toString(36).slice(2, 8)}`;
    const r = await createTestRestaurant(server, ownerToken, {
      name: 'No Tables Place',
      city: noTableCity,
    });
    createdRestaurantIds.push(r.id);

    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?date=${futureDate(5)}&partySize=2&city=${encodeURIComponent(noTableCity)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { total: number };
    expect(body.total).toBe(0);
  });

  it('200 — public response never contains ownerId or deletedAt', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?city=${encodeURIComponent(searchCity)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      restaurants: Array<Record<string, unknown>>;
    };
    body.restaurants.forEach((r) => {
      expect(r).not.toHaveProperty('ownerId');
      expect(r).not.toHaveProperty('deletedAt');
    });
  });

  it('422 — invalid cuisine enum value', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/restaurants?cuisine=KLINGON',
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /restaurants/:id', () => {
  let restaurantId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
  });

  it('200 — returns restaurant with correct shape', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.id).toBe(restaurantId);
    expect(body.name).toBeDefined();
    expect(body.cuisine).toBeDefined();
  });

  it('200 — sensitive fields absent from public response', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}`,
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).not.toHaveProperty('ownerId');
    expect(body).not.toHaveProperty('deletedAt');
    expect(body).not.toHaveProperty('isActive');
  });

  it('404 — non-existent restaurant ID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/restaurants/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('404 — soft-deleted restaurant is no longer publicly visible', async () => {
    const r = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(r.id);

    await server.inject({
      method: 'DELETE',
      url: `/restaurants/${r.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${r.id}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /restaurants/:id', () => {
  let restaurantId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
  });

  it('200 — owner can update their own restaurant', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Updated Name' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { restaurant: { name: string } };
    expect(body.restaurant.name).toBe('Updated Name');
  });

  it('403 — cross-owner update is rejected', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}`,
      headers: { authorization: `Bearer ${owner2Token}` },
      payload: { name: 'Hacked' },
    });
    // Returns 404 (not 403) for IDOR safety — 403 would reveal the resource exists.
    expect(res.statusCode).toBe(404);
  });

  it('401 — no token', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}`,
      payload: { name: 'No Auth' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 — diner cannot update a restaurant', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}`,
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: { name: 'Diner Update' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /restaurants/:id', () => {
  it('204 — owner soft-deletes their restaurant', async () => {
    const r = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(r.id);

    const res = await server.inject({
      method: 'DELETE',
      url: `/restaurants/${r.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('403 — cross-owner delete is rejected', async () => {
    const r = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(r.id);

    const res = await server.inject({
      method: 'DELETE',
      url: `/restaurants/${r.id}`,
      headers: { authorization: `Bearer ${owner2Token}` },
    });
    // Returns 404 (not 403) for IDOR safety — 403 would reveal the resource exists.
    expect(res.statusCode).toBe(404);
  });

  it('404 — deleting already-deleted restaurant returns 404', async () => {
    const r = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(r.id);

    await server.inject({
      method: 'DELETE',
      url: `/restaurants/${r.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    const res = await server.inject({
      method: 'DELETE',
      url: `/restaurants/${r.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /restaurants/:id/tables', () => {
  let restaurantId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
  });

  it('201 — creates a dining table', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restaurantId}/tables`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Table A', minPartySize: 1, maxPartySize: 4 },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { table: TestTable };
    expect(body.table.name).toBe('Table A');
    expect(body.table.maxPartySize).toBe(4);
  });

  it('404 — cross-owner table creation is rejected (IDOR-safe)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restaurantId}/tables`,
      headers: { authorization: `Bearer ${owner2Token}` },
      payload: { name: 'Hacked', maxPartySize: 4 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /restaurants/:id/availability', () => {
  let restaurantId: string;
  const availDate = futureDate(15);

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);

    await createTestTables(server, restaurantId, ownerToken, [
      { name: 'Avail Table 1', maxPartySize: 4 },
      { name: 'Avail Table 2', maxPartySize: 4 },
    ]);
  });

  it('200 — returns available times for party size', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/availability?date=${availDate}&partySize=2`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      times: Array<{ startsAt: string; endsAt: string }>;
      standardDurationMins: number;
      serviceWindow: { open: string; close: string };
    };
    expect(body.times.length).toBeGreaterThan(0);
    expect(body.times[0]!.startsAt).toBeDefined();
    expect(body.times[0]!.endsAt).toBeDefined();
    expect(body.standardDurationMins).toBeGreaterThan(0);
    expect(body.serviceWindow.open).toBeDefined();
    expect(body.serviceWindow.close).toBeDefined();
  });

  it('200 — cached availability still includes serviceWindow and standardDurationMins', async () => {
    const url = `/restaurants/${restaurantId}/availability?date=${availDate}&partySize=3`;
    const first = await server.inject({ method: 'GET', url });
    expect(first.statusCode).toBe(200);

    const second = await server.inject({ method: 'GET', url });
    expect(second.statusCode).toBe(200);
    const body = JSON.parse(second.body) as {
      standardDurationMins: number;
      serviceWindow: { open: string; close: string };
    };
    expect(body.standardDurationMins).toBeGreaterThan(0);
    expect(body.serviceWindow.open).toBeDefined();
    expect(body.serviceWindow.close).toBeDefined();
  });

  it('404 — non-existent restaurant', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/00000000-0000-0000-0000-000000000000/availability?date=${availDate}&partySize=2`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('422 — missing date query param', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/availability?partySize=2`,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('PATCH /restaurants/:id/tables/:tableId', () => {
  let restaurantId: string;
  let tableId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
    const tables = await createTestTables(server, restaurantId, ownerToken, [
      { name: 'Patch Table', maxPartySize: 4 },
    ]);
    tableId = tables[0]!.id;
  });

  it('200 — owner updates table capacity', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/tables/${tableId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { maxPartySize: 6 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { table: { maxPartySize: number } };
    expect(body.table.maxPartySize).toBe(6);
  });

  it('404 — cross-owner table update is rejected', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/tables/${tableId}`,
      headers: { authorization: `Bearer ${owner2Token}` },
      payload: { maxPartySize: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /restaurants/:id/tables/:tableId', () => {
  let restaurantId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
  });

  it('204 — owner soft-deletes a table', async () => {
    const tables = await createTestTables(server, restaurantId, ownerToken, [
      { name: 'Delete Me', maxPartySize: 2 },
    ]);
    const deletedTableId = tables[0]!.id;

    const res = await server.inject({
      method: 'DELETE',
      url: `/restaurants/${restaurantId}/tables/${deletedTableId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(204);

    const listing = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/tables`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const body = JSON.parse(listing.body) as {
      tables: Array<{ id: string; isActive: boolean }>;
    };
    const deleted = body.tables.find((t) => t.id === deletedTableId);
    expect(deleted?.isActive).toBe(false);
  });
});

describe('Security invariants', () => {
  let restaurantId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
  });

  it('ownerId is never present in any public or owner-list response', async () => {
    const single = JSON.parse(
      (await server.inject({ method: 'GET', url: `/restaurants/${restaurantId}` }))
        .body,
    ) as Record<string, unknown>;
    expect(single).not.toHaveProperty('ownerId');

    const search = JSON.parse(
      (await server.inject({ method: 'GET', url: '/restaurants' })).body,
    ) as { restaurants: Array<Record<string, unknown>> };
    search.restaurants.forEach((r) => expect(r).not.toHaveProperty('ownerId'));
  });

  it('cross-owner mutations return 404 (IDOR-safe — does not reveal resource existence to other owners)', async () => {
    const patch = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}`,
      headers: { authorization: `Bearer ${owner2Token}` },
      payload: { name: 'Attacked' },
    });
    // 404 is the correct IDOR-safe response: a restaurant another owner doesn't own
    // does not exist from that owner's perspective.
    expect(patch.statusCode).toBe(404);
    expect(patch.statusCode).not.toBe(403);

    const del = await server.inject({
      method: 'DELETE',
      url: `/restaurants/${restaurantId}`,
      headers: { authorization: `Bearer ${owner2Token}` },
    });
    expect(del.statusCode).toBe(404);
    expect(del.statusCode).not.toBe(403);
  });

  it('diner token is rejected on all owner-only mutation endpoints', async () => {
    const endpoints: Array<{
      method: 'POST' | 'PATCH' | 'DELETE';
      url: string;
      payload?: Record<string, unknown>;
    }> = [
      { method: 'POST', url: '/restaurants', payload: {} },
      { method: 'PATCH', url: `/restaurants/${restaurantId}`, payload: {} },
      { method: 'DELETE', url: `/restaurants/${restaurantId}` },
      {
        method: 'POST',
        url: `/restaurants/${restaurantId}/tables`,
        payload: { name: 'x', maxPartySize: 2 },
      },
      {
        method: 'PATCH',
        url: `/restaurants/${restaurantId}/tables/fake-id`,
        payload: {},
      },
      { method: 'DELETE', url: `/restaurants/${restaurantId}/tables/fake-id` },
    ];

    for (const ep of endpoints) {
      const res = await server.inject({
        method: ep.method,
        url: ep.url,
        headers: { authorization: `Bearer ${dinerToken}` },
        ...(ep.payload !== undefined ? { payload: ep.payload } : {}),
      });
      expect(res.statusCode, `Expected 403 on ${ep.method} ${ep.url}`).toBe(403);
    }
  });
});
