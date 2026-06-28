import type { FastifyRequest } from 'fastify';
import { env } from '../env.js';

/** Load-test header bypass is disabled in production. */
export function isLoadTestRequest(req: FastifyRequest): boolean {
  if (env.NODE_ENV === 'production') return false;
  return req.headers['x-load-test'] === '1';
}
