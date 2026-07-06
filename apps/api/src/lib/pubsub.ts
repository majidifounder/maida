import { getRedisClient, createSubscriberClient } from './redis.js';
import { Redis } from 'ioredis';

const listeners = new Map<string, Set<(payload: string) => void>>();

let subscriber: Redis | null = null;

async function getSubscriber(): Promise<Redis> {
  if (!subscriber) {
    subscriber = createSubscriberClient();
    await subscriber.connect();

    subscriber.on('message', (channel: string, message: string) => {
      const handlers = listeners.get(channel);
      if (handlers) {
        for (const handler of handlers) {
          handler(message);
        }
      }
    });

    subscriber.on('error', (err: Error) => {
      console.warn('[PubSub] subscriber error (non-fatal):', err.message);
    });
  }
  return subscriber;
}

export function reservationChannel(restaurantId: string): string {
  return `reservation:restaurant:${restaurantId}`;
}

/** @deprecated alias for reservationChannel */
export function bookingChannel(restaurantId: string): string {
  return reservationChannel(restaurantId);
}

export async function publishToRestaurantChannel(
  restaurantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.publish(reservationChannel(restaurantId), JSON.stringify(payload));
  } catch (err) {
    console.warn('[PubSub] publish failed (non-fatal):', (err as Error).message);
  }
}

export async function subscribeToRestaurantChannel(
  restaurantId: string,
  handler: (payload: string) => void,
): Promise<() => Promise<void>> {
  const channel = reservationChannel(restaurantId);

  if (!listeners.has(channel)) {
    listeners.set(channel, new Set());
    const sub = await getSubscriber();
    await sub.subscribe(channel);
  }

  listeners.get(channel)!.add(handler);

  return async () => {
    const handlers = listeners.get(channel);
    if (!handlers) return;
    handlers.delete(handler);

    if (handlers.size === 0) {
      listeners.delete(channel);
      const sub = await getSubscriber();
      await sub.unsubscribe(channel);
    }
  };
}
