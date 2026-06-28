import fp from 'fastify-plugin';
import { env } from '../env.js';

/**
 * Blocks requests that bypass Cloudflare by checking a shared secret
 * injected by a Cloudflare Transform Rule (see LAUNCH_CHECKLIST.md).
 *
 * No-op when:
 *   - NODE_ENV is not 'production'
 *   - CF_ORIGIN_SECRET is not configured
 *
 * Defense in depth — the primary protection is the OS firewall.
 * This plugin catches any gap in the firewall rules.
 */
export const cloudflareOnlyPlugin = fp(
  async (fastify) => {
    const secret = env.CF_ORIGIN_SECRET;

    if (!secret || env.NODE_ENV !== 'production') {
      return;
    }

    fastify.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0] ?? request.url;
      if (path.startsWith('/webhooks/')) {
        return;
      }

      const incoming = request.headers['x-cf-origin-secret'];
      if (incoming !== secret) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    });

    fastify.log.info('[cloudflareOnly] CF-origin secret guard is active');
  },
  { name: 'cloudflareOnly' },
);
