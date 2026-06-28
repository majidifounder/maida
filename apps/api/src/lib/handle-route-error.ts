import type { FastifyReply } from 'fastify';
import { AppError } from '../errors/index.js';

export function handleRouteError(err: unknown, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply
      .code(err.statusCode)
      .send({ error: err.message, code: err.code });
  }
  throw err;
}
