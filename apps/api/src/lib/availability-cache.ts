import { getRedisClient } from './redis.js';
import { logger } from './logger.js';

export const AVAILABILITY_CACHE_TTL_SECONDS = 300;

/** Base Redis key prefix for a restaurant's availability on a local calendar date. */
export function availabilityCachePrefix(restaurantId: string, date: string): string {
  return `restaurant:${restaurantId}:availability:${date}`;
}

/** Full cache key including party size (must match read path in getAvailability). */
export function availabilityCacheKey(
  restaurantId: string,
  date: string,
  partySize: number,
): string {
  return `${availabilityCachePrefix(restaurantId, date)}:${partySize}`;
}

/** Redis SET that tracks all party-size cache keys written for a restaurant date. */
export function availabilityCacheIndexKey(restaurantId: string, date: string): string {
  return `${availabilityCachePrefix(restaurantId, date)}:tracked`;
}

/** Writes availability payload and registers the key in the date index set. */
export async function writeAvailabilityCache(
  restaurantId: string,
  date: string,
  partySize: number,
  payload: string,
  ttlSeconds = AVAILABILITY_CACHE_TTL_SECONDS,
): Promise<void> {
  const cacheKey = availabilityCacheKey(restaurantId, date, partySize);
  const indexKey = availabilityCacheIndexKey(restaurantId, date);
  const redis = getRedisClient();
  await redis
    .multi()
    .set(cacheKey, payload, 'EX', ttlSeconds)
    .sadd(indexKey, cacheKey)
    .expire(indexKey, ttlSeconds)
    .exec();
}

/** Clears every tracked party-size cache entry for a restaurant date. */
export async function invalidateAvailabilityCacheForDate(
  restaurantId: string,
  date: string,
): Promise<void> {
  try {
    const indexKey = availabilityCacheIndexKey(restaurantId, date);
    const redis = getRedisClient();
    const members = await redis.smembers(indexKey);
    if (members.length === 0) {
      await redis.del(indexKey);
      return;
    }
    await redis.del(...members, indexKey);
  } catch (err) {
    logger.warn(
      { err },
      '[Redis] availability cache invalidation failed (non-fatal)',
    );
  }
}
