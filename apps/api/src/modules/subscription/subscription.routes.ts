import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@restaurant/db';
import { env } from '../../env.js';
import { createCheckoutUrl } from '../../lib/lemon-squeezy.js';
import { getSubscription, getPlanLimits } from './subscription.service.js';

const CheckoutSchema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'PREMIUM']),
});

const planToVariantId: Record<string, string> = {
  STARTER: env.LS_VARIANT_STARTER,
  PRO: env.LS_VARIANT_PRO,
  PREMIUM: env.LS_VARIANT_PREMIUM,
};

export async function subscriptionRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get(
    '/subscriptions/me',
    { preHandler: [fastify.authenticate, fastify.requireRole('owner')] },
    async (request, reply) => {
      const sub = await getSubscription(request.user!.sub);
      const limits = getPlanLimits(sub.plan);
      return reply.send({ subscription: sub, limits });
    },
  );

  fastify.post(
    '/subscriptions/checkout',
    { preHandler: [fastify.authenticate, fastify.requireRole('owner')] },
    async (request, reply) => {
      const body = CheckoutSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(422).send({ error: 'Invalid plan' });
      }

      const user = await prisma.user.findUnique({
        where: { id: request.user!.sub },
        select: { email: true },
      });

      const variantId = planToVariantId[body.data.plan]!;

      try {
        const checkoutUrl = await createCheckoutUrl({
          userId: request.user!.sub,
          userEmail: user?.email ?? '',
          variantId,
        });
        return reply.code(201).send({ checkoutUrl });
      } catch (err) {
        request.log.error(
          { err },
          '[Subscription] Lemon Squeezy checkout creation failed',
        );
        return reply.code(502).send({ error: 'Checkout temporarily unavailable' });
      }
    },
  );

  await Promise.resolve();
}
