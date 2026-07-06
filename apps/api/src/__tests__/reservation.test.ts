import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@restaurant/db';
import { buildTestServer } from './helpers/server.js';
import { cleanupTestUsers } from './helpers/db.js';
import { loginUser } from './helpers/auth.js';
import {
  futureDate,
  futureDatetime,
  createTestRestaurant,
  createTestTables,
  cleanupTestRestaurants,
} from './helpers/restaurant.js';
import {
  createTestReservation,
  cleanupTestReservations,
  type TestReservation,
} from './helpers/reservation.js';

const createdUserIds: string[] = [];
const createdRestaurantIds: string[] = [];
const createdReservationIds: string[] = [];

let server: FastifyInstance;
let ownerToken: string;
let owner2Token: string;
let dinerToken: string;
let diner2Token: string;
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
  createdUserIds.push(
    owner.userId,
    owner2.userId,
    diner.userId,
    diner2.userId,
  );

  const r = await createTestRestaurant(server, ownerToken);
  restaurantId = r.id;
  createdRestaurantIds.push(restaurantId);

  await createTestTables(server, restaurantId, ownerToken, [
    { name: 'Table 1', maxPartySize: 2 },
    { name: 'Table 2', maxPartySize: 2 },
    { name: 'Booth A', maxPartySize: 6 },
  ]);
});

afterAll(async () => {
  await server.close();
  await cleanupTestReservations(createdReservationIds);
  await cleanupTestRestaurants(createdRestaurantIds);
  await cleanupTestUsers(createdUserIds);
});

describe('POST /reservations', () => {
  it('201 — diner creates a reservation with best-fit table allocation', async () => {
    const startsAt = futureDatetime(30, 19);

    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId,
        partySize: 2,
        startsAt,
        reservationType: 'STANDARD',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      reservation: TestReservation & {
        tables: Array<{ tableId: string; table: { maxPartySize: number } }>;
      };
    };

    expect(body.reservation.status).toBe('SCHEDULED');
    expect(body.reservation.partySize).toBe(2);
    expect(body.reservation.tables.length).toBeGreaterThan(0);
    expect(body.reservation.tables[0]!.table.maxPartySize).toBe(2);

    createdReservationIds.push(body.reservation.id);
  });

  it('401 — unauthenticated request rejected', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      payload: {
        restaurantId,
        partySize: 2,
        startsAt: futureDatetime(31, 19),
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('409 — conflict includes suggestedNextAvailableAt when no table free', async () => {
    const startsAt = futureDatetime(32, 20);

    const first = await createTestReservation(server, dinerToken, {
      restaurantId,
      partySize: 6,
      startsAt,
    });
    createdReservationIds.push(first.id);

    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${diner2Token}` },
      payload: {
        restaurantId,
        partySize: 6,
        startsAt,
        reservationType: 'STANDARD',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as {
      suggestedNextAvailableAt?: string;
    };
    expect(body.suggestedNextAvailableAt).toBeDefined();
  });

  it('CONCURRENCY — simultaneous bookings on single table: one succeeds, one gets 409', async () => {
    const soloRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(soloRestaurant.id);

    const [soloTable] = await createTestTables(server, soloRestaurant.id, ownerToken, [
      { name: 'Only Table', maxPartySize: 4 },
    ]);

    const startsAt = futureDatetime(33, 18);
    const startsAtDate = new Date(startsAt);

    const [resA, resB] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/reservations',
        headers: { authorization: `Bearer ${dinerToken}` },
        payload: {
          restaurantId: soloRestaurant.id,
          partySize: 2,
          startsAt,
          reservationType: 'STANDARD',
        },
      }),
      server.inject({
        method: 'POST',
        url: '/reservations',
        headers: { authorization: `Bearer ${diner2Token}` },
        payload: {
          restaurantId: soloRestaurant.id,
          partySize: 2,
          startsAt,
          reservationType: 'STANDARD',
        },
      }),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const success = resA.statusCode === 201 ? resA : resB;
    const body = JSON.parse(success.body) as {
      reservation: TestReservation & {
        tables: Array<{ tableId: string }>;
      };
    };
    createdReservationIds.push(body.reservation.id);

    expect(body.reservation.tables).toHaveLength(1);
    expect(body.reservation.tables[0]!.tableId).toBe(soloTable!.id);

    const activeHolds = await prisma.reservationTable.count({
      where: {
        tableId: soloTable!.id,
        releasedAt: null,
        startsAt: startsAtDate,
      },
    });
    expect(activeHolds).toBe(1);
  });
});

describe('GET /reservations', () => {
  it('200 — diner lists own reservations', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { reservations: unknown[] };
    expect(Array.isArray(body.reservations)).toBe(true);
  });
});

describe('PATCH /reservations/:id/cancel', () => {
  it('200 — diner cancels own reservation', async () => {
    const startsAt = futureDatetime(34, 14);
    const created = await createTestReservation(server, dinerToken, {
      restaurantId,
      partySize: 2,
      startsAt,
    });
    createdReservationIds.push(created.id);

    const res = await server.inject({
      method: 'PATCH',
      url: `/reservations/${created.id}/cancel`,
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { reservation: { status: string } };
    expect(body.reservation.status).toBe('CANCELLED');
  });
});

describe('Owner reservation management', () => {
  it('200 — owner lists restaurant reservations', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/reservations`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('200 — owner seats a scheduled reservation', async () => {
    const startsAt = futureDatetime(35, 19);
    const created = await createTestReservation(server, dinerToken, {
      restaurantId,
      partySize: 2,
      startsAt,
    });
    createdReservationIds.push(created.id);

    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${restaurantId}/reservations/${created.id}/seat`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { reservation: { status: string } };
    expect(body.reservation.status).toBe('SEATED');
  });

  it('403 — wrong owner cannot manage reservations', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/reservations`,
      headers: { authorization: `Bearer ${owner2Token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /restaurants/:id/availability', () => {
  it('200 — returns available time slots for party size', async () => {
    const date = futureDate(36);
    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restaurantId}/availability?date=${date}&partySize=2`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { times: unknown[] };
    expect(Array.isArray(body.times)).toBe(true);
  });
});

describe('SECURITY — dinerId from JWT only', () => {
  it('dinerId is never accepted from request body', async () => {
    const startsAt = futureDatetime(37, 19);
    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId,
        partySize: 2,
        startsAt,
        dinerId: '00000000-0000-0000-0000-000000000099',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { reservation: { id: string } };
    createdReservationIds.push(body.reservation.id);

    const listRes = await server.inject({
      method: 'GET',
      url: `/reservations/${body.reservation.id}`,
      headers: { authorization: `Bearer ${dinerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
  });
});
