import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../env.js';
import { logger } from './logger.js';

let _client: Redis | null = null;

function baseOptions(): RedisOptions {
  return {
    // Prefer IPv4 — Windows + Upstash often hangs on broken IPv6 routes.
    family: 4,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    lazyConnect: true,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    // Never reconnect forever when Redis is unreachable.
    retryStrategy: () => null,
    reconnectOnError: () => false,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function getRedisClient(): Redis {
  if (_client && (_client.status === 'end' || _client.status === 'close')) {
    _client = null;
  }

  if (!_client) {
    _client = new Redis(env.REDIS_URL, baseOptions());

    _client.on('error', (err: Error) => {
      logger.error({ err }, '[Redis] connection error');
    });
  }
  return _client;
}

/** Ensure the shared client is connected, or fail within timeoutMs. */
export async function ensureRedisConnected(timeoutMs = 2_000): Promise<Redis> {
  const redis = getRedisClient();
  if (redis.status === 'ready') return redis;

  try {
    await withTimeout(redis.connect(), timeoutMs, 'Redis connect timeout');
    return redis;
  } catch (err) {
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
    _client = null;
    throw err;
  }
}

/** One-shot ping that cannot leave a stuck connecting client behind. */
export async function pingRedis(timeoutMs = 2_000): Promise<void> {
  const client = new Redis(env.REDIS_URL, {
    ...baseOptions(),
    lazyConnect: true,
  });

  try {
    await withTimeout(client.connect(), timeoutMs, 'Redis connect timeout');
    const reply = await withTimeout(client.ping(), timeoutMs, 'Redis ping timeout');
    if (reply !== 'PONG') {
      throw new Error(`Unexpected Redis PING reply: ${String(reply)}`);
    }
  } finally {
    client.disconnect();
  }
}

export function createSubscriberClient(): Redis {
  return new Redis(env.REDIS_URL, {
    ...baseOptions(),
    maxRetriesPerRequest: null,
  });
}
