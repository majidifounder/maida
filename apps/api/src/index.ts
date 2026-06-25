import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';

import { env } from './env.js';
import { getRedisClient } from './lib/redis.js';
import authenticatePlugin from './plugins/authenticate.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { restaurantRoutes } from './modules/restaurant/restaurant.routes.js';
import { bookingRoutes } from './modules/booking/booking.routes.js';
import { startNotificationWorker } from './workers/notification.worker.js';

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'warn' : 'info',
      ...(env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
    trustProxy: env.NODE_ENV === 'production',
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(cookie);

  const redis = getRedisClient();
  await fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${context.after}.`,
      retryAfter: context.ttl,
    }),
    skipOnError: false,
  });

  await fastify.register(sensible);
  await fastify.register(authenticatePlugin);
  await fastify.register(authRoutes);
  await fastify.register(restaurantRoutes);
  await fastify.register(bookingRoutes);

  fastify.setErrorHandler((error, _request, reply) => {
    if (env.NODE_ENV === 'production' && !('statusCode' in error)) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }

    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(statusCode).send({
      error: error.message,
      ...(env.NODE_ENV !== 'production' && { stack: error.stack }),
    });
  });

  fastify.get('/health', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  }));

  return fastify;
}

async function start() {
  const server = await buildServer();
  let stopWorker: (() => Promise<void>) | null = null;

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully…`);
    if (stopWorker) await stopWorker();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await server.listen({ port: env.PORT, host: '0.0.0.0' });
    stopWorker = startNotificationWorker();
    console.log(`✅ API server listening on port ${env.PORT}`);
  } catch (err) {
    if (stopWorker) await stopWorker();
    server.log.error(err);
    process.exit(1);
  }
}

void start();
