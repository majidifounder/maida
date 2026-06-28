import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';

import { env } from './env.js';
import { logger } from './lib/logger.js';
import { getRedisClient } from './lib/redis.js';
import { getRealIp } from './lib/cloudflare.js';
import { isLoadTestRequest } from './lib/load-test.js';
import { recordThreatSignal, isExtendedBanned } from './lib/threat-detector.js';
import { prisma } from '@restaurant/db';
import authenticatePlugin from './plugins/authenticate.js';
import { cloudflareOnlyPlugin } from './plugins/cloudflareOnly.js';
import wsPlugin from './plugins/websocket.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { restaurantRoutes } from './modules/restaurant/restaurant.routes.js';
import { bookingRoutes } from './modules/booking/booking.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { webhookRoutes } from './modules/subscription/webhook.routes.js';
import { subscriptionRoutes } from './modules/subscription/subscription.routes.js';
import { startNotificationWorker } from './workers/notification.worker.js';

const BLOCKED_UA_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
  /go-http-client\/1\.1$/i,
  /python-requests\/[01]\./i,
];

async function buildServer() {
  const fastify = Fastify({
    logger: logger as unknown as FastifyBaseLogger,
    genReqId: () => randomUUID(),
    trustProxy: true,
    requestTimeout: 30_000,
    keepAliveTimeout: 5_000,
    bodyLimit: 100 * 1024, // 100 KB default
  });

  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
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
    keyGenerator: (req) => getRealIp(req),
    allowList: (req) => isLoadTestRequest(req),
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${context.after}.`,
      retryAfter: context.ttl,
    }),
    skipOnError: false,
  });

  await fastify.register(sensible);

  // --- Scanner / bot UA block ---
  fastify.addHook('onRequest', async (request, reply) => {
    const ua = request.headers['user-agent'] ?? '';
    if (BLOCKED_UA_PATTERNS.some((pattern) => pattern.test(ua))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  // --- Extended IP ban check (threat detector) ---
  fastify.addHook('onRequest', async (request, reply) => {
    const ip = getRealIp(request);
    const banned = await isExtendedBanned(ip);
    if (banned) {
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: 'Request blocked. Please try again later.',
      });
    }
  });

  // --- Record threat signals on 401 / 403 / 404 responses ---
  fastify.addHook('onResponse', async (request, reply) => {
    const ip = getRealIp(request);
    const status = reply.statusCode;
    if (status === 401) await recordThreatSignal(ip, 'AUTH_FAILURES');
    else if (status === 404) await recordThreatSignal(ip, 'NOT_FOUND');
    else if (status === 403) await recordThreatSignal(ip, 'FORBIDDEN');
  });

  // --- Security headers + correlation ID ---
  fastify.addHook('onSend', async (request, reply) => {
    reply.header(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    );
    reply.removeHeader('X-Powered-By');
    reply.header('X-DNS-Prefetch-Control', 'off');
    reply.header('X-Request-Id', request.id);
  });

  // --- Block HTTP method override headers ---
  fastify.addHook('preHandler', async (request, reply) => {
    if (
      request.headers['x-http-method-override'] ||
      request.headers['x-method-override'] ||
      request.headers['x-http-method']
    ) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Method override headers are not permitted',
      });
    }
  });

  await fastify.register(webhookRoutes);
  await fastify.register(cloudflareOnlyPlugin);
  await fastify.register(authenticatePlugin);
  await fastify.register(wsPlugin);
  await fastify.register(authRoutes);
  await fastify.register(restaurantRoutes);
  await fastify.register(bookingRoutes);
  await fastify.register(subscriptionRoutes);
  await fastify.register(adminRoutes);

  // --- Responsible disclosure endpoint ---
  fastify.get('/.well-known/security.txt', async (_request, reply) => {
    return reply.header('Content-Type', 'text/plain; charset=utf-8').send(
      `Contact: mailto:security@tablz.com\nExpires: 2027-01-01T00:00:00.000Z\nPreferred-Languages: en, fr, ar\nPolicy: https://tablz.com/security-policy\n`,
    );
  });

  fastify.get('/health', async (_request, reply) => {
    const checks: Record<string, 'ok' | 'error'> = {};
    let httpStatus = 200;

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
      httpStatus = 503;
    }

    try {
      const redis = getRedisClient();
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
      httpStatus = 503;
    }

    return reply.code(httpStatus).send({
      status: httpStatus === 200 ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      checks,
    });
  });

  fastify.setErrorHandler((error: unknown, _request, reply) => {
    const err = error as { statusCode?: number; message?: string; stack?: string };
    if (env.NODE_ENV === 'production' && !('statusCode' in (err as object))) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Internal server error' });
    }

    const statusCode = err.statusCode ?? 500;
    return reply.code(statusCode).send({
      error: err.message ?? 'Internal server error',
      ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
    });
  });

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
