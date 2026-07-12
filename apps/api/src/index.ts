import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';

import { env } from './env.js';
import { logger } from './lib/logger.js';
import { getRedisClient, pingRedis } from './lib/redis.js';
import { getRealIp } from './lib/cloudflare.js';
import { isLoadTestRequest } from './lib/load-test.js';
import { recordThreatSignal, isExtendedBanned } from './lib/threat-detector.js';
import { prisma } from '@restaurant/db';
import authenticatePlugin from './plugins/authenticate.js';
import { cloudflareOnlyPlugin } from './plugins/cloudflareOnly.js';
import wsPlugin from './plugins/websocket.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { restaurantRoutes } from './modules/restaurant/restaurant.routes.js';
import { reservationRoutes } from './modules/reservation/reservation.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { webhookRoutes } from './modules/subscription/webhook.routes.js';
import { subscriptionRoutes } from './modules/subscription/subscription.routes.js';
import multipart from '@fastify/multipart';
import { MAX_LOGO_BYTES } from './lib/image-validation.js';
import { feedbackRoutes } from './modules/feedback/feedback.routes.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { startMaintenanceWorker } from './workers/maintenance.worker.js';
import { AppError, ConflictError, UnprocessableError } from './errors/index.js';
import { mapPrismaError } from './lib/handle-route-error.js';
import { registerLocalLogoRoutes } from './lib/local-logo-routes.js';
import { warmupStores } from './lib/store-warmup.js';
import { reportCriticalError } from './lib/alert.js';

const BLOCKED_UA_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
  /go-http-client\/1\.1$/i,
  /python-requests\/[01]\./i,
];

function isHealthRoute(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return path === '/health' || path === '/health/ready';
}

/**
 * Payment-provider webhooks arrive from the PROVIDER's egress IPs, so the
 * global per-IP rate limit would throttle a whole store's billing traffic onto
 * one bucket — a burst of Lemon Squeezy events (or its retry storms) could be
 * 429'd and, since we only 200 on success, silently dropped → subscription
 * state drift. These endpoints are already gated by HMAC signature
 * verification and Redis idempotency, so the IP limit adds no protection here.
 */
function isWebhookRoute(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return path.startsWith('/webhooks/');
}

function sendLiveness(res: ServerResponse): void {
  const body = JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function buildServer() {
  const fastify = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    genReqId: () => randomUUID(),
    trustProxy: true,
    requestTimeout: 30_000,
    keepAliveTimeout: 5_000,
    bodyLimit: 100 * 1024, // 100 KB default
    // Answer /health at the raw HTTP layer so Redis/rate-limit/hooks can never hang it.
    serverFactory(handler) {
      return createServer((req: IncomingMessage, res: ServerResponse) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (req.method === 'GET' && path === '/health') {
          sendLiveness(res);
          return;
        }
        handler(req, res);
      });
    },
  });

  // Keep a Fastify route for inject()/tests (serverFactory is not used by inject).
  fastify.get('/health', {
    config: { rateLimit: false },
  }, async (_request, reply) => {
    return reply.code(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
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

  // Always use in-memory rate limiting in development/test.
  // Redis-backed limiting is production-only and must never block local/e2e.
  await fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => getRealIp(req),
    allowList: (req) =>
      isLoadTestRequest(req) ||
      isHealthRoute(req.url) ||
      isWebhookRoute(req.url),
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${context.after}.`,
      retryAfter: context.ttl,
    }),
    skipOnError: true,
    ...(env.NODE_ENV === 'production' ? { redis: getRedisClient() } : {}),
  });

  await fastify.register(sensible);
  await fastify.register(multipart, {
    limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
  });

  // --- Scanner / bot UA block ---
  fastify.addHook('onRequest', async (request, reply) => {
    const ua = request.headers['user-agent'] ?? '';
    if (BLOCKED_UA_PATTERNS.some((pattern) => pattern.test(ua))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  // --- Extended IP ban check (threat detector) ---
  fastify.addHook('onRequest', async (request, reply) => {
    if (isHealthRoute(request.url)) return;
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
  // MUST be async and return the payload: Fastify's onSend contract is
  // (request, reply, payload, done) OR a promise resolving to the payload.
  // The previous sync 2-arg version returned undefined, so Fastify waited for
  // a `done` that never came — EVERY response hung forever after routing.
  // Tests never caught it because buildTestServer skips index.ts middleware.
  fastify.addHook('onSend', async (request, reply, payload) => {
    void reply.header(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    );
    void reply.removeHeader('X-Powered-By');
    void reply.header('X-DNS-Prefetch-Control', 'off');
    void reply.header('X-Request-Id', request.id);
    return payload;
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
  registerLocalLogoRoutes(fastify);
  await fastify.register(wsPlugin);
  await fastify.register(authRoutes);
  await fastify.register(restaurantRoutes);
  await fastify.register(reservationRoutes);
  await fastify.register(subscriptionRoutes);
  await fastify.register(feedbackRoutes);
  await fastify.register(adminRoutes);

  // --- Responsible disclosure endpoint ---
  fastify.get('/.well-known/security.txt', async (_request, reply) => {
    return reply.header('Content-Type', 'text/plain; charset=utf-8').send(
      `Contact: mailto:security@maida.app\nExpires: 2027-01-01T00:00:00.000Z\nPreferred-Languages: en, fr, ar\nPolicy: https://maida.app/security-policy\n`,
    );
  });

  // Readiness — DB + Redis. Used by launch checks and e2e regression.
  fastify.get('/health/ready', {
    config: { rateLimit: false },
  }, async (_request, reply) => {
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
      await pingRedis(3_000);
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
    const appError = error instanceof AppError ? error : mapPrismaError(error);
    if (appError) {
      return reply.code(appError.statusCode).send({
        error: appError.message,
        code: appError.code,
        ...(appError instanceof ConflictError && appError.details
          ? appError.details
          : {}),
        ...(appError instanceof UnprocessableError && appError.details
          ? appError.details
          : {}),
      });
    }

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
  let stopMaintenance: (() => Promise<void>) | null = null;

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully…`);
    if (stopWorker) await stopWorker();
    if (stopMaintenance) await stopMaintenance();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    void reportCriticalError({
      source: 'unhandled-rejection',
      message: 'Unhandled promise rejection in the API process',
      err: reason,
    });
  });
  process.on('uncaughtException', (err) => {
    void reportCriticalError({
      source: 'uncaught-exception',
      message: 'Uncaught exception in the API process',
      err,
    });
  });

  try {
    await warmupStores();
    await server.listen({ port: env.PORT, host: '0.0.0.0' });
    if (env.RUN_WORKER_IN_PROCESS) {
      stopWorker = startNotificationWorker();
      stopMaintenance = startMaintenanceWorker();
      logger.info('[NotificationWorker] running in-process (RUN_WORKER_IN_PROCESS=true)');
    } else {
      logger.info(
        '[NotificationWorker] not started in-process — run it separately (pnpm --filter @restaurant/api worker)',
      );
    }
    logger.info(`✅ API server listening on port ${env.PORT}`);
  } catch (err) {
    if (stopWorker) await stopWorker();
    if (stopMaintenance) await stopMaintenance();
    server.log.error(err);
    process.exit(1);
  }
}

void start();
