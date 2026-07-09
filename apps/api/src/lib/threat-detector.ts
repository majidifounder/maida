import { ensureRedisConnected } from './redis.js';
import { logger } from './logger.js';

const THREAT_WINDOWS = {
  AUTH_FAILURES: { key: 'threat:auth:', max: 10, windowSec: 300 },
  NOT_FOUND:     { key: 'threat:404:', max: 30, windowSec: 60 },
  FORBIDDEN:     { key: 'threat:403:', max: 15, windowSec: 300 },
} as const;

const EXTENDED_BAN_TTL = 3600;
const EXTENDED_BAN_PREFIX = 'ban:';

export async function recordThreatSignal(
  ip: string,
  type: keyof typeof THREAT_WINDOWS,
): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  const config = THREAT_WINDOWS[type];
  const key = `${config.key}${ip}`;

  try {
    const redis = await ensureRedisConnected(1_500);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, config.windowSec);

    if (count >= config.max) {
      await redis.set(`${EXTENDED_BAN_PREFIX}${ip}`, '1', 'EX', EXTENDED_BAN_TTL);
      logger.warn({ ip, type, count }, 'Threat detected — extended ban applied');
    }
  } catch {
    // Non-fatal — never block a request because threat detection failed
  }
}

export async function isExtendedBanned(ip: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'test') return false;

  try {
    const redis = await ensureRedisConnected(1_500);
    const banned = await redis.get(`${EXTENDED_BAN_PREFIX}${ip}`);
    return banned !== null;
  } catch {
    return false;
  }
}
