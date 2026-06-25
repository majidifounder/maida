import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from './helpers/server.js';
import { cleanupTestUsers } from './helpers/db.js';
import { loginUser } from './helpers/auth.js';
import {
  futureDate,
  createTestRestaurant,
  createTestSlots,
  cleanupTestRestaurants,
} from './helpers/restaurant.js';
import {
  createTestBooking,
  cleanupTestBookings,
  type TestBooking,
} from './helpers/booking.js';

const createdUserIds: string[] = [];
const createdRestaurantIds: string[] = [];
const createdBookingIds: string[] = [];

let server: FastifyInstance;

let ownerToken: string;
let owner2Token: string;
let dinerToken: string;
let diner2Token: string;
let dinerUserId: string;
let diner2UserId: string;
let ownerUserId: string;
let owner2UserId: string;

let restaurantId: string;

beforeAll(async () => {
  server = await buildTestServer();

  const [owner, owner2, diner, diner2] = await Promise.all([
    loginUser(server, { role: 'owner' }),
    loginUser(server, { role: 'owner' }),
    loginUser(server, { role: 'diner' }),
    loginUser(server, { role: 'diner' }),
  ]);

  ownerToken = owner.accessToken;
  owner2Token = owner2.accessToken;
  dinerToken = diner.accessToken;
  diner2Token = diner2.accessToken;
  ownerUserId = owner.userId;
  owner2UserId = owner2.userId;
  dinerUserId = diner.userId;
  diner2UserId = diner2.userId;

  createdUserIds.push(ownerUserId, owner2UserId, dinerUserId, diner2UserId);

  const r = await createTestRestaurant(server, ownerToken);
  restaurantId = r.id;
  createdRestaurantIds.push(restaurantId);
});

afterAll(async () => {
  await server.close();
  await cleanupTestBookings(createdBookingIds);
  await cleanupTestRestaurants(createdRestaurantIds);
  await cleanupTestUsers(createdUserIds);
});

describe('POST /bookings', () => {
  it('201 — diner creates a booking; response has correct shape', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(30),
      count: 1,
      capacity: 10,
    });
    const slotId = slots[0]!.id;

    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: { restaurantId, slotId, partySize: 3 },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      booking: TestBooking & Record<string, unknown>;
    };

    expect(body.booking.id).toBeDefined();
    expect(body.booking.status).toBe('PENDING');
    expect(body.booking.partySize).toBe(3);
    expect(body.booking.restaurantId).toBe(restaurantId);
    expect(body.booking.slotId).toBe(slotId);
    expect(body.booking.slot).toBeDefined();
    expect(body.booking.restaurant).toBeDefined();

    createdBookingIds.push(body.booking.id);
  });

  it('SECURITY — dinerId is NEVER present in diner-facing create response', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(31),
      count: 1,
      capacity: 10,
    });

    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: { restaurantId, slotId: slots[0]!.id, partySize: 1 },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { booking: Record<string, unknown> };

    expect(body.booking).not.toHaveProperty('dinerId');
    createdBookingIds.push(body.booking.id as string);
  });

  it('slot available count decrements after a successful booking', async () => {
    const date = futureDate(32);
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date,
      count: 1,
      capacity: 6,
    });
    const slotId = slots[0]!.id;

    const before = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: `/restaurants/${restaurantId}/slots?date=${date}`,
        })
      ).body,
    ) as { slots: Array<{ id: string; available: number }> };
    expect(before.slots.find((s) => s.id === slotId)!.available).toBe(6);

    const booking = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId,
      partySize: 4,
    });
    createdBookingIds.push(booking.id);

    const after = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: `/restaurants/${restaurantId}/slots?date=${date}`,
        })
      ).body,
    ) as { slots: Array<{ id: string; available: number }> };
    expect(after.slots.find((s) => s.id === slotId)!.available).toBe(2);
  });

  it('409 — booking when partySize exceeds available seats', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(33),
      count: 1,
      capacity: 2,
    });

    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: { restaurantId, slotId: slots[0]!.id, partySize: 3 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('409 — booking when slot is fully booked (available = 0)', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(34),
      count: 1,
      capacity: 2,
    });
    const slotId = slots[0]!.id;

    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId,
      partySize: 2,
    });
    createdBookingIds.push(b.id);

    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: { restaurantId, slotId, partySize: 1 },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).not.toMatch(/\d+ seat/i);
  });

  it('409 — cannot book a slot in the past', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId,
        slotId: '00000000-0000-0000-0000-000000000000',
        partySize: 1,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404 — non-existent restaurant', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId: '00000000-0000-0000-0000-000000000000',
        slotId: '00000000-0000-0000-0000-000000000001',
        partySize: 1,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404 — slot belongs to a different restaurant', async () => {
    const r2 = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(r2.id);
    const slots2 = await createTestSlots(server, r2.id, ownerToken, {
      date: futureDate(35),
      count: 1,
      capacity: 5,
    });

    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: { restaurantId, slotId: slots2[0]!.id, partySize: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('401 — no token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      payload: { restaurantId, slotId: 'fake', partySize: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 — owner role cannot create a booking', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(36),
      count: 1,
      capacity: 5,
    });
    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { restaurantId, slotId: slots[0]!.id, partySize: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('422 — partySize of 0 is rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: { restaurantId, slotId: 'fake', partySize: 0 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('CONCURRENCY — only one booking succeeds when two race for the last seat', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(40),
      count: 1,
      capacity: 1,
    });
    const slotId = slots[0]!.id;

    const [res1, res2] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/bookings',
        headers: { authorization: `Bearer ${dinerToken}` },
        payload: { restaurantId, slotId, partySize: 1 },
      }),
      server.inject({
        method: 'POST',
        url: '/bookings',
        headers: { authorization: `Bearer ${diner2Token}` },
        payload: { restaurantId, slotId, partySize: 1 },
      }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const winner = res1.statusCode === 201 ? res1 : res2;
    const winnerBody = JSON.parse(winner.body) as { booking: { id: string } };
    createdBookingIds.push(winnerBody.booking.id);
  });
});

describe('GET /bookings', () => {
  let bookingId: string;

  beforeAll(async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(50),
      count: 1,
      capacity: 10,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 2,
    });
    bookingId = b.id;
    createdBookingIds.push(bookingId);
  });

  it('200 — returns own bookings with nested slot and restaurant', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      bookings: Array<Record<string, unknown>>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.bookings[0]!.slot).toBeDefined();
    expect(body.bookings[0]!.restaurant).toBeDefined();
  });

  it("200 — diner2 sees only their own bookings, not diner1's", async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/bookings',
      headers: { authorization: `Bearer ${diner2Token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { bookings: Array<{ id: string }> };
    expect(body.bookings.every((b) => b.id !== bookingId)).toBe(true);
  });

  it('dinerId absent from every booking in the list response', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/bookings',
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    const body = JSON.parse(res.body) as {
      bookings: Array<Record<string, unknown>>;
    };
    body.bookings.forEach((b) => expect(b).not.toHaveProperty('dinerId'));
  });

  it('status filter returns only matching bookings', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/bookings?status=PENDING',
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    const body = JSON.parse(res.body) as { bookings: Array<{ status: string }> };
    body.bookings.forEach((b) => expect(b.status).toBe('PENDING'));
  });

  it('401 — no token', async () => {
    const res = await server.inject({ method: 'GET', url: '/bookings' });
    expect(res.statusCode).toBe(401);
  });

  it('403 — owner cannot call GET /bookings', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/bookings',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /bookings/:id', () => {
  let bookingId: string;

  beforeAll(async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(55),
      count: 1,
      capacity: 5,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 1,
    });
    bookingId = b.id;
    createdBookingIds.push(bookingId);
  });

  it('200 — diner retrieves their own booking', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/bookings/${bookingId}`,
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.id).toBe(bookingId);
  });

  it("404 — diner2 cannot retrieve diner1's booking", async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/bookings/${bookingId}`,
      headers: { authorization: `Bearer ${diner2Token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404 — non-existent booking ID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/bookings/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /bookings/:id/cancel', () => {
  it('200 — diner cancels own booking; status becomes CANCELLED', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(60),
      count: 1,
      capacity: 8,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 3,
    });
    createdBookingIds.push(b.id);

    const res = await server.inject({
      method: 'PATCH',
      url: `/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { booking: { status: string } };
    expect(body.booking.status).toBe('CANCELLED');
  });

  it('slot available count is restored after diner cancels', async () => {
    const date = futureDate(61);
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date,
      count: 1,
      capacity: 6,
    });
    const slotId = slots[0]!.id;

    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId,
      partySize: 4,
    });
    createdBookingIds.push(b.id);

    const mid = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: `/restaurants/${restaurantId}/slots?date=${date}`,
        })
      ).body,
    ) as { slots: Array<{ id: string; available: number }> };
    expect(mid.slots.find((s) => s.id === slotId)!.available).toBe(2);

    await server.inject({
      method: 'PATCH',
      url: `/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${dinerToken}` },
    });

    const after = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: `/restaurants/${restaurantId}/slots?date=${date}`,
        })
      ).body,
    ) as { slots: Array<{ id: string; available: number }> };
    expect(after.slots.find((s) => s.id === slotId)!.available).toBe(6);
  });

  it('409 — double-cancel returns conflict', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(62),
      count: 1,
      capacity: 5,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 1,
    });
    createdBookingIds.push(b.id);

    await server.inject({
      method: 'PATCH',
      url: `/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${dinerToken}` },
    });

    const second = await server.inject({
      method: 'PATCH',
      url: `/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(second.statusCode).toBe(409);
  });

  it("404 — diner2 cannot cancel diner1's booking", async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(63),
      count: 1,
      capacity: 5,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 1,
    });
    createdBookingIds.push(b.id);

    const res = await server.inject({
      method: 'PATCH',
      url: `/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${diner2Token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /restaurants/:id/bookings', () => {
  let bookingId: string;
  let slotDate: string;

  beforeAll(async () => {
    slotDate = futureDate(70);
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: slotDate,
      count: 1,
      capacity: 10,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 2,
    });
    bookingId = b.id;
    createdBookingIds.push(bookingId);
  });

  it('200 — owner sees bookings for their own restaurant', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/bookings`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      bookings: Array<{ id: string }>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.bookings.some((b) => b.id === bookingId)).toBe(true);
  });

  it('dinerId IS present in owner-facing booking list', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/bookings`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const body = JSON.parse(res.body) as {
      bookings: Array<{ id: string; dinerId?: string; diner?: { email: string } }>;
    };
    const target = body.bookings.find((b) => b.id === bookingId)!;
    expect(target.dinerId).toBe(dinerUserId);
    expect(target.diner?.email).toBeDefined();
  });

  it('date filter returns only bookings for that date', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/bookings?date=${slotDate}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { bookings: Array<{ id: string }> };
    expect(body.bookings.some((b) => b.id === bookingId)).toBe(true);
  });

  it("403 — owner2 cannot see owner1's restaurant bookings", async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/bookings`,
      headers: { authorization: `Bearer ${owner2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 — diner cannot call owner booking list endpoint', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/bookings`,
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /restaurants/:id/bookings/:bookingId/confirm', () => {
  let bookingId: string;

  beforeAll(async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(80),
      count: 1,
      capacity: 5,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 2,
    });
    bookingId = b.id;
    createdBookingIds.push(bookingId);
  });

  it('200 — owner confirms a PENDING booking; status becomes CONFIRMED', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/bookings/${bookingId}/confirm`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { booking: { status: string } };
    expect(body.booking.status).toBe('CONFIRMED');
  });

  it('409 — confirming an already-CONFIRMED booking returns conflict', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/bookings/${bookingId}/confirm`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it("403 — owner2 cannot confirm a booking at owner1's restaurant", async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(81),
      count: 1,
      capacity: 5,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 1,
    });
    createdBookingIds.push(b.id);

    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/bookings/${b.id}/confirm`,
      headers: { authorization: `Bearer ${owner2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 — non-existent booking ID', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/bookings/00000000-0000-0000-0000-000000000000/confirm`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /restaurants/:id/bookings/:bookingId/cancel', () => {
  it('200 — owner cancels booking; status CANCELLED; slot seats restored', async () => {
    const date = futureDate(90);
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date,
      count: 1,
      capacity: 8,
    });
    const slotId = slots[0]!.id;

    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId,
      partySize: 5,
    });
    createdBookingIds.push(b.id);

    const mid = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: `/restaurants/${restaurantId}/slots?date=${date}`,
        })
      ).body,
    ) as { slots: Array<{ id: string; available: number }> };
    expect(mid.slots.find((s) => s.id === slotId)!.available).toBe(3);

    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (JSON.parse(res.body) as { booking: { status: string } }).booking.status,
    ).toBe('CANCELLED');

    const after = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: `/restaurants/${restaurantId}/slots?date=${date}`,
        })
      ).body,
    ) as { slots: Array<{ id: string; available: number }> };
    expect(after.slots.find((s) => s.id === slotId)!.available).toBe(8);
  });

  it('409 — owner double-cancel returns conflict', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(91),
      count: 1,
      capacity: 5,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 1,
    });
    createdBookingIds.push(b.id);

    await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    const second = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(second.statusCode).toBe(409);
  });

  it("403 — owner2 cannot cancel a booking at owner1's restaurant", async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(92),
      count: 1,
      capacity: 5,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 1,
    });
    createdBookingIds.push(b.id);

    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/bookings/${b.id}/cancel`,
      headers: { authorization: `Bearer ${owner2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Security invariants', () => {
  it('dinerId is absent from every diner-facing endpoint', async () => {
    const slots = await createTestSlots(server, restaurantId, ownerToken, {
      date: futureDate(95),
      count: 1,
      capacity: 5,
    });
    const b = await createTestBooking(server, dinerToken, {
      restaurantId,
      slotId: slots[0]!.id,
      partySize: 1,
    });
    createdBookingIds.push(b.id);

    const listRes = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: '/bookings',
          headers: { authorization: `Bearer ${dinerToken}` },
        })
      ).body,
    ) as { bookings: Array<Record<string, unknown>> };
    listRes.bookings.forEach((booking) => {
      expect(booking).not.toHaveProperty('dinerId');
    });

    const singleRes = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: `/bookings/${b.id}`,
          headers: { authorization: `Bearer ${dinerToken}` },
        })
      ).body,
    ) as Record<string, unknown>;
    expect(singleRes).not.toHaveProperty('dinerId');
  });

  it('dinerId IS present in owner-facing booking responses', async () => {
    const listRes = JSON.parse(
      (
        await server.inject({
          method: 'GET',
          url: `/restaurants/${restaurantId}/bookings`,
          headers: { authorization: `Bearer ${ownerToken}` },
        })
      ).body,
    ) as { bookings: Array<Record<string, unknown>> };

    if (listRes.bookings.length > 0) {
      expect(listRes.bookings[0]).toHaveProperty('dinerId');
    }
  });

  it('diner role is blocked from all owner booking endpoints', async () => {
    const endpoints: Array<{ method: 'GET' | 'PATCH'; url: string }> = [
      { method: 'GET', url: `/restaurants/${restaurantId}/bookings` },
      {
        method: 'PATCH',
        url: `/restaurants/${restaurantId}/bookings/fake/confirm`,
      },
      {
        method: 'PATCH',
        url: `/restaurants/${restaurantId}/bookings/fake/cancel`,
      },
    ];

    for (const ep of endpoints) {
      const res = await server.inject({
        method: ep.method,
        url: ep.url,
        headers: { authorization: `Bearer ${dinerToken}` },
      });
      expect(res.statusCode, `Expected 403 on ${ep.method} ${ep.url}`).toBe(
        403,
      );
    }
  });
});
