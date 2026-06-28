import type { FastifyRequest } from 'fastify';

/**
 * Returns the real client IP address.
 *
 * When behind Cloudflare, CF-Connecting-IP is the true client IP.
 * It is set by Cloudflare and cannot be forged through the proxy.
 * Falls back to req.ip (socket IP) when Cloudflare is not in front,
 * which is the case in local development and in the test suite.
 */
export function getRealIp(request: Pick<FastifyRequest, 'headers' | 'ip'>): string {
  const cfIp = request.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim().length > 0) {
    return cfIp.trim();
  }
  return request.ip;
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
