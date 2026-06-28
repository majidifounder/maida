import pino from 'pino';
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
    req(req) {
      return {
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
        requestId: (res as { request?: { id?: string } }).request?.id,
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
