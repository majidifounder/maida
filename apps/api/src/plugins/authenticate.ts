import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@restaurant/db';
import { verifyAccessToken } from '../lib/jwt.js';
import { getRedisClient } from '../lib/redis.js';
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

      try {
        const payload = verifyAccessToken(token);

        const redis = getRedisClient();
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

        request.user = payload;
      } catch {
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }
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
