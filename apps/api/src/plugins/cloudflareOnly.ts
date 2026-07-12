import { createHash, timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import { env } from '../env.js';

/** Constant-time secret comparison — hashed first so unequal lengths are safe. */
function secretMatches(incoming: unknown, expected: string): boolean {
  if (typeof incoming !== 'string') return false;
  const a = createHash('sha256').update(incoming).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

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
  (fastify) => {
    const secret = env.CF_ORIGIN_SECRET;

    if (!secret || env.NODE_ENV !== 'production') {
      return;
    }

    fastify.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0] ?? request.url;
      if (path.startsWith('/webhooks/')) {
        return;
      }

      if (!secretMatches(request.headers['x-cf-origin-secret'], secret)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    });

    fastify.log.info('[cloudflareOnly] CF-origin secret guard is active');
  },
  { name: 'cloudflareOnly' },
);
