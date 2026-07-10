import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { env } from '../env.js';

function timingSafeMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Returns the real client IP address.
 *
 * CF-Connecting-IP is only trustworthy when the request PROVABLY came through
 * Cloudflare. When CF_ORIGIN_SECRET is configured, the accompanying
 * x-cf-origin-secret header (injected by a Cloudflare Transform Rule) is that
 * proof — a request that reaches the origin directly can type any
 * CF-Connecting-IP it likes, which would let an attacker rotate identities
 * per request and neuter every rate limit, lockout, and threat ban.
 *
 * Without CF_ORIGIN_SECRET (local dev, tests, staging without Cloudflare) the
 * header is trusted as before — those environments have no adversarial edge.
 */
export function getRealIp(request: Pick<FastifyRequest, 'headers' | 'ip'>): string {
  const cfIp = request.headers['cf-connecting-ip'];
  if (typeof cfIp !== 'string' || cfIp.trim().length === 0) {
    return request.ip;
  }

  if (env.CF_ORIGIN_SECRET) {
    const provided = request.headers['x-cf-origin-secret'];
    const cameThroughCloudflare =
      typeof provided === 'string' &&
      timingSafeMatch(provided, env.CF_ORIGIN_SECRET);
    if (!cameThroughCloudflare) return request.ip;
  }

  return cfIp.trim();
}

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifies a Cloudflare Turnstile token server-side.
 * Throws if the Turnstile API itself is unreachable.
 * Returns false if the token is invalid or expired.
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp: string,
  secretKey: string,
): Promise<boolean> {
  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
    remoteip: remoteIp,
  });

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Turnstile API responded with HTTP ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    success: boolean;
    'error-codes': string[];
  };

  return data.success;
}
