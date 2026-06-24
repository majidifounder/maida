import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../env.js';

let _client: Redis | null = null;

function baseOptions(): RedisOptions {
  return {
    ...(env.REDIS_URL.startsWith('rediss://')
      ? { tls: { rejectUnauthorized: false } }
      : {}),
    connectTimeout: 5_000,
    lazyConnect: true,
  };
}

export function getRedisClient(): Redis {
  if (!_client) {
    _client = new Redis(env.REDIS_URL, {
      ...baseOptions(),
      maxRetriesPerRequest: 3,
    });

    _client.on('error', (err: Error) => {
      console.error('[Redis] connection error:', err.message);
    });
  }
  return _client;
}

export function createSubscriberClient(): Redis {
  return new Redis(env.REDIS_URL, {
    ...baseOptions(),
    maxRetriesPerRequest: null,
  });
}
