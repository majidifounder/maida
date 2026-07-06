import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin, setOwnerPlan } from '../lib/auth-helpers.js';
import { addLocalDays, formatLocalDate } from '../lib/dates.js';

const TZ = 'America/New_York';

function localHour(iso: string, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(new Date(iso)),
  );
}

export async function runTimezoneJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test(
    'Timezone correctness',
    'late-night reservation filed under restaurant local calendar day',
    async () => {
      const owner = await registerAndLogin(ctx, 'owner');
      await setOwnerPlan(owner.userId, 'PRO');

      const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
        token: owner.accessToken,
        body: {
          name: 'Timezone E2E',
          description: 'Boundary test restaurant',
          cuisine: 'OTHER',
          address: '1 TZ St',
          city: 'New York',
          timezone: TZ,
        },
      });
      report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
      const restaurantId = rest.body.restaurant.id;
      ctx.trackRestaurant(restaurantId);

      await apiRequest(ctx, 'PATCH', `/restaurants/${restaurantId}/reservation-config`, {
        token: owner.accessToken,
        body: {
          timezone: TZ,
          openMinutes: 17 * 60,
          closeMinutes: 23 * 60 + 30,
        },
      });

      await apiRequest(ctx, 'POST', `/restaurants/${restaurantId}/tables`, {
        token: owner.accessToken,
        body: { name: 'TZ Table', minPartySize: 2, maxPartySize: 4 },
      });

      const localDate = addLocalDays(formatLocalDate(new Date(), TZ), 14, TZ);

      const avail = await apiRequest<{ times: Array<{ startsAt: string }> }>(
        ctx,
        'GET',
        `/restaurants/${restaurantId}/availability`,
        { query: { date: localDate, partySize: 2 } },
      );
      report.assert(avail.status === 200, `Availability failed: ${avail.status}`);
      report.assert(avail.body.times.length > 0, 'Expected late-day availability slots');

      const lateSlot = avail.body.times.find(
        (t) =>
          formatLocalDate(new Date(t.startsAt), TZ) === localDate &&
          localHour(t.startsAt, TZ) >= 21,
      );
      report.assert(!!lateSlot, 'Expected a late-night slot (>= 21:00 local) on target date');

      const diner = await registerAndLogin(ctx, 'diner');
      const book = await apiRequest<{ reservation: { id: string; startsAt: string } }>(
        ctx,
        'POST',
        '/reservations',
        {
          token: diner.accessToken,
          body: {
            restaurantId,
            partySize: 2,
            startsAt: lateSlot!.startsAt,
            reservationType: 'STANDARD',
          },
        },
      );
      report.assert(book.status === 201, `Book failed: ${book.status}`);
      ctx.trackReservation(book.body.reservation.id);

      const reservationLocalDay = formatLocalDate(
        new Date(book.body.reservation.startsAt),
        TZ,
      );
      report.assert(
        reservationLocalDay === localDate,
        `Reservation should be on local date ${localDate}, got ${reservationLocalDay}`,
      );

      const ownerList = await apiRequest<{
        reservations: Array<{ id: string }>;
        total: number;
      }>(ctx, 'GET', `/restaurants/${restaurantId}/reservations`, {
        token: owner.accessToken,
        query: { date: localDate },
      });
      report.assert(ownerList.status === 200, `Owner date filter failed: ${ownerList.status}`);
      report.assert(
        ownerList.body.reservations.some((r) => r.id === book.body.reservation.id),
        'Late-night reservation must appear on owner list for local date',
      );

      const wrongDay = addLocalDays(localDate, 1, TZ);
      const wrongList = await apiRequest<{ reservations: Array<{ id: string }> }>(
        ctx,
        'GET',
        `/restaurants/${restaurantId}/reservations`,
        {
          token: owner.accessToken,
          query: { date: wrongDay },
        },
      );
      report.assert(
        !wrongList.body.reservations.some((r) => r.id === book.body.reservation.id),
        'Reservation must not appear on the next local calendar day',
      );
    },
  );
}
