import type { FastifyInstance } from 'fastify';
import { canUseLocalLogoStorage, openLocalLogoFile } from './r2-storage.js';

/** Serves dev/test logos written to disk when R2 is not configured. */
export function registerLocalLogoRoutes(fastify: FastifyInstance): void {  if (!canUseLocalLogoStorage()) return;

  fastify.get(
    '/uploads/logos/:restaurantId/:filename',
    async (request, reply) => {
      const { restaurantId, filename } = request.params as {
        restaurantId: string;
        filename: string;
      };

      const file = await openLocalLogoFile(restaurantId, filename);
      if (!file) {
        return reply.code(404).send({ error: 'Not found' });
      }

      return reply
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .type(file.contentType)
        .send(file.stream);
    },
  );
}
