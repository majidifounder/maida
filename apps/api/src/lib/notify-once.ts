import { getRedisClient } from './redis.js';

const NOTIFY_TTL_SECONDS = 86_400;
const SENT_MARKER = 'sent';

/**
 * Runs `fn` at most once per key within 24h after a successful run.
 * Marks sent only after `fn` completes so retries are not blocked by a
 * pre-send lock left behind by a crash or failed delivery attempt.
 */
export async function notifyOnce(
  key: string,
  fn: () => Promise<void>,
): Promise<void> {
  const redis = getRedisClient();
  const redisKey = `notify:${key}`;

  try {
    const existing = await redis.get(redisKey);
    if (existing === SENT_MARKER) {
      console.info(`[Notification] Skipping duplicate: ${key}`);
      return;
    }
  } catch (err) {
    console.warn(
      `[Notification] Redis read failed, sending anyway (${key}):`,
      (err as Error).message,
    );
  }

  await fn();

  try {
    await redis.set(redisKey, SENT_MARKER, 'EX', NOTIFY_TTL_SECONDS);
  } catch (err) {
    console.warn(
      `[Notification] Redis write failed after send (${key}):`,
      (err as Error).message,
    );
  }
}

/** Clears idempotency markers — useful in dev after testing notifications. */
export async function clearNotificationMarkers(
  bookingId: string,
): Promise<void> {
  const redis = getRedisClient();
  const keys = await redis.keys(`notify:${bookingId}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
