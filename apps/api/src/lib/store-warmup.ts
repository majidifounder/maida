import { prisma } from '@restaurant/db';
import { logger } from './logger.js';
import { pingRedis } from './redis.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReachabilityError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Can't reach database server") ||
    message.includes('Connection timed out') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('Redis ping timeout')
  );
}

/** Wait for the database before accepting traffic. Redis is best-effort. */
export async function warmupStores(maxAttempts = 6): Promise<void> {
  let lastError: unknown;
  let databaseOk = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      databaseOk = true;
      break;
    } catch (err) {
      lastError = err;
      if (!isReachabilityError(err)) throw err;

      const waitSec = Math.min(attempt * 2, 8);
      logger.warn(
        { attempt, maxAttempts, waitSec, err },
        'Database not ready — retrying (Supabase may be waking up)',
      );
      if (attempt < maxAttempts) await sleep(waitSec * 1000);
    }
  }

  if (!databaseOk) {
    logger.error(
      { err: lastError },
      'Database warmup failed — check Supabase dashboard (paused?) and DATABASE_URL in .env',
    );
    throw lastError;
  }

  try {
    await pingRedis(2_000);
  } catch (err) {
    logger.warn(
      { err },
      'Redis warmup failed — starting anyway; /health/ready will report redis error',
    );
  }
}
