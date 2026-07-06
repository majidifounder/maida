import { prisma } from '@restaurant/db';
import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin, setOwnerPlan } from '../lib/auth-helpers.js';
import { futureDate, futureDatetime } from '../lib/dates.js';

async function setupOwnerRestaurant(
  ctx: E2eContext,
  opts: { seatingMode?: 'LOCKED' | 'FLEXIBLE'; plan?: 'STARTER' | 'PRO' | 'PREMIUM' } = {},
) {
  const owner = await registerAndLogin(ctx, 'owner');
  await setOwnerPlan(owner.userId, opts.plan ?? 'PRO');

  const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
    token: owner.accessToken,
    body: {
      name: `E2E Owner ${opts.seatingMode ?? 'LOCKED'} ${Date.now()}`,
      description: 'Owner journey restaurant',
      cuisine: 'JAPANESE',
      address: '3 Owner St',
      city: 'OwnerCity',
    },
  });
  if (rest.status !== 201) throw new Error(`Create restaurant failed: ${rest.status}`);
  ctx.trackRestaurant(rest.body.restaurant.id);

  if (opts.seatingMode) {
    await apiRequest(ctx, 'PATCH', `/restaurants/${rest.body.restaurant.id}/reservation-config`, {
      token: owner.accessToken,
      body: { seatingMode: opts.seatingMode },
    });
  }

  return { owner, restaurantId: rest.body.restaurant.id };
}

export async function runOwnerJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test('Owner journey', 'LOCKED seating — tables, turn-time, availability', async () => {
    const { owner, restaurantId } = await setupOwnerRestaurant(ctx, {
      seatingMode: 'LOCKED',
    });

    const table = await apiRequest<{ table: { id: string } }>(
      ctx,
      'POST',
      `/restaurants/${restaurantId}/tables`,
      {
        token: owner.accessToken,
        body: { name: 'Locked T1', minPartySize: 2, maxPartySize: 4 },
      },
    );
    report.assert(table.status === 201, `Create table failed: ${table.status}`);

    const rule = await apiRequest(ctx, 'POST', `/restaurants/${restaurantId}/turn-time-rules`, {
      token: owner.accessToken,
      body: { minPartySize: 1, maxPartySize: 4, durationMins: 90 },
    });
    report.assert(rule.status === 201, `Turn-time rule failed: ${rule.status}`);

    const date = futureDate(12);
    const avail = await apiRequest<{ times: unknown[] }>(
      ctx,
      'GET',
      `/restaurants/${restaurantId}/availability`,
      { query: { date, partySize: 2 } },
    );
    report.assert(avail.status === 200, `Availability failed: ${avail.status}`);
    report.assert(avail.body.times.length > 0, 'Expected availability times');
  });

  await report.test(
    'Owner journey',
    'FLEXIBLE seating — combination + full reservation lifecycle + override audit',
    async () => {
      const { owner, restaurantId } = await setupOwnerRestaurant(ctx, {
        seatingMode: 'FLEXIBLE',
        plan: 'PRO',
      });

      const t1 = await apiRequest<{ table: { id: string } }>(
        ctx,
        'POST',
        `/restaurants/${restaurantId}/tables`,
        { token: owner.accessToken, body: { name: 'Flex A', minPartySize: 2, maxPartySize: 4 } },
      );
      const t2 = await apiRequest<{ table: { id: string } }>(
        ctx,
        'POST',
        `/restaurants/${restaurantId}/tables`,
        { token: owner.accessToken, body: { name: 'Flex B', minPartySize: 2, maxPartySize: 4 } },
      );
      report.assert(t1.status === 201 && t2.status === 201, 'Table creation failed');

      const combo = await apiRequest<{ combination: { id: string } }>(
        ctx,
        'POST',
        `/restaurants/${restaurantId}/combinations`,
        {
          token: owner.accessToken,
          body: {
            name: 'Merged',
            minPartySize: 5,
            maxPartySize: 8,
            tableIds: [t1.body.table.id, t2.body.table.id],
          },
        },
      );
      report.assert(combo.status === 201, `Combination failed: ${combo.status}`);

      const diner = await registerAndLogin(ctx, 'diner');
      const startsAt = futureDatetime(13, 18);

      const booked = await apiRequest<{ reservation: { id: string; status: string } }>(
        ctx,
        'POST',
        '/reservations',
        {
          token: diner.accessToken,
          body: {
            restaurantId,
            partySize: 2,
            startsAt,
            reservationType: 'STANDARD',
          },
        },
      );
      report.assert(booked.status === 201, `Book failed: ${booked.status}`);
      const reservationId = booked.body.reservation.id;
      ctx.trackReservation(reservationId);

      const seat = await apiRequest<{ reservation: { status: string } }>(
        ctx,
        'PATCH',
        `/restaurants/${restaurantId}/reservations/${reservationId}/seat`,
        { token: owner.accessToken },
      );
      report.assert(seat.status === 200, `Seat failed: ${seat.status}`);
      report.assert(seat.body.reservation.status === 'SEATED', 'Expected SEATED');

      const ownerRelogin = await apiRequest<{ accessToken: string }>(
        ctx,
        'POST',
        '/auth/login',
        { body: { email: owner.email, password: owner.password } },
      );
      report.assert(ownerRelogin.status === 200, `Owner re-login failed: ${ownerRelogin.status}`);
      const activeOwnerToken = ownerRelogin.body.accessToken;

      const walkIn = await apiRequest<{ reservation: { id: string; source: string; status: string } }>(
        ctx,
        'POST',
        `/restaurants/${restaurantId}/reservations/walk-in`,
        {
          token: activeOwnerToken,
          body: { partySize: 2, guestName: 'Walk-in Guest' },
        },
      );
      report.assert(walkIn.status === 201, `Walk-in failed: ${walkIn.status}`);
      report.assert(walkIn.body.reservation.source === 'WALK_IN', 'Expected WALK_IN source');
      ctx.trackReservation(walkIn.body.reservation.id);

      const extend = await apiRequest(
        ctx,
        'PATCH',
        `/restaurants/${restaurantId}/reservations/${walkIn.body.reservation.id}/extend`,
        {
          token: activeOwnerToken,
          body: { additionalMins: 30 },
        },
      );
      report.assert(extend.status === 200, `Extend failed: ${extend.status}`);

      const freeEarly = await apiRequest(
        ctx,
        'PATCH',
        `/restaurants/${restaurantId}/reservations/${walkIn.body.reservation.id}/free-early`,
        { token: activeOwnerToken },
      );
      report.assert(freeEarly.status === 200, `Free early failed: ${freeEarly.status}`);

      const noshowBook = await apiRequest<{ reservation: { id: string } }>(
        ctx,
        'POST',
        '/reservations',
        {
          token: diner.accessToken,
          body: {
            restaurantId,
            partySize: 2,
            startsAt: futureDatetime(13, 20),
            reservationType: 'STANDARD',
          },
        },
      );
      report.assert(noshowBook.status === 201, `Second book failed: ${noshowBook.status}`);
      ctx.trackReservation(noshowBook.body.reservation.id);

      const noshow = await apiRequest<{ reservation: { status: string } }>(
        ctx,
        'PATCH',
        `/restaurants/${restaurantId}/reservations/${noshowBook.body.reservation.id}/no-show`,
        { token: activeOwnerToken },
      );
      report.assert(noshow.status === 200, `No-show failed: ${noshow.status}`);
      report.assert(noshow.body.reservation.status === 'NO_SHOW', 'Expected NO_SHOW');

      const cancelBook = await apiRequest<{ reservation: { id: string } }>(
        ctx,
        'POST',
        '/reservations',
        {
          token: diner.accessToken,
          body: {
            restaurantId,
            partySize: 2,
            startsAt: futureDatetime(13, 21),
            reservationType: 'STANDARD',
          },
        },
      );
      report.assert(cancelBook.status === 201, `Third book failed: ${cancelBook.status}`);
      ctx.trackReservation(cancelBook.body.reservation.id);

      const ownerCancel = await apiRequest<{ reservation: { status: string } }>(
        ctx,
        'PATCH',
        `/restaurants/${restaurantId}/reservations/${cancelBook.body.reservation.id}/cancel`,
        { token: activeOwnerToken, body: { reason: 'Kitchen closed early' } },
      );
      report.assert(ownerCancel.status === 200, `Owner cancel failed: ${ownerCancel.status}`);
      report.assert(
        ownerCancel.body.reservation.status === 'CANCELLED',
        'Expected CANCELLED',
      );

      const overrideStart = futureDatetime(13, 22);
      const overrideEnd = futureDatetime(13, 23);
      const override = await apiRequest<{ reservation: { id: string } }>(
        ctx,
        'POST',
        `/restaurants/${restaurantId}/reservations/override`,
        {
          token: activeOwnerToken,
          body: {
            partySize: 2,
            startsAt: overrideStart,
            endsAt: overrideEnd,
            tableIds: [t1.body.table.id],
            guestName: 'Override Guest',
            reason: 'VIP manual allocation for E2E test',
          },
        },
      );
      report.assert(override.status === 201, `Override failed: ${override.status}`);
      ctx.trackReservation(override.body.reservation.id);

      const overrideRow = await prisma.reservation.findUnique({
        where: { id: override.body.reservation.id },
        select: { isOverride: true },
      });
      report.assert(overrideRow?.isOverride === true, 'Expected isOverride true in database');

      const audit = await prisma.auditLog.findFirst({
        where: {
          actorId: owner.userId,
          action: 'reservation.override_created',
          entityId: override.body.reservation.id,
        },
      });
      report.assert(!!audit, 'Override must be written to audit log with owner identity');

      const list = await apiRequest(
        ctx,
        'GET',
        `/restaurants/${restaurantId}/reservations`,
        { token: activeOwnerToken },
      );
      report.assert(list.status === 200, `Owner list reservations failed: ${list.status}`);
    },
  );
}
