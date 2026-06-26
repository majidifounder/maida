import { Queue } from 'bullmq';
import { env } from '../env.js';

export type BookingEventType =
  | 'booking.created'
  | 'booking.cancelled'
  | 'booking.confirmed';

export interface BookingEventPayload {
  eventType: BookingEventType;
  publishedAt: string;
  bookingId: string;
  dinerId?: string;
  restaurantId?: string;
  slotId?: string;
  partySize?: number;
  cancelledBy?: 'diner' | 'owner';
}

export function getBullmqConnection() {
  return {
    url: env.REDIS_URL,
    ...(env.REDIS_URL.startsWith('rediss://')
      ? { tls: { rejectUnauthorized: false } }
      : {}),
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

export async function publishBookingEvent(
  eventType: 'booking.created' | 'booking.cancelled' | 'booking.confirmed',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const job = await getQueue().add(eventType, {
      ...payload,
      eventType,
      publishedAt: new Date().toISOString(),
    });
    console.info(
      `[Queue] Enqueued ${eventType} job ${job.id} for booking ${String(payload.bookingId ?? 'unknown')}`,
    );
  } catch (err) {
    console.warn(
      `[Queue] failed to publish ${eventType}:`,
      (err as Error).message,
    );
  }
}
