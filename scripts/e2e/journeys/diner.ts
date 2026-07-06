import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin, setOwnerPlan } from '../lib/auth-helpers.js';
import { futureDate, futureDatetime } from '../lib/dates.js';

export async function runDinerJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test('Diner journey', 'register → login → browse → book → list → cancel', async () => {
    const owner = await registerAndLogin(ctx, 'owner');
    await setOwnerPlan(owner.userId, 'PRO');

    const restRes = await apiRequest<{ restaurant: { id: string; name: string } }>(
      ctx,
      'POST',
      '/restaurants',
      {
        token: owner.accessToken,
        body: {
          name: 'E2E Diner Bistro',
          description: 'Diner journey test restaurant',
          cuisine: 'ITALIAN',
          address: '1 E2E Lane',
          city: 'E2ECity',
        },
      },
    );
    report.assert(restRes.status === 201, `Create restaurant failed: ${restRes.status}`);
    const restaurantId = restRes.body.restaurant.id;
    ctx.trackRestaurant(restaurantId);

    const tableRes = await apiRequest<{ table: { id: string } }>(
      ctx,
      'POST',
      `/restaurants/${restaurantId}/tables`,
      {
        token: owner.accessToken,
        body: { name: 'Table A', minPartySize: 1, maxPartySize: 4 },
      },
    );
    report.assert(tableRes.status === 201, `Create table failed: ${tableRes.status}`);

    const diner = await registerAndLogin(ctx, 'diner');

    const search = await apiRequest<{ restaurants: unknown[]; total: number }>(
      ctx,
      'GET',
      '/restaurants',
      { query: { city: 'E2ECity', page: 1, limit: 10 } },
    );
    report.assert(search.status === 200, `Search failed: ${search.status}`);
    report.assert(
      search.body.restaurants.some(
        (r) => (r as { id: string }).id === restaurantId,
      ),
      'Restaurant not found in search results',
    );

    const date = futureDate(10);
    const avail = await apiRequest<{ times: Array<{ startsAt: string }> }>(
      ctx,
      'GET',
      `/restaurants/${restaurantId}/availability`,
      { query: { date, partySize: 2 } },
    );
    report.assert(avail.status === 200, `Availability failed: ${avail.status}`);
    report.assert(avail.body.times.length > 0, 'No availability slots returned');

    const startsAt = avail.body.times[0]!.startsAt;

    const book = await apiRequest<{
      reservation: { id: string; status: string; reservationType: string };
    }>(ctx, 'POST', '/reservations', {
      token: diner.accessToken,
      body: {
        restaurantId,
        partySize: 2,
        startsAt,
        reservationType: 'STANDARD',
      },
    });
    report.assert(book.status === 201, `Create reservation failed: ${book.status}`);
    report.assert(book.body.reservation.status === 'SCHEDULED', 'Expected SCHEDULED status');
    ctx.trackReservation(book.body.reservation.id);

    const list = await apiRequest<{ reservations: Array<{ id: string }> }>(
      ctx,
      'GET',
      '/reservations',
      { token: diner.accessToken },
    );
    report.assert(list.status === 200, `List reservations failed: ${list.status}`);
    report.assert(
      list.body.reservations.some((r) => r.id === book.body.reservation.id),
      'Reservation missing from diner list',
    );

    const detail = await apiRequest(ctx, 'GET', `/reservations/${book.body.reservation.id}`, {
      token: diner.accessToken,
    });
    report.assert(detail.status === 200, `Get reservation failed: ${detail.status}`);

    const cancel = await apiRequest<{ reservation: { status: string } }>(
      ctx,
      'PATCH',
      `/reservations/${book.body.reservation.id}/cancel`,
      { token: diner.accessToken, body: {} },
    );
    report.assert(cancel.status === 200, `Cancel failed: ${cancel.status}`);
    report.assert(cancel.body.reservation.status === 'CANCELLED', 'Expected CANCELLED status');
  });

  await report.test(
    'Diner journey',
    'CUSTOM reservation returns informational fee only (no payment fields)',
    async () => {
      const owner = await registerAndLogin(ctx, 'owner');
      await setOwnerPlan(owner.userId, 'PRO');

      const restRes = await apiRequest<{ restaurant: { id: string } }>(
        ctx,
        'POST',
        '/restaurants',
        {
          token: owner.accessToken,
          body: {
            name: 'E2E Custom Fee Bistro',
            description: 'Custom reservation fee test',
            cuisine: 'FRENCH',
            address: '2 Fee Lane',
            city: 'FeeCity',
          },
        },
      );
      report.assert(restRes.status === 201, `Create restaurant failed: ${restRes.status}`);
      const restaurantId = restRes.body.restaurant.id;
      ctx.trackRestaurant(restaurantId);

      await apiRequest(ctx, 'PATCH', `/restaurants/${restaurantId}/reservation-config`, {
        token: owner.accessToken,
        body: { customFee: 25.5, extraHourFee: 10, feeCurrency: 'USD' },
      });

      await apiRequest(ctx, 'POST', `/restaurants/${restaurantId}/tables`, {
        token: owner.accessToken,
        body: { name: 'Fee Table', minPartySize: 2, maxPartySize: 6 },
      });

      const diner = await registerAndLogin(ctx, 'diner');
      const startsAt = futureDatetime(11, 20);

      const custom = await apiRequest<{
        reservation: {
          id: string;
          reservationType: string;
          customFeeSnapshot: string | null;
          extraHourFeeSnapshot: string | null;
          feeCurrency: string | null;
        };
      }>(ctx, 'POST', '/reservations', {
        token: diner.accessToken,
        body: {
          restaurantId,
          partySize: 4,
          startsAt,
          reservationType: 'CUSTOM',
          durationMins: 120,
        },
      });
      report.assert(custom.status === 201, `Custom reservation failed: ${custom.status}`);
      report.assert(
        custom.body.reservation.reservationType === 'CUSTOM',
        'Expected CUSTOM type',
      );
      report.assert(
        custom.body.reservation.customFeeSnapshot === '25.5',
        `Expected customFeeSnapshot 25.5, got ${custom.body.reservation.customFeeSnapshot}`,
      );
      report.assert(
        custom.body.reservation.extraHourFeeSnapshot === '10',
        'Expected extraHourFeeSnapshot',
      );
      report.assert(
        custom.body.reservation.feeCurrency === 'USD',
        'Expected feeCurrency USD',
      );

      const raw = JSON.stringify(custom.body);
      report.assert(!raw.includes('stripe'), 'Response must not reference payment processor');
      report.assert(!raw.includes('checkout'), 'Response must not include checkout/payment flow');
      report.assert(!raw.includes('charge'), 'Response must not include charge semantics');

      ctx.trackReservation(custom.body.reservation.id);
    },
  );
}
