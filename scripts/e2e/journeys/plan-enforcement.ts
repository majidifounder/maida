import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin, setOwnerPlan } from '../lib/auth-helpers.js';

export async function runPlanEnforcementJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test('Plan enforcement', 'STARTER — second restaurant rejected with upgrade message', async () => {
    const owner = await registerAndLogin(ctx, 'owner');
    await setOwnerPlan(owner.userId, 'STARTER');

    const first = await apiRequest(ctx, 'POST', '/restaurants', {
      token: owner.accessToken,
      body: {
        name: 'Starter One',
        description: 'First starter restaurant',
        cuisine: 'ITALIAN',
        address: '1 Plan St',
        city: 'PlanCity',
      },
    });
    report.assert(first.status === 201, `First restaurant failed: ${first.status}`);
    ctx.trackRestaurant((first.body as { restaurant: { id: string } }).restaurant.id);

    const second = await apiRequest<{
      error: string;
      message: string;
      upgrade: string;
    }>(ctx, 'POST', '/restaurants', {
      token: owner.accessToken,
      body: {
        name: 'Starter Two',
        description: 'Should be blocked',
        cuisine: 'ITALIAN',
        address: '2 Plan St',
        city: 'PlanCity',
      },
    });
    report.assert(second.status === 403, `Expected 403, got ${second.status}`);
    report.assert(
      second.body.message.toLowerCase().includes('upgrade') ||
        second.body.message.toLowerCase().includes('plan'),
      'Expected upgrade/plan messaging',
    );
    report.assert(
      second.body.upgrade === '/subscriptions/checkout',
      'Expected upgrade path /subscriptions/checkout',
    );
  });

  await report.test('Plan enforcement', 'STARTER — table count limit enforced', async () => {
    const owner = await registerAndLogin(ctx, 'owner');
    await setOwnerPlan(owner.userId, 'STARTER');

    const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
      token: owner.accessToken,
      body: {
        name: 'Table Limit Test',
        description: 'Table limit enforcement test',
        cuisine: 'OTHER',
        address: '3 Plan St',
        city: 'PlanCity',
      },
    });
    report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
    const restaurantId = rest.body.restaurant.id;
    ctx.trackRestaurant(restaurantId);

    for (let i = 0; i < 10; i++) {
      const t = await apiRequest(ctx, 'POST', `/restaurants/${restaurantId}/tables`, {
        token: owner.accessToken,
        body: { name: `T${i}`, minPartySize: 1, maxPartySize: 2 },
      });
      report.assert(t.status === 201, `Table ${i} creation failed: ${t.status}`);
    }

    const over = await apiRequest<{ error: string }>(
      ctx,
      'POST',
      `/restaurants/${restaurantId}/tables`,
      {
        token: owner.accessToken,
        body: { name: 'Over limit', minPartySize: 1, maxPartySize: 2 },
      },
    );
    report.assert(over.status === 422, `Expected 422 table limit, got ${over.status}`);
    report.assert(
      over.body.error.toLowerCase().includes('plan') ||
        over.body.error.toLowerCase().includes('table'),
      'Expected plan/table limit error message',
    );
  });

  await report.test('Plan enforcement', 'STARTER — FLEXIBLE seating rejected', async () => {
    const owner = await registerAndLogin(ctx, 'owner');
    await setOwnerPlan(owner.userId, 'STARTER');

    const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
      token: owner.accessToken,
      body: {
        name: 'Flex Block Test',
        description: 'Flexible blocked',
        cuisine: 'OTHER',
        address: '4 Plan St',
        city: 'PlanCity',
      },
    });
    report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
    ctx.trackRestaurant(rest.body.restaurant.id);

    const flex = await apiRequest<{ error: string }>(
      ctx,
      'PATCH',
      `/restaurants/${rest.body.restaurant.id}/reservation-config`,
      {
        token: owner.accessToken,
        body: { seatingMode: 'FLEXIBLE' },
      },
    );
    report.assert(flex.status === 422, `Expected 422 for FLEXIBLE on STARTER, got ${flex.status}`);
    report.assert(
      flex.body.error.toLowerCase().includes('pro') ||
        flex.body.error.toLowerCase().includes('premium') ||
        flex.body.error.toLowerCase().includes('flexible'),
      'Expected flexible seating upgrade message',
    );
  });

  await report.test('Plan enforcement', 'STARTER — CUSTOM reservation rejected', async () => {
    const owner = await registerAndLogin(ctx, 'owner');
    await setOwnerPlan(owner.userId, 'STARTER');

    const rest = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
      token: owner.accessToken,
      body: {
        name: 'Custom Block Test',
        description: 'Custom blocked',
        cuisine: 'OTHER',
        address: '5 Plan St',
        city: 'PlanCity',
      },
    });
    report.assert(rest.status === 201, `Create restaurant failed: ${rest.status}`);
    const restaurantId = rest.body.restaurant.id;
    ctx.trackRestaurant(restaurantId);

    await apiRequest(ctx, 'POST', `/restaurants/${restaurantId}/tables`, {
      token: owner.accessToken,
      body: { name: 'C1', minPartySize: 2, maxPartySize: 4 },
    });

    const diner = await registerAndLogin(ctx, 'diner');
    const custom = await apiRequest<{ error: string }>(ctx, 'POST', '/reservations', {
      token: diner.accessToken,
      body: {
        restaurantId,
        partySize: 2,
        startsAt: new Date(Date.now() + 86400000 * 14).toISOString(),
        reservationType: 'CUSTOM',
        durationMins: 90,
      },
    });
    report.assert(custom.status === 422, `Expected 422 for CUSTOM on STARTER, got ${custom.status}`);
    report.assert(
      custom.body.error.toLowerCase().includes('custom') ||
        custom.body.error.toLowerCase().includes('pro'),
      'Expected custom reservation plan message',
    );
  });
}
