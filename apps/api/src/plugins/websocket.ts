import fp from 'fastify-plugin';
import websocketPlugin from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';
import { verifyAccessToken } from '../lib/jwt.js';
import { getRedisClient } from '../lib/redis.js';
import { subscribeToRestaurantChannel } from '../lib/pubsub.js';
import { prisma } from '@restaurant/db';

const wsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(websocketPlugin);

  fastify.get(
    '/ws',
    { websocket: true },
    async (socket, request) => {
      const { token, restaurantId } = request.query as {
        token?: string;
        restaurantId?: string;
      };

      if (!token || !restaurantId) {
        socket.close(4001, 'token and restaurantId query params are required');
        return;
      }

      let ownerId: string;
      try {
        const payload = verifyAccessToken(token);

        if (payload.role !== 'owner') {
          socket.close(4003, 'Only owners may subscribe to booking events');
          return;
        }

        const revoked = await getRedisClient().get(`deny:${payload.jti}`);
        if (revoked) {
          socket.close(4001, 'Token has been revoked');
          return;
        }

        ownerId = payload.sub;
      } catch {
        socket.close(4001, 'Invalid or expired token');
        return;
      }

      const restaurant = await prisma.restaurant.findFirst({
        where: { id: restaurantId, ownerId, deletedAt: null },
        select: { id: true },
      });

      if (!restaurant) {
        socket.close(4004, 'Restaurant not found or access denied');
        return;
      }

      const unsubscribe = await subscribeToRestaurantChannel(
        restaurantId,
        (raw) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(raw);
          }
        },
      );

      socket.send(JSON.stringify({ eventType: 'ws.connected', restaurantId }));

      fastify.log.info(
        `[WS] owner ${ownerId} connected to restaurant ${restaurantId}`,
      );

      socket.on('close', () => {
        void unsubscribe();
        fastify.log.info(
          `[WS] owner ${ownerId} disconnected from restaurant ${restaurantId}`,
        );
      });

      socket.on('error', (err: Error) => {
        fastify.log.warn(`[WS] socket error: ${err.message}`);
      });
    },
  );
};

export default fp(wsPlugin, { name: 'websocket' });
