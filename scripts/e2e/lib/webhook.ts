import { createHmac } from 'node:crypto';
import { fetch } from 'undici';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export interface WebhookPayload {
  meta: {
    event_name: string;
    custom_data: { user_id: string };
  };
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      variant_id: number;
      renews_at: string | null;
      ends_at: string | null;
      cancelled: boolean;
      updated_at: string;
    };
  };
}

export function buildWebhookPayload(
  eventName: string,
  userId: string,
  opts: {
    subId?: string;
    variantId?: number;
    status?: string;
    cancelled?: boolean;
    updatedAt?: string;
  } = {},
): WebhookPayload {
  return {
    meta: {
      event_name: eventName,
      custom_data: { user_id: userId },
    },
    data: {
      id: opts.subId ?? `e2e-ls-${userId.slice(0, 8)}`,
      type: 'subscriptions',
      attributes: {
        status: opts.status ?? 'active',
        variant_id: opts.variantId ?? Number(process.env.LS_VARIANT_PRO),
        renews_at: '2027-01-01T00:00:00.000Z',
        ends_at: null,
        cancelled: opts.cancelled ?? false,
        updated_at: opts.updatedAt ?? new Date().toISOString(),
      },
    },
  };
}

export async function sendWebhook(
  base: string,
  payload: WebhookPayload,
): Promise<{ status: number; body: unknown }> {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) throw new Error('LEMON_SQUEEZY_WEBHOOK_SECRET is required');

  const body = JSON.stringify(payload);
  const res = await fetch(`${base}/webhooks/lemon-squeezy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': sign(body, secret),
    },
    body,
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // keep raw text
  }

  return { status: res.status, body: parsed };
}
