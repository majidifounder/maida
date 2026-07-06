import { prisma } from '@restaurant/db';
import { apiRequest } from '../lib/client.js';
import type { E2eContext } from '../lib/context.js';
import { registerAndLogin, setOwnerPlan } from '../lib/auth-helpers.js';
import { buildWebhookPayload, sendWebhook } from '../lib/webhook.js';

export async function runSubscriptionJourney(ctx: E2eContext): Promise<void> {
  const { report } = ctx;

  await report.test(
    'Subscription lifecycle',
    'checkout → webhook upgrade → downgrade on expiry → resume',
    async () => {
      const owner = await registerAndLogin(ctx, 'owner');
      await setOwnerPlan(owner.userId, 'STARTER');

      const checkout = await apiRequest<{ checkoutUrl?: string; error?: string }>(
        ctx,
        'POST',
        '/subscriptions/checkout',
        { token: owner.accessToken, body: { plan: 'PRO' } },
      );
      report.assert(
        checkout.status === 201 || checkout.status === 502,
        `Checkout unexpected status: ${checkout.status}`,
      );
      if (checkout.status === 201) {
        report.assert(
          typeof checkout.body.checkoutUrl === 'string' &&
            checkout.body.checkoutUrl.startsWith('http'),
          'Expected checkoutUrl on successful checkout initiation',
        );
      }

      const proVariant = Number(process.env.LS_VARIANT_PRO);
      const upgradePayload = buildWebhookPayload('subscription_created', owner.userId, {
        variantId: proVariant,
        status: 'active',
        updatedAt: new Date().toISOString(),
      });
      const upgradeHook = await sendWebhook(ctx.base, upgradePayload);
      report.assert(upgradeHook.status === 200, `Upgrade webhook failed: ${upgradeHook.status}`);

      const subMe = await apiRequest<{
        subscription: { plan: string; status: string };
      }>(ctx, 'GET', '/subscriptions/me', { token: owner.accessToken });
      report.assert(subMe.status === 200, `GET /subscriptions/me failed: ${subMe.status}`);
      report.assert(subMe.body.subscription.plan === 'PRO', 'Expected PRO plan after webhook');

      const r1 = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
        token: owner.accessToken,
        body: {
          name: 'Sub Life 1',
          description: 'First on PRO',
          cuisine: 'ITALIAN',
          address: '1 Sub St',
          city: 'SubCity',
        },
      });
      const r2 = await apiRequest<{ restaurant: { id: string } }>(ctx, 'POST', '/restaurants', {
        token: owner.accessToken,
        body: {
          name: 'Sub Life 2',
          description: 'Second on PRO',
          cuisine: 'ITALIAN',
          address: '2 Sub St',
          city: 'SubCity',
        },
      });
      report.assert(r1.status === 201 && r2.status === 201, 'PRO should allow 2 restaurants');
      ctx.trackRestaurant(r1.body.restaurant.id);
      ctx.trackRestaurant(r2.body.restaurant.id);

      const cancelPayload = buildWebhookPayload('subscription_updated', owner.userId, {
        variantId: proVariant,
        status: 'active',
        cancelled: true,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      });
      const cancelHook = await sendWebhook(ctx.base, cancelPayload);
      report.assert(cancelHook.status === 200, `Cancel webhook failed: ${cancelHook.status}`);

      const afterCancel = await prisma.subscription.findUnique({
        where: { userId: owner.userId },
      });
      report.assert(
        afterCancel?.cancelAtPeriodEnd === true,
        'Expected cancelAtPeriodEnd after cancel webhook',
      );

      const expirePayload = buildWebhookPayload('subscription_expired', owner.userId, {
        variantId: proVariant,
        status: 'expired',
        updatedAt: new Date(Date.now() + 2000).toISOString(),
      });
      const expireHook = await sendWebhook(ctx.base, expirePayload);
      report.assert(expireHook.status === 200, `Expire webhook failed: ${expireHook.status}`);

      const afterExpire = await apiRequest<{ subscription: { plan: string } }>(
        ctx,
        'GET',
        '/subscriptions/me',
        { token: owner.accessToken },
      );
      report.assert(afterExpire.status === 200, 'GET /subscriptions/me after expire failed');
      report.assert(
        afterExpire.body.subscription.plan === 'STARTER',
        'Expected STARTER after expiry downgrade',
      );

      const blockedThird = await apiRequest<{ error: string; upgrade: string }>(
        ctx,
        'POST',
        '/restaurants',
        {
          token: owner.accessToken,
          body: {
            name: 'Sub Life 3',
            description: 'Blocked on STARTER with 2 existing',
            cuisine: 'ITALIAN',
            address: '3 Sub St',
            city: 'SubCity',
          },
        },
      );
      report.assert(
        blockedThird.status === 403,
        `Expected 403 creating 3rd restaurant on STARTER, got ${blockedThird.status}`,
      );
      report.assert(
        blockedThird.body.upgrade === '/subscriptions/checkout',
        'Expected upgrade path after downgrade',
      );

      const resumePayload = buildWebhookPayload('subscription_resumed', owner.userId, {
        variantId: proVariant,
        status: 'active',
        cancelled: false,
        updatedAt: new Date(Date.now() + 3000).toISOString(),
      });
      const resumeHook = await sendWebhook(ctx.base, resumePayload);
      report.assert(resumeHook.status === 200, `Resume webhook failed: ${resumeHook.status}`);

      const afterResume = await apiRequest<{ subscription: { plan: string; cancelAtPeriodEnd: boolean } }>(
        ctx,
        'GET',
        '/subscriptions/me',
        { token: owner.accessToken },
      );
      report.assert(afterResume.body.subscription.plan === 'PRO', 'Expected PRO after resume');
      report.assert(
        afterResume.body.subscription.cancelAtPeriodEnd === false,
        'Expected cancelAtPeriodEnd cleared after resume',
      );
    },
  );
}
