import { createHmac, timingSafeEqual } from 'node:crypto';
import { SubscriptionStatus } from '@restaurant/db';
import { env } from '../env.js';
import { logger } from './logger.js';

export function verifyLemonSqueezySignature(
  rawBody: Buffer | string,
  signature: string,
): boolean {
  const hmac = createHmac('sha256', env.LEMON_SQUEEZY_WEBHOOK_SECRET);
  const digest = hmac.update(rawBody).digest('hex');
  const digestBuf = Buffer.from(digest, 'hex');
  const sigBuf = Buffer.from(signature, 'hex');

  if (digestBuf.length !== sigBuf.length) return false;
  return timingSafeEqual(digestBuf, sigBuf);
}

export type LsPlan = 'STARTER' | 'PRO' | 'PREMIUM';

export function variantIdToPlan(variantId: number): LsPlan | null {
  const id = String(variantId);
  if (id === env.LS_VARIANT_STARTER) return 'STARTER';
  if (id === env.LS_VARIANT_PRO) return 'PRO';
  if (id === env.LS_VARIANT_PREMIUM) return 'PREMIUM';
  return null;
}

export function lsStatusToInternal(lsStatus: string): SubscriptionStatus {
  switch (lsStatus) {
    case 'on_trial':
      return SubscriptionStatus.TRIALING;
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'paused':
      return SubscriptionStatus.PAUSED;
    case 'past_due':
      return SubscriptionStatus.PAST_DUE;
    case 'unpaid':
      return SubscriptionStatus.PAST_DUE;
    case 'cancelled':
      return SubscriptionStatus.CANCELLED;
    case 'expired':
      return SubscriptionStatus.EXPIRED;
    default:
      logger.warn({ lsStatus }, '[LemonSqueezy] Unknown LS status — defaulting to PAST_DUE');
      return SubscriptionStatus.PAST_DUE;
  }
}

export function webhookIdempotencyKey(
  eventName: string,
  subscriptionId: string,
  updatedAt: string,
): string {
  return `ls-event:${eventName}:${subscriptionId}:${updatedAt}`;
}

export async function lsRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://api.lemonsqueezy.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.LEMON_SQUEEZY_API_KEY}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Lemon Squeezy API error ${res.status}: ${text}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export async function createCheckoutUrl(opts: {
  userId: string;
  userEmail: string;
  variantId: string;
}): Promise<string> {
  const res = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LEMON_SQUEEZY_API_KEY}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: opts.userEmail,
            custom: { user_id: opts.userId },
          },
        },
        relationships: {
          store: {
            data: { type: 'stores', id: env.LEMON_SQUEEZY_STORE_ID },
          },
          variant: {
            data: { type: 'variants', id: opts.variantId },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Lemon Squeezy checkout creation failed: ${res.status} — ${JSON.stringify(body)}`,
    );
  }

  const json = (await res.json()) as {
    data: { attributes: { url: string } };
  };
  return json.data.attributes.url;
}
