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

describe('Phase 16 — custom duration (Extended + Until-close)', () => {
  async function configureCustomFees(
    targetRestaurantId: string,
    token: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${targetRestaurantId}/reservation-config`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        customFee: 10,
        extraHourFee: 25,
        feeCurrency: 'USD',
        maxExtraHours: 2,
        ...overrides,
      },
    });
    if (res.statusCode !== 200) {
      throw new Error(`configureCustomFees failed: ${res.statusCode} ${res.body}`);
    }
  }

  it('Extended — valid request within cap returns 201 with correct fee', async () => {
    const customRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(customRestaurant.id);
    await createTestTables(server, customRestaurant.id, ownerToken, [
      { name: 'Extended Table', maxPartySize: 4 },
    ]);
    await configureCustomFees(customRestaurant.id, ownerToken);

    const startsAt = futureDatetime(40, 19);
    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId: customRestaurant.id,
        partySize: 2,
        startsAt,
        reservationType: 'CUSTOM',
        durationMins: 150,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      reservation: {
        id: string;
        endsAt: string;
        wasCapped: boolean;
        estimatedFee: string | null;
        untilClose: boolean;
      };
    };
    createdReservationIds.push(body.reservation.id);

    const endsAt = new Date(body.reservation.endsAt);
    const start = new Date(startsAt);
    expect((endsAt.getTime() - start.getTime()) / 60_000).toBe(150);
    expect(body.reservation.wasCapped).toBe(false);
    expect(body.reservation.untilClose).toBe(false);
    expect(body.reservation.estimatedFee).toBe('35.00');
  });

  it('Extended — duration beyond cap returns 422 with maxDurationMins', async () => {
    const customRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(customRestaurant.id);
    await createTestTables(server, customRestaurant.id, ownerToken, [
      { name: 'Cap Table', maxPartySize: 4 },
    ]);
    await configureCustomFees(customRestaurant.id, ownerToken);

    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId: customRestaurant.id,
        partySize: 2,
        startsAt: futureDatetime(41, 19),
        reservationType: 'CUSTOM',
        durationMins: 211,
      },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as {
      maxDurationMins?: number;
      standardDurationMins?: number;
      maxExtraHours?: number;
    };
    expect(body.maxDurationMins).toBe(210);
    expect(body.standardDurationMins).toBe(90);
    expect(body.maxExtraHours).toBe(2);
  });

  it('Until-close — caps at standard + maxExtraHours when close is later', async () => {
    const customRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(customRestaurant.id);
    await createTestTables(server, customRestaurant.id, ownerToken, [
      { name: 'Until Close Table', maxPartySize: 4 },
    ]);
    await configureCustomFees(customRestaurant.id, ownerToken);

    const startsAt = futureDatetime(42, 19);
    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId: customRestaurant.id,
        partySize: 2,
        startsAt,
        reservationType: 'CUSTOM',
        untilClose: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      reservation: {
        id: string;
        endsAt: string;
        wasCapped: boolean;
        untilClose: boolean;
      };
    };
    createdReservationIds.push(body.reservation.id);

    const durationMins =
      (new Date(body.reservation.endsAt).getTime() - new Date(startsAt).getTime()) /
      60_000;
    expect(durationMins).toBe(210);
    expect(body.reservation.wasCapped).toBe(true);
    expect(body.reservation.untilClose).toBe(true);
  });

  it('Until-close — following reservation caps endsAt', async () => {
    const customRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(customRestaurant.id);
    await createTestTables(server, customRestaurant.id, ownerToken, [
      { name: 'Solo Until', maxPartySize: 4 },
    ]);
    await configureCustomFees(customRestaurant.id, ownerToken);

    const followingStart = futureDatetime(43, 21);
    const blocker = await createTestReservation(server, diner2Token, {
      restaurantId: customRestaurant.id,
      partySize: 2,
      startsAt: followingStart,
    });
    createdReservationIds.push(blocker.id);

    const startsAt = futureDatetime(43, 19);
    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId: customRestaurant.id,
        partySize: 2,
        startsAt,
        reservationType: 'CUSTOM',
        untilClose: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      reservation: { id: string; endsAt: string; wasCapped: boolean };
    };
    createdReservationIds.push(body.reservation.id);

    expect(new Date(body.reservation.endsAt).toISOString()).toBe(
      new Date(followingStart).toISOString(),
    );
    expect(body.reservation.wasCapped).toBe(true);
  });

  it('Until-close — insufficient window before close returns 409', async () => {
    const customRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(customRestaurant.id);
    await createTestTables(server, customRestaurant.id, ownerToken, [
      { name: 'Late Solo', maxPartySize: 4 },
    ]);
    await configureCustomFees(customRestaurant.id, ownerToken);

    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 44);
    d.setUTCHours(22, 46, 0, 0);
    const startsAt = d.toISOString();

    const res = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId: customRestaurant.id,
        partySize: 2,
        startsAt,
        reservationType: 'CUSTOM',
        untilClose: true,
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { suggestedNextAvailableAt?: string };
    expect(body.suggestedNextAvailableAt).toBeDefined();
  });

  it('STARTER plan — Extended and Until-close rejected by customReservations gate', async () => {
    const starterOwner = await loginUser(server, {
      role: 'owner',
      subscriptionPlan: 'STARTER',
    });
    createdUserIds.push(starterOwner.userId);

    const starterRestaurant = await createTestRestaurant(
      server,
      starterOwner.accessToken,
    );
    createdRestaurantIds.push(starterRestaurant.id);
    await prisma.subscription.update({
      where: { userId: starterOwner.userId },
      data: { plan: 'STARTER', status: 'ACTIVE', trialStartedAt: null },
    });
    await createTestTables(server, starterRestaurant.id, starterOwner.accessToken, [
      { name: 'Starter Table', maxPartySize: 4 },
    ]);

    const extended = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId: starterRestaurant.id,
        partySize: 2,
        startsAt: futureDatetime(45, 19),
        reservationType: 'CUSTOM',
        durationMins: 120,
      },
    });
    expect(extended.statusCode).toBe(422);

    const untilClose = await server.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${dinerToken}` },
      payload: {
        restaurantId: starterRestaurant.id,
        partySize: 2,
        startsAt: futureDatetime(45, 20),
        reservationType: 'CUSTOM',
        untilClose: true,
      },
    });
    expect(untilClose.statusCode).toBe(422);
  });

  it('CONCURRENCY — simultaneous Until-close on single table: one 201, one 409', async () => {
    const soloRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(soloRestaurant.id);
    await createTestTables(server, soloRestaurant.id, ownerToken, [
      { name: 'Only Until Table', maxPartySize: 4 },
    ]);
    await configureCustomFees(soloRestaurant.id, ownerToken);

    const startsAt = futureDatetime(46, 18);
    const [resA, resB] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/reservations',
        headers: { authorization: `Bearer ${dinerToken}` },
        payload: {
          restaurantId: soloRestaurant.id,
          partySize: 2,
          startsAt,
          reservationType: 'CUSTOM',
          untilClose: true,
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
          reservationType: 'CUSTOM',
          untilClose: true,
        },
      }),
    ]);

    expect([resA.statusCode, resB.statusCode].sort()).toEqual([201, 409]);
    const winner = resA.statusCode === 201 ? resA : resB;
    const body = JSON.parse(winner.body) as { reservation: { id: string } };
    createdReservationIds.push(body.reservation.id);
  });

  it('GET /restaurants/:id includes maxExtraHours', async () => {
    const customRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(customRestaurant.id);
    await configureCustomFees(customRestaurant.id, ownerToken, { maxExtraHours: 4 });

    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${customRestaurant.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { maxExtraHours: number };
    expect(body.maxExtraHours).toBe(4);
  });

  it('PATCH reservation-config persists maxExtraHours and rejects out of range', async () => {
    const customRestaurant = await createTestRestaurant(server, ownerToken);
    createdRestaurantIds.push(customRestaurant.id);

    const bad = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${customRestaurant.id}/reservation-config`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { maxExtraHours: 7 },
    });
    expect(bad.statusCode).toBe(422);

    const ok = await server.inject({
      method: 'PATCH',
      url: `/restaurants/${customRestaurant.id}/reservation-config`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { maxExtraHours: 3 },
    });
    expect(ok.statusCode).toBe(200);
    const body = JSON.parse(ok.body) as { config: { maxExtraHours: number } };
    expect(body.config.maxExtraHours).toBe(3);
  });
});
