import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { createAdminSession, registerAndLogin } from '../lib/auth-helpers.js';

export async function runAdminJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test('Admin journey', 'TOTP login → list resources → ban/unban owner access', async () => {
    const admin = await createAdminSession(ctx);
    const owner = await registerAndLogin(ctx, 'owner');

    const stats = await apiRequest(ctx, 'GET', '/admin/stats', {
      token: admin.accessToken,
    });
    report.assert(stats.status === 200, `Admin stats failed: ${stats.status}`);

    const users = await apiRequest(ctx, 'GET', '/admin/users', {
      token: admin.accessToken,
      query: { page: 1, limit: 10 },
    });
    report.assert(users.status === 200, `Admin users failed: ${users.status}`);

    const restaurants = await apiRequest(ctx, 'GET', '/admin/restaurants', {
      token: admin.accessToken,
      query: { page: 1, limit: 10 },
    });
    report.assert(restaurants.status === 200, `Admin restaurants failed: ${restaurants.status}`);

    const reservations = await apiRequest(ctx, 'GET', '/admin/reservations', {
      token: admin.accessToken,
      query: { page: 1, limit: 10 },
    });
    report.assert(reservations.status === 200, `Admin reservations failed: ${reservations.status}`);

    const ban = await apiRequest(ctx, 'PATCH', `/admin/users/${owner.userId}/ban`, {
      token: admin.accessToken,
    });
    report.assert(ban.status === 200, `Ban failed: ${ban.status}`);

    const blocked = await apiRequest(ctx, 'GET', '/auth/me', {
      token: owner.accessToken,
    });
    report.assert(blocked.status === 401, `Banned owner should get 401, got ${blocked.status}`);

    const inFlight = await apiRequest(ctx, 'GET', '/restaurants/mine', {
      token: owner.accessToken,
    });
    report.assert(inFlight.status === 401, `In-flight request after ban should be 401, got ${inFlight.status}`);

    const unban = await apiRequest(ctx, 'PATCH', `/admin/users/${owner.userId}/unban`, {
      token: admin.accessToken,
    });
    report.assert(unban.status === 200, `Unban failed: ${unban.status}`);

    const restoredLogin = await apiRequest(ctx, 'POST', '/auth/login', {
      body: { email: owner.email, password: owner.password },
    });
    report.assert(restoredLogin.status === 200, `Login after unban failed: ${restoredLogin.status}`);

    const me = await apiRequest(ctx, 'GET', '/auth/me', {
      token: (restoredLogin.body as { accessToken: string }).accessToken,
    });
    report.assert(me.status === 200, `Access restored check failed: ${me.status}`);
  });
}
