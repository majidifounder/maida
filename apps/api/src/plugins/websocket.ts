import fp from 'fastify-plugin';
import websocketPlugin from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';
import { verifyAccessToken } from '../lib/jwt.js';
import { getRedisClient } from '../lib/redis.js';
import { subscribeToRestaurantChannel } from '../lib/pubsub.js';
import { getRealIp } from '../lib/cloudflare.js';
import { prisma } from '@restaurant/db';

// Per-IP connection counter — prevents file-descriptor exhaustion from flooding.
const wsConnectionsByIp = new Map<string, number>();
const WS_MAX_CONNECTIONS_PER_IP = 5;

const wsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(websocketPlugin);

  fastify.get(
    '/ws',
    { websocket: true },
    async (socket, request) => {
      // ── Per-IP connection cap (M3) ────────────────────────────────────────
      const clientIp = getRealIp(request);
      const currentCount = wsConnectionsByIp.get(clientIp) ?? 0;
      if (currentCount >= WS_MAX_CONNECTIONS_PER_IP) {
        socket.close(4029, 'Too many connections from this IP');
        return;
      }
      wsConnectionsByIp.set(clientIp, currentCount + 1);

      const decrementIpCount = () => {
        const count = wsConnectionsByIp.get(clientIp) ?? 1;
        if (count <= 1) wsConnectionsByIp.delete(clientIp);
        else wsConnectionsByIp.set(clientIp, count - 1);
      };

      const { token, restaurantId } = request.query as {
        token?: string;
        restaurantId?: string;
      };

      if (!token || !restaurantId) {
        socket.close(4001, 'token and restaurantId query params are required');
        decrementIpCount();
        return;
      }

      let ownerId: string;
      let jti: string;
      let exp: number;
      try {
        const payload = verifyAccessToken(token);

        if (payload.role !== 'owner') {
          socket.close(4003, 'Only owners may subscribe to booking events');
          decrementIpCount();
          return;
        }

        const revoked = await getRedisClient().get(`deny:${payload.jti}`);
        if (revoked) {
          socket.close(4001, 'Token has been revoked');
          decrementIpCount();
          return;
        }

        ownerId = payload.sub;
        jti = payload.jti;
        exp = payload.exp;
      } catch {
        socket.close(4001, 'Invalid or expired token');
        decrementIpCount();
        return;
      }

      const restaurant = await prisma.restaurant.findFirst({
        where: { id: restaurantId, ownerId, deletedAt: null },
        select: { id: true },
      });

      if (!restaurant) {
        socket.close(4004, 'Restaurant not found or access denied');
        decrementIpCount();
        return;
      }

      // ── Token expiry enforcement (M2) ─────────────────────────────────────
      // Close the socket at token expiry and re-check the deny-list.
      const msUntilExpiry = Math.max(
        (exp - Math.floor(Date.now() / 1000)) * 1000,
        0,
      );
      const expiryTimer = setTimeout(() => {
        void (async () => {
          try {
            const revoked = await getRedisClient().get(`deny:${jti}`);
            if (revoked || Date.now() / 1000 > exp) {
              socket.close(4001, 'Token expired');
            }
          } catch {
            socket.close(4001, 'Token expired');
          }
        })();
      }, msUntilExpiry);

      const unsubscribe = await subscribeToRestaurantChannel(
        restaurantId,
        (raw) => {
          // ── L2: wrap send in try/catch ────────────────────────────────────
          if (socket.readyState === socket.OPEN) {
            try {
              socket.send(raw);
            } catch (err) {
              // Socket closed between readyState check and send — safe to ignore.
              fastify.log.debug({ err }, '[WS] send failed on closed socket');
            }
          }
        },
      );

      try {
        socket.send(JSON.stringify({ eventType: 'ws.connected', restaurantId }));
      } catch {
        // Initial send failed — socket already closed.
      }

      fastify.log.info(
        `[WS] owner ${ownerId} connected to restaurant ${restaurantId}`,
      );

      socket.on('close', () => {
        clearTimeout(expiryTimer);
        decrementIpCount();
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
