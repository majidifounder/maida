import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import authenticatePlugin from '../../plugins/authenticate.js';
import { authRoutes } from '../../modules/auth/auth.routes.js';
import { restaurantRoutes } from '../../modules/restaurant/restaurant.routes.js';
import { reservationRoutes } from '../../modules/reservation/reservation.routes.js';
import { webhookRoutes } from '../../modules/subscription/webhook.routes.js';
import { subscriptionRoutes } from '../../modules/subscription/subscription.routes.js';
import { feedbackRoutes } from '../../modules/feedback/feedback.routes.js';
import multipart from '@fastify/multipart';
import { MAX_LOGO_BYTES } from '../../lib/image-validation.js';
import { AppError } from '../../errors/index.js';
import { registerLocalLogoRoutes } from '../../lib/local-logo-routes.js';

export async function buildTestServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(cookie);
  await fastify.register(sensible);
  await fastify.register(multipart, {
    limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
  });
  await fastify.register(authenticatePlugin);
  registerLocalLogoRoutes(fastify);
  await fastify.register(webhookRoutes);
  await fastify.register(authRoutes);
  await fastify.register(restaurantRoutes);
  await fastify.register(reservationRoutes);
  await fastify.register(subscriptionRoutes);
  await fastify.register(feedbackRoutes);

  fastify.get('/health', () => ({ status: 'ok' }));

  fastify.setErrorHandler((error: unknown, _req, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
    }
    const err = error as { statusCode?: number; message?: string };
    const statusCode = err.statusCode ?? 500;
    return reply.code(statusCode).send({ error: err.message ?? 'Internal server error' });
  });

  await fastify.ready();
  return fastify;
}
