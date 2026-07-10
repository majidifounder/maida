import type { FastifyReply } from 'fastify';
import { Prisma } from '@restaurant/db';
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../errors/index.js';

/**
 * Translates a Prisma known-request error into an AppError so predictable
 * database failures (bad UUIDs, unique/foreign-key/check violations, missing
 * rows) become 4xx responses instead of leaking as 500s.
 */
export function mapPrismaError(err: unknown): AppError | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (err.code) {
    case 'P2002': // unique constraint violation
      return new ConflictError('That value already exists.');
    case 'P2003': // foreign-key constraint violation
      return new ConflictError('A related record is missing or still in use.');
    case 'P2025': // record required for the operation was not found
      return new NotFoundError('Record not found.');
    case 'P2000': // value too long for the column
      return new BadRequestError('A submitted value is too long.');
    case 'P2023': // malformed input, e.g. an invalid UUID path parameter
      return new BadRequestError('Malformed request parameter.');
    case 'P2010': {
      // Raw-query failure — surfaces the underlying SQLSTATE (check/unique/etc.).
      const dbCode = (err.meta as { code?: string } | undefined)?.code;
      if (dbCode === '23514') {
        return new UnprocessableError('A value is outside the allowed range.');
      }
      if (dbCode === '23505') {
        return new ConflictError('That value already exists.');
      }
      return null;
    }
    default:
      return null;
  }
}

export function handleRouteError(err: unknown, reply: FastifyReply) {
  const appError = err instanceof AppError ? err : mapPrismaError(err);

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

  throw err;
}
