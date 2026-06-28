import { getRedisClient } from './redis.js';

const NOTIFY_TTL_SECONDS = 86_400;
const SENT_MARKER = 'sent';

/**
 * Runs `fn` at most once per key within 24h.
 *
 * Uses an atomic SET NX to claim the key before calling `fn`.
 * If two concurrent workers race, only one wins the SET NX and sends.
 * If `fn` fails, the key is deleted so BullMQ retries can attempt again.
 */
export async function notifyOnce(
  key: string,
  fn: () => Promise<void>,
): Promise<void> {
  const redis = getRedisClient();
  const redisKey = `notify:${key}`;

  let acquired = false;
  try {
    // SET NX is atomic: only one worker wins; null means someone else already claimed it.
    const result = await redis.set(redisKey, SENT_MARKER, 'EX', NOTIFY_TTL_SECONDS, 'NX');
    acquired = result === 'OK';
  } catch (err) {
    console.warn(
      `[Notification] Redis SET NX failed, sending anyway (${key}):`,
      (err as Error).message,
    );
    // Fail open: if Redis is unavailable, attempt the send rather than silently drop it.
    acquired = true;
  }

  if (!acquired) {
    console.info(`[Notification] Skipping duplicate: ${key}`);
    return;
  }

  try {
    await fn();
  } catch (err) {
    // Send failed — delete the key so BullMQ retry can attempt again.
    try {
      await redis.del(redisKey);
    } catch {
      // Best-effort cleanup; if this also fails, the key will expire in 24h.
    }
    throw err;
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
