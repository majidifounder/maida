import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@restaurant/db';
import { verifyAccessToken } from '../lib/jwt.js';
import { ensureRedisConnected } from '../lib/redis.js';
import type { JWTPayload, Role } from '@restaurant/types';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
    /** From the same per-request account lookup — no extra query. */
    emailVerified?: boolean;
  }
}

// Bounded retry for the revocation/account check. Two attempts smooth over a
// single transient Upstash command timeout without meaningfully delaying the
// fail-closed 503 when the store is genuinely down.
const REVOCATION_MAX_ATTEMPTS = 2;
const REVOCATION_RETRY_DELAY_MS = 100;

const authenticatePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers.authorization;

      if (!authHeader?.startsWith('Bearer ')) {
        return reply
          .code(401)
          .send({ error: 'Missing or malformed Authorization header' });
      }

      const token = authHeader.slice(7);

      // Step 1 — verify the token itself. A failure here means the token is
      // genuinely bad or expired → 401.
      let payload: JWTPayload;
      try {
        payload = verifyAccessToken(token);
      } catch {
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }

      // Step 2 — check revocation (Redis) and account status (DB). If a BACKING
      // STORE is unavailable, do NOT report 401: a Redis/DB blip would otherwise
      // log out every authenticated user at once and the clients would tear down
      // their sessions. Return 503 so clients retry the same request. Access is
      // never granted on infrastructure failure.
      //
      // A single Upstash command occasionally exceeds its timeout under load;
      // rather than 503 a live user on one transient spike, retry the check a
      // bounded number of times before failing closed. Retries only cover
      // thrown infra errors — a genuine revocation or deactivation short-circuits
      // immediately and is never retried.
      let authz:
        | { kind: 'ok'; emailVerified: boolean }
        | { kind: 'revoked' }
        | { kind: 'deactivated' }
        | null = null;
      let lastErr: unknown;

      for (let attempt = 1; attempt <= REVOCATION_MAX_ATTEMPTS; attempt++) {
        try {
          const redis = await ensureRedisConnected(3_000);
          const revoked = await redis.get(`deny:${payload.jti}`);
          if (revoked) {
            authz = { kind: 'revoked' };
            break;
          }

          const user = await prisma.user.findUnique({
            where: { id: payload.sub },
            select: { deletedAt: true, emailVerifiedAt: true },
          });
          if (!user || user.deletedAt) {
            authz = { kind: 'deactivated' };
            break;
          }
          authz = { kind: 'ok', emailVerified: user.emailVerifiedAt !== null };
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < REVOCATION_MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, REVOCATION_RETRY_DELAY_MS));
          }
        }
      }

      if (!authz) {
        request.log.error(
          { err: lastErr, attempts: REVOCATION_MAX_ATTEMPTS },
          '[auth] revocation/account check unavailable after retries — returning 503',
        );
        return reply.code(503).send({
          error: 'Service temporarily unavailable. Please retry.',
        });
      }
      if (authz.kind === 'revoked') {
        return reply.code(401).send({ error: 'Token has been revoked' });
      }
      if (authz.kind === 'deactivated') {
        return reply
          .code(401)
          .send({ error: 'Account has been deactivated' });
      }
      request.emailVerified = authz.emailVerified;

      request.user = payload;
    },
  );

  fastify.decorate(
    'requireRole',
    (role: Role) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (request.user?.role !== role) {
          return reply
            .code(403)
            .send({ error: 'Forbidden: insufficient role' });
        }
      },
  );
  await Promise.resolve();
};

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireRole: (
      role: Role,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(authenticatePlugin, { name: 'authenticate' });
