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

// ── Versioned full-response entries ──────────────────────────────────────────
// Reservation mutations invalidate per-date (precise, immediate — see
// invalidateAvailabilityCacheForDate). CONFIG mutations (hours, closures,
// tables, combinations, turn-time rules, engine settings) change availability
// for EVERY future date at once; enumerating dates is impossible with per-date
// index sets. Instead, each restaurant has a monotonically increasing version;
// entries embed the version they were computed under, and a reader treats a
// version mismatch as a miss. Bumping the version is a single INCR — O(1)
// invalidation across all dates and party sizes.

/** Per-restaurant availability config version. No TTL — a counter, not data. */
export function availabilityVersionKey(restaurantId: string): string {
  return `restaurant:${restaurantId}:availver`;
}

/**
 * Call after ANY mutation that reshapes availability for many dates.
 * Best-effort: on Redis failure entries stay valid until their TTL (≤300s) —
 * the same staleness bound the cache already accepts.
 */
export async function bumpAvailabilityVersion(
  restaurantId: string,
): Promise<void> {
  try {
    await getRedisClient().incr(availabilityVersionKey(restaurantId));
  } catch (err) {
    logger.warn(
      { err, restaurantId },
      '[Redis] availability version bump failed (stale ≤ TTL, non-fatal)',
    );
  }
}

/**
 * The FULL availability response is cached — not just the slot list — so a
 * cache hit answers the detail endpoint without touching the schedule, the
 * turn-time rules, or the engine at all.
 */
export interface AvailabilityCacheEntry {
  v: number;
  times: Array<{ startsAt: string; endsAt: string; durationMins: number }>;
  serviceWindows: Array<{ open: string; close: string }>;
  standardDurationMins: number;
}

function parseEntry(
  raw: string | null,
  currentVersion: number,
): AvailabilityCacheEntry | null {
  if (raw == null) return null;
  try {
    const entry = JSON.parse(raw) as AvailabilityCacheEntry;
    if (typeof entry.v !== 'number' || entry.v !== currentVersion) return null;
    return entry;
  } catch {
    return null;
  }
}

function versionFromRaw(raw: string | null): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Single-restaurant read: one MGET (version + entry), version-checked. */
export async function readAvailabilityEntry(
  restaurantId: string,
  date: string,
  partySize: number,
): Promise<AvailabilityCacheEntry | null> {
  try {
    const redis = getRedisClient();
    const [ver, raw] = await redis.mget(
      availabilityVersionKey(restaurantId),
      availabilityCacheKey(restaurantId, date, partySize),
    );
    return parseEntry(raw ?? null, versionFromRaw(ver ?? null));
  } catch (err) {
    logger.warn({ err }, '[Redis] availability read failed (non-fatal)');
    return null;
  }
}

/**
 * Batch read for search: one MGET of 2N keys (N versions + N entries).
 * Any Redis failure degrades to all-misses — the cache never gates
 * correctness, only cost.
 */
export async function readAvailabilityEntriesBatch(
  restaurantIds: string[],
  date: string,
  partySize: number,
): Promise<Array<AvailabilityCacheEntry | null>> {
  if (restaurantIds.length === 0) return [];
  try {
    const redis = getRedisClient();
    const keys = [
      ...restaurantIds.map((id) => availabilityVersionKey(id)),
      ...restaurantIds.map((id) => availabilityCacheKey(id, date, partySize)),
    ];
    const values = await redis.mget(...keys);
    const n = restaurantIds.length;
    return restaurantIds.map((_, i) =>
      parseEntry(values[n + i] ?? null, versionFromRaw(values[i] ?? null)),
    );
  } catch (err) {
    logger.warn({ err }, '[Redis] batch availability read failed (non-fatal)');
    return restaurantIds.map(() => null);
  }
}

/** Stamps the current version into the entry and stores it. */
export async function writeAvailabilityEntry(
  restaurantId: string,
  date: string,
  partySize: number,
  data: Omit<AvailabilityCacheEntry, 'v'>,
): Promise<void> {
  const redis = getRedisClient();
  const ver = versionFromRaw(
    await redis.get(availabilityVersionKey(restaurantId)),
  );
  await writeAvailabilityCache(
    restaurantId,
    date,
    partySize,
    JSON.stringify({ v: ver, ...data } satisfies AvailabilityCacheEntry),
  );
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
