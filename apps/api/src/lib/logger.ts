import pino from 'pino';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["cf-connecting-ip"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.totpCode',
  'req.body.cfTurnstileResponse',
  'res.headers["set-cookie"]',
  'responseBody.refreshToken',
  'responseBody.totpSecret',
  'responseBody.password',
];

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  serializers: {
    req(request: FastifyRequest) {
      return {
        method: request.method,
        url: request.url,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
      };
    },
    res(reply: FastifyReply) {
      return {
        statusCode: reply.statusCode,
        requestId: reply.request?.id,
      };
    },
  },
  // Only use pino-pretty in development — it spawns a worker thread that
  // interferes with the test runner. Tests get plain JSON logs instead.
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, ignore: 'pid,hostname' },
    },
  }),
});
