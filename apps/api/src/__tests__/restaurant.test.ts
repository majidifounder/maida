import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from './helpers/server.js';
import { cleanupTestUsers } from './helpers/db.js';
import { loginUser } from './helpers/auth.js';
import {
  futureDate,
  futureDatetime,
  createTestRestaurant,
  createTestSlots,
  cleanupTestRestaurants,
  type TestRestaurant,
  type TestSlot,
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

    await createTestSlots(server, searchRestaurantId, ownerToken, {
      date: futureDate(5),
      count: 2,
      capacity: 8,
    });
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

  it('200 — date + partySize availability filter finds restaurant with slots', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?date=${futureDate(5)}&partySize=4&city=${encodeURIComponent(searchCity)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { restaurants: Array<{ id: string }> };
    expect(body.restaurants.some((r) => r.id === searchRestaurantId)).toBe(true);
  });

  it('200 — partySize larger than any slot capacity returns 0 for that city', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?date=${futureDate(5)}&partySize=999&city=${encodeURIComponent(searchCity)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { total: number };
    expect(body.total).toBe(0);
  });

  it('200 — far-future date with no slots returns 0', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants?date=2099-01-01&partySize=2&city=${encodeURIComponent(searchCity)}`,
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

describe('POST /restaurants/:id/slots', () => {
  let restaurantId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
  });

  it('201 — bulk creates slots; returns correct count and shape', async () => {
    const date = futureDate(10);
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restaurantId}/slots`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        slots: [
          { startsAt: `${date}T12:00:00.000Z`, capacity: 10 },
          { startsAt: `${date}T14:00:00.000Z`, capacity: 6 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { slots: TestSlot[] };
    expect(body.slots).toHaveLength(2);
    expect(body.slots[0]!.capacity).toBe(10);
    expect(body.slots[0]!.id).toBeDefined();
  });

  it('403 — cross-owner slot creation is rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restaurantId}/slots`,
      headers: { authorization: `Bearer ${owner2Token}` },
      payload: { slots: [{ startsAt: futureDatetime(10, 16), capacity: 5 }] },
    });
    // Returns 404 (not 403) for IDOR safety — 403 would reveal the resource exists.
    expect(res.statusCode).toBe(404);
  });

  it('422 — empty slots array is rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restaurantId}/slots`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { slots: [] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 — more than 50 slots in one request is rejected', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      startsAt: futureDatetime(20, i % 12),
      capacity: 5,
    }));
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restaurantId}/slots`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { slots: tooMany },
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 — capacity of 0 is rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restaurantId}/slots`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { slots: [{ startsAt: futureDatetime(10, 18), capacity: 0 }] },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /restaurants/:id/slots', () => {
  let restaurantId: string;
  let slotId: string;
  const slotDate = futureDate(15);

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);

    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: slotDate,
      count: 3,
      capacity: 8,
    });
    slotId = slots[0]!.id;
  });

  it('200 — returns slots with correct shape', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=${slotDate}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { slots: Array<Record<string, unknown>> };
    expect(body.slots).toHaveLength(3);
    expect(body.slots[0]!.id).toBeDefined();
    expect(body.slots[0]!.startsAt).toBeDefined();
    expect(body.slots[0]!.capacity).toBe(8);
    expect(body.slots[0]!.available).toBe(8);
  });

  it('SECURITY — booked field is NEVER present in public slot response', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=${slotDate}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { slots: Array<Record<string, unknown>> };

    body.slots.forEach((slot) => {
      expect(slot).not.toHaveProperty('booked');
    });
  });

  it('200 — second identical request returns consistent data (cache layer)', async () => {
    const first = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=${slotDate}`,
    });
    const second = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=${slotDate}`,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toEqual(JSON.parse(second.body));
  });

  it('200 — cache is invalidated after slot update (PATCH changes capacity)', async () => {
    const before = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=${slotDate}`,
    });
    const beforeBody = JSON.parse(before.body) as {
      slots: Array<{ id: string; capacity: number }>;
    };
    const originalCapacity = beforeBody.slots.find((s) => s.id === slotId)!.capacity;

    await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/slots/${slotId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { capacity: originalCapacity + 5 },
    });

    const after = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=${slotDate}`,
    });
    const afterBody = JSON.parse(after.body) as {
      slots: Array<{ id: string; capacity: number; available: number }>;
    };
    const updatedSlot = afterBody.slots.find((s) => s.id === slotId)!;

    expect(updatedSlot.capacity).toBe(originalCapacity + 5);
    expect(updatedSlot.available).toBe(originalCapacity + 5);
  });

  it('200 — slots for a date with no slots returns empty array', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=2099-12-31`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { slots: unknown[] };
    expect(body.slots).toHaveLength(0);
  });

  it('404 — non-existent restaurant ID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/restaurants/00000000-0000-0000-0000-000000000000/slots?date=2099-01-01',
    });
    expect(res.statusCode).toBe(404);
  });

  it('422 — missing date query param', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots`,
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 — malformed date (not YYYY-MM-DD)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=tomorrow`,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('PATCH /restaurants/:id/slots/:slotId', () => {
  let restaurantId: string;
  let slotId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      count: 1,
    });
    slotId = slots[0]!.id;
  });

  it('200 — owner updates slot capacity', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/slots/${slotId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { capacity: 25 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { slot: { capacity: number } };
    expect(body.slot.capacity).toBe(25);
  });

  it('403 — cross-owner slot update is rejected', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/slots/${slotId}`,
      headers: { authorization: `Bearer ${owner2Token}` },
      payload: { capacity: 1 },
    });
    // Returns 404 (not 403) for IDOR safety — 403 would reveal the resource exists.
    expect(res.statusCode).toBe(404);
  });

  it('404 — non-existent slot ID', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/slots/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { capacity: 5 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /restaurants/:id/slots/:slotId', () => {
  let restaurantId: string;

  beforeAll(async () => {
    const r = await createTestRestaurant(server, ownerToken);
    restaurantId = r.id;
    createdRestaurantIds.push(restaurantId);
  });

  it('204 — owner soft-deletes a slot', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      count: 1,
    });
    const deletedSlotId = slots[0]!.id;
    const date = futureDate(1);

    const res = await server.inject({
      method: 'DELETE',
      url: `/restaurants/${restaurantId}/slots/${deletedSlotId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(204);

    const listing = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/slots?date=${date}`,
    });
    const body = JSON.parse(listing.body) as { slots: Array<{ id: string }> };
    expect(body.slots.every((s) => s.id !== deletedSlotId)).toBe(true);
  });

  it('403 — cross-owner slot delete is rejected', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      count: 1,
      date: futureDate(2),
    });
    const deletedSlotId = slots[0]!.id;

    const res = await server.inject({
      method: 'DELETE',
      url: `/restaurants/${restaurantId}/slots/${deletedSlotId}`,
      headers: { authorization: `Bearer ${owner2Token}` },
    });
    // Returns 404 (not 403) for IDOR safety — 403 would reveal the resource exists.
    expect(res.statusCode).toBe(404);
  });

  it('404 — non-existent slot returns 404', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: `/restaurants/${restaurantId}/slots/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(404);
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
        url: `/restaurants/${restaurantId}/slots`,
        payload: { slots: [] },
      },
      {
        method: 'PATCH',
        url: `/restaurants/${restaurantId}/slots/fake-id`,
        payload: {},
      },
      { method: 'DELETE', url: `/restaurants/${restaurantId}/slots/fake-id` },
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
