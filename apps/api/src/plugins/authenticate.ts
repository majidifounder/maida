import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@restaurant/db';
import { verifyAccessToken } from '../lib/jwt.js';
import { ensureRedisConnected } from '../lib/redis.js';
import type { JWTPayload, Role } from '@restaurant/types';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

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
      try {
        const redis = await ensureRedisConnected(1_500);
        const revoked = await redis.get(`deny:${payload.jti}`);
        if (revoked) {
          return reply.code(401).send({ error: 'Token has been revoked' });
        }

        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { deletedAt: true },
        });
        if (!user || user.deletedAt) {
          return reply
            .code(401)
            .send({ error: 'Account has been deactivated' });
        }
      } catch (err) {
        request.log.error(
          { err },
          '[auth] revocation/account check unavailable — returning 503',
        );
        return reply.code(503).send({
          error: 'Service temporarily unavailable. Please retry.',
        });
      }

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
