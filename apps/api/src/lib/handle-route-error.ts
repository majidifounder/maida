import type { FastifyReply } from 'fastify';
import { AppError, ConflictError } from '../errors/index.js';

export function handleRouteError(err: unknown, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({
      error: err.message,
      code: err.code,
      ...(err instanceof ConflictError && err.details ? err.details : {}),
    });
  }
  throw err;
}
