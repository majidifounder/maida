import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getRedisClient } from '../../lib/redis.js';
import {
  verifyLemonSqueezySignature,
  webhookIdempotencyKey,
} from '../../lib/lemon-squeezy.js';
import { upsertSubscriptionFromWebhook } from './subscription.service.js';

interface LsWebhookBody {
  meta: {
    event_name: string;
    custom_data: { user_id?: string };
  };
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      variant_id: number;
      renews_at: string | null;
      ends_at: string | null;
      cancelled: boolean;
      updated_at: string;
    };
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done) => {
      try {
        req.rawBody = body;
        done(null, JSON.parse(body.toString('utf8')) as unknown);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  fastify.post<{ Body: LsWebhookBody }>(
    '/webhooks/lemon-squeezy',
    async (req, reply) => {
      const signature = req.headers['x-signature'] as string | undefined;
      const rawBody = req.rawBody;

      if (!signature || !rawBody) {
        return reply.code(401).send({ error: 'Missing signature or body' });
      }

      if (!verifyLemonSqueezySignature(rawBody, signature)) {
        req.log.warn('[Webhook/LS] Invalid signature — request rejected');
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      const { event_name, custom_data } = req.body.meta;
      const { data } = req.body;

      if (data.type !== 'subscriptions') {
        req.log.info(
          `[Webhook/LS] Ignoring non-subscription event: ${event_name}`,
        );
        return reply.code(200).send({ received: true });
      }

      const handledEvents = new Set([
        'subscription_created',
        'subscription_updated',
        'subscription_cancelled',
        'subscription_resumed',
        'subscription_expired',
        'subscription_payment_failed',
        'subscription_payment_success',
        'subscription_payment_recovered',
      ]);

      if (!handledEvents.has(event_name)) {
        req.log.info(`[Webhook/LS] Unknown event "${event_name}" — skipping`);
        return reply.code(200).send({ received: true });
      }

      const userId = custom_data?.user_id;
      if (!userId) {
        req.log.error(
          `[Webhook/LS] ${event_name} missing custom_data.user_id — skipping`,
        );
        return reply.code(200).send({ received: true });
      }

      const idemKey = webhookIdempotencyKey(
        event_name,
        data.id,
        data.attributes.updated_at,
      );
      const redis = getRedisClient();
      const alreadyProcessed = await redis.set(idemKey, '1', 'EX', 604800, 'NX');

      if (alreadyProcessed === null) {
        req.log.info(`[Webhook/LS] Duplicate event ${idemKey} — skipping`);
        return reply.code(200).send({ received: true });
      }

      try {
        const applied = await upsertSubscriptionFromWebhook({
          userId,
          lemonSqueezyId: data.id,
          lsStatus: data.attributes.status,
          variantId: data.attributes.variant_id,
          renewsAt: data.attributes.renews_at,
          endsAt: data.attributes.ends_at,
          cancelled: data.attributes.cancelled,
          updatedAt: data.attributes.updated_at,
        });

        req.log.info(
          applied
            ? `[Webhook/LS] ✓ ${event_name} — user ${userId} — sub ${data.id}`
            : `[Webhook/LS] ↷ ${event_name} — user ${userId} — stale (older than stored lsUpdatedAt), ignored`,
        );
      } catch (err) {
        await redis.del(idemKey);
        throw err;
      }

      return reply.code(200).send({ received: true });
    },
  );

  await Promise.resolve();
}
