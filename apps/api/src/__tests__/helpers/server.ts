import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import authenticatePlugin from '../../plugins/authenticate.js';
import { authRoutes } from '../../modules/auth/auth.routes.js';
import { restaurantRoutes } from '../../modules/restaurant/restaurant.routes.js';

export async function buildTestServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(cookie);
  await fastify.register(sensible);
  await fastify.register(authenticatePlugin);
  await fastify.register(authRoutes);
  await fastify.register(restaurantRoutes);

  fastify.get('/health', () => ({ status: 'ok' }));

  fastify.setErrorHandler((error, _req, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(statusCode).send({ error: error.message });
  });

  await fastify.ready();
  return fastify;
}
