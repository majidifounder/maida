/**
 * INVARIANT GUARDS · Reservation, Holds & Tenancy
 *
 * Regression guards for verified invariants (docs/architecture/INVARIANTS.md):
 *   INV-1   GiST exclusion constraint blocks overlapping unreleased holds at
 *           the DATABASE layer (independent of all application checks), and
 *           released holds (`releasedAt` set) stop blocking (partial index)
 *   INV-12  client-supplied tableIds must belong to the target restaurant
 *   —       tenant isolation: owner→404 on non-owned, diner→404 on non-own
 *           (docs/architecture/01-system-map.md §4)
 *   —       representative diner/owner routes respond for their own data
 *
 * Skipped/TODO guards map to backlog findings:
 *   M-1/CI-A1  staff dinerId accepts any user UUID (desired: rejected)
 *   GT-1       INV-8 quota exactness under concurrency (fixture cost — TODO)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@restaurant/db';
import { buildTestServer } from '../helpers/server.js';
import { loginUser, type TestCredentials } from '../helpers/auth.js';
import { cleanupTestUsers } from '../helpers/db.js';
import {
  createTestRestaurant,
  createTestTables,
  cleanupTestRestaurants,
  futureDatetime,
} from '../helpers/restaurant.js';

let server: FastifyInstance;
let owner: TestCredentials;
let ownerB: TestCredentials;
let diner: TestCredentials;
const userIds: string[] = [];
const restaurantIds: string[] = [];

beforeAll(async () => {
  server = await buildTestServer();
  [owner, ownerB, diner] = await Promise.all([
    loginUser(server, { role: 'owner' }),
    loginUser(server, { role: 'owner' }),
    loginUser(server, { role: 'diner' }),
  ]);
  userIds.push(owner.userId, ownerB.userId, diner.userId);
});

afterAll(async () => {
  await cleanupTestRestaurants(restaurantIds);
  await cleanupTestUsers(userIds);
  await server.close();
});

async function bookOnline(
  dinerToken: string,
  restaurantId: string,
  startsAt: string,
): Promise<{ id: string }> {
  const res = await server.inject({
    method: 'POST',
    url: '/reservations',
    headers: { authorization: `Bearer ${dinerToken}` },
    payload: { restaurantId, partySize: 2, startsAt, reservationType: 'STANDARD' },
  });
  if (res.statusCode !== 201) {
    throw new Error(`guard fixture booking failed: ${res.statusCode} ${res.body}`);
  }
  return (JSON.parse(res.body) as { reservation: { id: string } }).reservation;
}

describe('INV-1 · exclusion constraint is the DB-level arbiter of overlap', () => {
  it('rejects an overlapping unreleased hold with 23P01, and accepts it once the blocking hold is released', async () => {
    const restaurant = await createTestRestaurant(server, owner.accessToken);
    restaurantIds.push(restaurant.id);
    await createTestTables(server, restaurant.id, owner.accessToken, [
      { name: 'Guard Solo Table', maxPartySize: 4 },
    ]);

    // Two non-overlapping bookings on the single table (both via the real API).
    const resA = await bookOnline(diner.accessToken, restaurant.id, futureDatetime(58, 18));
    const resB = await bookOnline(diner.accessToken, restaurant.id, futureDatetime(58, 12));

    const holdsA = await prisma.$queryRaw<Array<{ startsAt: Date; endsAt: Date }>>`
      SELECT "startsAt", "endsAt" FROM "reservation_tables"
      WHERE "reservationId" = ${resA.id}::uuid
    `;
    expect(holdsA.length).toBeGreaterThan(0);
    const target = holdsA[0]!;

    // Bypass ALL application logic: move B's hold onto A's exact interval.
    // The GiST constraint (migration 20260705120000, tstzrange && WHERE
    // releasedAt IS NULL) must reject this — proving overlap protection does
    // not depend on service-layer checks.
    let sqlstate: string | undefined;
    try {
      await prisma.$executeRaw`
        UPDATE "reservation_tables"
        SET "startsAt" = ${target.startsAt}, "endsAt" = ${target.endsAt}
        WHERE "reservationId" = ${resB.id}::uuid
      `;
    } catch (err) {
      sqlstate = JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    }
    expect(sqlstate ?? '').toMatch(/23P01|no_overlap|exclusion/i);

    // Partial-index half of INV-1: releasing A's hold (releasedAt set, row
    // kept) must make the very same overlapping update succeed.
    await prisma.$executeRaw`
      UPDATE "reservation_tables" SET "releasedAt" = now()
      WHERE "reservationId" = ${resA.id}::uuid
    `;
    const moved = await prisma.$executeRaw`
      UPDATE "reservation_tables"
      SET "startsAt" = ${target.startsAt}, "endsAt" = ${target.endsAt}
      WHERE "reservationId" = ${resB.id}::uuid
    `;
    expect(moved).toBe(1);
  });
});

describe('INV-12 · client-supplied tableIds must belong to the restaurant', () => {
  it("walk-in with another restaurant's tableId is rejected and creates nothing", async () => {
    const restA = await createTestRestaurant(server, owner.accessToken);
    const restB = await createTestRestaurant(server, owner.accessToken);
    restaurantIds.push(restA.id, restB.id);
    await createTestTables(server, restA.id, owner.accessToken, [
      { name: 'A Table', maxPartySize: 4 },
    ]);
    const [foreignTable] = await createTestTables(server, restB.id, owner.accessToken, [
      { name: 'B Table', maxPartySize: 4 },
    ]);

    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restA.id}/reservations/walk-in`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { partySize: 2, guestName: 'Guard Guest', tableIds: [foreignTable!.id] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);

    const created = await prisma.reservation.count({ where: { restaurantId: restA.id } });
    expect(created).toBe(0);
  });
});

describe('Tenant isolation · non-owned data is rejected (no existence oracle)', () => {
  it("owner B cannot list owner A's restaurant reservations", async () => {
    const restA = await createTestRestaurant(server, owner.accessToken);
    restaurantIds.push(restA.id);

    const res = await server.inject({
      method: 'GET',
      url: `/restaurants/${restA.id}/reservations`,
      headers: { authorization: `Bearer ${ownerB.accessToken}` },
    });
    // Verified current behavior: the reservation module's assertOwnerAccess
    // throws ForbiddenError → 403 (reservation.service.ts:362-368), while the
    // restaurant module's assertRestaurantOwner → 404. Both are oracle-free
    // (403 fires for nonexistent restaurants too — the WHERE combines id AND
    // ownerId), but the codes are inconsistent across modules: BACKLOG NEW-L1.
    // If NEW-L1 is fixed (unified on 404), update this assertion + close the row.
    expect(res.statusCode).toBe(403);

    const missing = await server.inject({
      method: 'GET',
      url: `/restaurants/${randomUUID()}/reservations`,
      headers: { authorization: `Bearer ${ownerB.accessToken}` },
    });
    expect(missing.statusCode).toBe(403); // same code for nonexistent ⇒ no oracle
  });

  it("a diner cannot read another diner's reservation (404)", async () => {
    const rest = await createTestRestaurant(server, owner.accessToken);
    restaurantIds.push(rest.id);
    await createTestTables(server, rest.id, owner.accessToken, [
      { name: 'Iso Table', maxPartySize: 4 },
    ]);
    const reservation = await bookOnline(diner.accessToken, rest.id, futureDatetime(59, 18));

    const otherDiner = await loginUser(server, { role: 'diner' });
    userIds.push(otherDiner.userId);
    const res = await server.inject({
      method: 'GET',
      url: `/reservations/${reservation.id}`,
      headers: { authorization: `Bearer ${otherDiner.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('representative routes: diner lists own reservations 200; owner lists own restaurant 200', async () => {
    const rest = await createTestRestaurant(server, owner.accessToken);
    restaurantIds.push(rest.id);

    const dinerList = await server.inject({
      method: 'GET',
      url: '/reservations',
      headers: { authorization: `Bearer ${diner.accessToken}` },
    });
    expect(dinerList.statusCode).toBe(200);

    const ownerList = await server.inject({
      method: 'GET',
      url: `/restaurants/${rest.id}/reservations`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(ownerList.statusCode).toBe(200);
  });
});

describe('Open findings — desired invariants NOT yet held (skipped/TODO, do not delete)', () => {
  // BACKLOG M-1 / CI-A1 (= P0-3b): StaffCreateReservationSchema accepts any
  // user UUID as dinerId (reservation.schema.ts:73) — only FK existence is
  // enforced, so an owner can attach a reservation to an arbitrary account.
  // Desired: dinerId must reference a diner-role user with some consent
  // relationship. Skipped until M-1 is fixed; un-skip in the fixing PR.
  it.skip("M-1: staff reservation with an arbitrary (non-diner) user's UUID is rejected", async () => {
    const rest = await createTestRestaurant(server, owner.accessToken);
    restaurantIds.push(rest.id);
    await createTestTables(server, rest.id, owner.accessToken, [
      { name: 'M1 Table', maxPartySize: 4 },
    ]);
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${rest.id}/reservations/staff`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        partySize: 2,
        startsAt: futureDatetime(57, 18),
        guestName: 'M1 Guest',
        dinerId: ownerB.userId, // an OWNER's id — clearly not a consenting diner
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  // GT-1 (07-testing-review.md) / INV-8: quota exactness under concurrency is
  // implemented (pg_advisory_xact_lock, reservation.service.ts:403) but a
  // black-box guard needs an owner fixture sitting exactly at plan-limit−1,
  // which requires bulk-creating limit−1 reservations. TODO — implement with a
  // seeded fixture; until then INV-8 is registry-mapped to this TODO.
  it.todo('GT-1/INV-8: k concurrent bookings at the quota boundary admit exactly one');
});
