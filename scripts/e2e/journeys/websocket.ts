import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin, setOwnerPlan } from '../lib/auth-helpers.js';
import { futureDatetime } from '../lib/dates.js';
import { closeWs, connectOwnerWs, waitForEvent } from '../lib/ws.js';

function wsBase(httpBase: string): string {
  return httpBase.replace(/^http/, 'ws');
}

export async function runWebSocketJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;
  const wsUrl = wsBase(ctx.base);

  await report.test(
    'WebSocket',
    'owner receives live reservation events; wrong owner denied',
    async () => {
      const owner = await registerAndLogin(ctx, 'owner');
      const owner2 = await registerAndLogin(ctx, 'owner');
      await setOwnerPlan(owner.userId, 'PRO');
      await setOwnerPlan(owner2.userId, 'PRO');

      const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
        token: owner.accessToken,
        body: {
          name: 'WS Test Bistro',
          description: 'WebSocket journey',
          cuisine: 'ITALIAN',
          address: '1 WS Ave',
          city: 'WSCity',
        },
      });
      report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
      const restaurantId = rest.body.restaurant.id;
      ctx.trackRestaurant(restaurantId);

      await apiRequest(ctx, 'POST', `/restaurants/${restaurantId}/tables`, {
        token: owner.accessToken,
        body: { name: 'WS Table', minPartySize: 2, maxPartySize: 4 },
      });

      const { ws, messages } = await connectOwnerWs(wsUrl, owner.accessToken, restaurantId);
      await waitForEvent(messages, 'ws.connected');

      const diner = await registerAndLogin(ctx, 'diner');
      const startsAt = futureDatetime(15, 19);

      const created = await apiRequest<{ reservation: { id: string } }>(
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
      report.assert(created.status === 201, `Create reservation failed: ${created.status}`);
      ctx.trackReservation(created.body.reservation.id);

      await waitForEvent(messages, 'reservation.created');

      const extend = await apiRequest(
        ctx,
        'PATCH',
        `/restaurants/${restaurantId}/reservations/${created.body.reservation.id}/extend`,
        { token: owner.accessToken, body: { additionalMins: 15 } },
      );
      report.assert(extend.status === 200, `Extend failed: ${extend.status}`);
      await waitForEvent(messages, 'reservation.extended');

      const cancel = await apiRequest(
        ctx,
        'PATCH',
        `/restaurants/${restaurantId}/reservations/${created.body.reservation.id}/cancel`,
        { token: owner.accessToken, body: {} },
      );
      report.assert(cancel.status === 200, `Cancel failed: ${cancel.status}`);
      await waitForEvent(messages, 'reservation.cancelled');

      const noshowBook = await apiRequest<{ reservation: { id: string } }>(
        ctx,
        'POST',
        '/reservations',
        {
          token: diner.accessToken,
          body: {
            restaurantId,
            partySize: 2,
            startsAt: futureDatetime(15, 20),
            reservationType: 'STANDARD',
          },
        },
      );
      report.assert(noshowBook.status === 201, `Second book failed: ${noshowBook.status}`);
      ctx.trackReservation(noshowBook.body.reservation.id);
      await waitForEvent(messages, 'reservation.created');

      const noshow = await apiRequest(
        ctx,
        'PATCH',
        `/restaurants/${restaurantId}/reservations/${noshowBook.body.reservation.id}/no-show`,
        { token: owner.accessToken },
      );
      report.assert(noshow.status === 200, `No-show failed: ${noshow.status}`);
      await waitForEvent(messages, 'reservation.no_show');

      closeWs(ws);

      await new Promise<void>((resolve, reject) => {
        const badWs = connectOwnerWs(wsUrl, owner2.accessToken, restaurantId);
        badWs
          .then(({ ws: w }) => {
            w.on('close', (code) => {
              if (code === 4004) resolve();
              else reject(new Error(`Expected close 4004 for wrong owner, got ${code}`));
            });
          })
          .catch(reject);
      });
    },
  );
}
