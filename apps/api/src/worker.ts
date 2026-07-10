import { logger } from './lib/logger.js';
import { warmupStores } from './lib/store-warmup.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { reportCriticalError } from './lib/alert.js';
import { prisma } from '@restaurant/db';

/**
 * Standalone notification-worker process.
 *
 * Deploy this alongside the API (with RUN_WORKER_IN_PROCESS=false on the API) so
 * email/notification processing is isolated from request serving: a worker crash
 * or email backlog cannot degrade API availability, and vice versa. Both the
 * BullMQ queue and the notifyOnce idempotency guard already tolerate multiple
 * concurrent workers, so this can also be scaled horizontally.
 */
async function start(): Promise<void> {
  await warmupStores();
  const stopWorker = startNotificationWorker();
  logger.info('✅ Notification worker process started');

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down worker…`);
    await stopWorker();
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    void reportCriticalError({
      source: 'worker-unhandled-rejection',
      message: 'Unhandled promise rejection in the notification worker process',
      err: reason,
    });
  });
  process.on('uncaughtException', (err) => {
    void reportCriticalError({
      source: 'worker-uncaught-exception',
      message: 'Uncaught exception in the notification worker process',
      err,
    });
  });
}

void start().catch((err) => {
  void reportCriticalError({
    source: 'worker-startup',
    message: 'Notification worker failed to start',
    err,
  });
  process.exit(1);
});
