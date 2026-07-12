import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../env.js';
import { logger } from './logger.js';

let _client: Redis | null = null;
// A single in-flight connection attempt shared by all concurrent callers.
let _connecting: Promise<Redis> | null = null;

function baseOptions(): RedisOptions {
  return {
    // Prefer IPv4 — Windows + Upstash often hangs on broken IPv6 routes.
    family: 4,
    // Upstash from Windows can be slow to establish the first TLS connection;
    // 2s was tight enough to time out under parallel test workers.
    connectTimeout: 5_000,
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

/** Resolve once the client reaches 'ready', or reject if it errors/ends. */
function waitForReady(redis: Redis): Promise<Redis> {
  return new Promise<Redis>((resolve, reject) => {
    const cleanup = (): void => {
      redis.removeListener('ready', onReady);
      redis.removeListener('error', onError);
      redis.removeListener('end', onEnd);
    };
    const onReady = (): void => {
      cleanup();
      resolve(redis);
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onEnd = (): void => {
      cleanup();
      reject(new Error('Redis connection ended before ready'));
    };
    redis.once('ready', onReady);
    redis.once('error', onError);
    redis.once('end', onEnd);
  });
}

/**
 * Ensure the shared client is connected, or fail within timeoutMs.
 *
 * Concurrent callers coalesce onto ONE connection attempt. ioredis rejects a
 * second `connect()` while one is already in flight ("Redis is already
 * connecting/connected"), which previously turned simultaneous authenticated
 * requests into 503s (e.g. two bookings racing for the same table). A caller
 * that arrives mid-connect waits for the 'ready' event instead of issuing a
 * competing connect.
 */
export async function ensureRedisConnected(timeoutMs = 5_000): Promise<Redis> {
  const redis = getRedisClient();
  if (redis.status === 'ready') return redis;

  if (!_connecting) {
    _connecting = (async (): Promise<Redis> => {
      try {
        // connect() is only valid from an idle state; from 'connecting' /
        // 'connect' / 'reconnecting' we await the ready event it will emit.
        const idle =
          redis.status === 'wait' ||
          redis.status === 'close' ||
          redis.status === 'end';
        if (idle) {
          await withTimeout(redis.connect(), timeoutMs, 'Redis connect timeout');
        } else {
          await withTimeout(waitForReady(redis), timeoutMs, 'Redis connect timeout');
        }
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
    })().finally(() => {
      _connecting = null;
    });
  }

  return _connecting;
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
