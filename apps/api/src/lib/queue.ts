import { Queue } from 'bullmq';
import { env } from '../env.js';
import { getRedisClient } from './redis.js';

export type ReservationEventType =
  | 'reservation.created'
  | 'reservation.seated'
  | 'reservation.extended'
  | 'reservation.freed_early'
  | 'reservation.cancelled'
  | 'reservation.no_show';

export interface ReservationEventPayload {
  eventType: ReservationEventType;
  publishedAt: string;
  reservationId: string;
  dinerId?: string;
  restaurantId?: string;
  partySize?: number;
  startsAt?: string;
  cancelledBy?: 'diner' | 'owner' | 'staff';
}

export function getBullmqConnection() {
  return {
    url: env.REDIS_URL,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

let _queue: Queue | null = null;

function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(env.QUEUE_NAME, {
      connection: getBullmqConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }
  return _queue;
}

const PUBLISH_RATE_LIMIT = 60;
const PUBLISH_RATE_WINDOW_SECONDS = 60;

export async function publishReservationEvent(
  eventType: ReservationEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const restaurantId = String(payload.restaurantId ?? 'unknown');
    if (restaurantId !== 'unknown') {
      const redis = getRedisClient();
      const rateLimitKey = `queue:rate:${restaurantId}`;
      const count = await redis.incr(rateLimitKey);
      if (count === 1) {
        await redis.expire(rateLimitKey, PUBLISH_RATE_WINDOW_SECONDS);
      }
      if (count > PUBLISH_RATE_LIMIT) {
        console.warn(
          `[Queue] publish rate limit exceeded for restaurant ${restaurantId} — event dropped`,
        );
        return;
      }
    }

    const job = await getQueue().add(eventType, {
      ...payload,
      eventType,
      publishedAt: new Date().toISOString(),
    });
    console.info(
      `[Queue] Enqueued ${eventType} job ${job.id} for reservation ${String(payload.reservationId ?? 'unknown')}`,
    );
  } catch (err) {
    console.warn(
      `[Queue] failed to publish ${eventType}:`,
      (err as Error).message,
    );
  }
}

/** @deprecated Use publishReservationEvent */
export const publishBookingEvent = publishReservationEvent;

export type BookingEventType = ReservationEventType;
export type BookingEventPayload = ReservationEventPayload;
