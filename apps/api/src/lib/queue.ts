import { Queue } from 'bullmq';
import { env } from '../env.js';

let _queue: Queue | null = null;

function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(env.QUEUE_NAME, {
      connection: {
        url: env.REDIS_URL,
        ...(env.REDIS_URL.startsWith('rediss://')
          ? { tls: { rejectUnauthorized: false } }
          : {}),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
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
    await getQueue().add(eventType, {
      ...payload,
      eventType,
      publishedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(
      `[Queue] failed to publish ${eventType}:`,
      (err as Error).message,
    );
  }
}
