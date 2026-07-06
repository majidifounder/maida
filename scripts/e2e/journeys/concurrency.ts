import { prisma } from '@restaurant/db';
import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin, setOwnerPlan } from '../lib/auth-helpers.js';
import { futureDatetime } from '../lib/dates.js';

const ITERATIONS = Number(process.env.E2E_CONCURRENCY_ITERATIONS ?? 25);

async function countActiveHolds(tableId: string, startsAt: Date): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.reservationTable.count({
        where: {
          tableId,
          releasedAt: null,
          startsAt,
        },
      });
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function runConcurrencyJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test(
    'Concurrency',
    `${ITERATIONS}× double-booking race — exactly one 201 and rest 409, one hold row`,
    async () => {
      const owner = await registerAndLogin(ctx, 'owner');
      await setOwnerPlan(owner.userId, 'PRO');

      const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
        token: owner.accessToken,
        body: {
          name: 'Concurrency Race Bistro',
          description: 'GiST exclusion regression guard',
          cuisine: 'OTHER',
          address: '1 Race St',
          city: 'RaceCity',
        },
      });
      report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
      const restaurantId = rest.body.restaurant.id;
      ctx.trackRestaurant(restaurantId);

      const table = await apiRequest<{ table: { id: string } }>(
        ctx,
        'POST',
        `/restaurants/${restaurantId}/tables`,
        {
          token: owner.accessToken,
          body: { name: 'Only Table', minPartySize: 2, maxPartySize: 4 },
        },
      );
      report.assert(table.status === 201, `Create table failed: ${table.status}`);
      const tableId = table.body.table.id;

      for (let i = 0; i < ITERATIONS; i++) {
        const dinerA = await registerAndLogin(ctx, 'diner');
        const dinerB = await registerAndLogin(ctx, 'diner');
        const startsAt = futureDatetime(20 + i, 18, i % 60);

        const [resA, resB] = await Promise.all([
          apiRequest(ctx, 'POST', '/reservations', {
            token: dinerA.accessToken,
            body: {
              restaurantId,
              partySize: 2,
              startsAt,
              reservationType: 'STANDARD',
            },
          }),
          apiRequest(ctx, 'POST', '/reservations', {
            token: dinerB.accessToken,
            body: {
              restaurantId,
              partySize: 2,
              startsAt,
              reservationType: 'STANDARD',
            },
          }),
        ]);

        const statuses = [resA.status, resB.status].sort((a, b) => a - b);
        if (statuses.join(',') !== '201,409') {
          throw new Error(
            `Iteration ${i + 1}/${ITERATIONS}: expected [201,409], got [${resA.status},${resB.status}]`,
          );
        }

        const winner =
          resA.status === 201
            ? (resA.body as { reservation: { id: string } }).reservation
            : (resB.body as { reservation: { id: string } }).reservation;
        ctx.trackReservation(winner.id);

        const startsAtDate = new Date(startsAt);
        const holds = await countActiveHolds(tableId, startsAtDate);
        if (holds !== 1) {
          throw new Error(
            `Iteration ${i + 1}/${ITERATIONS}: expected 1 reservation_tables row, got ${holds}`,
          );
        }
      }
    },
  );
}
