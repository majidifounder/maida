import { Queue, Worker, type Job } from 'bullmq';
import { prisma } from '@restaurant/db';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { getBullmqConnection } from '../lib/queue.js';
import { reportCriticalError } from '../lib/alert.js';

/**
 * Scheduled maintenance jobs. These keep the DATABASE truthful — previously the
 * API rewrote stale statuses per-response (`deriveDisplayStatus`) while rows
 * stayed SCHEDULED/SEATED forever, so status filters and any DB-level analytics
 * lied — and keep unbounded tables (refresh tokens, audit logs, released holds)
 * from growing forever. Hold-release matters most: the GiST exclusion index that
 * guards every booking is partial on "releasedAt" IS NULL, so releasing finished
 * holds keeps the hottest index on the platform small.
 *
 * Runs on BullMQ job schedulers (idempotent upserts — safe when the API and a
 * standalone worker both start it; workers simply compete for jobs).
 */

export const MAINTENANCE_QUEUE = 'maintenance';

/**
 * Grace before a past reservation is force-completed in the DB. API responses
 * already display it as COMPLETED the moment endsAt passes; the grace keeps a
 * window for support/API corrections (e.g. marking a no-show) before the
 * terminal state is written.
 */
const RECONCILE_GRACE_HOURS = 12;

type MaintenanceJobName =
  | 'reconcile-reservations'
  | 'purge-expired-refresh-tokens'
  | 'prune-audit-logs';

interface JobSpec {
  name: MaintenanceJobName;
  /** cron (BullMQ pattern syntax, UTC) */
  pattern: string;
  run: () => Promise<Record<string, number>>;
}

/**
 * Completes finished reservations and releases their table holds.
 * completedAt is backdated to endsAt — the reservation factually ended then.
 */
async function reconcileReservations(): Promise<Record<string, number>> {
  const completed = await prisma.$executeRaw`
    UPDATE "reservations"
    SET "status" = 'COMPLETED',
        "completedAt" = "endsAt",
        "updatedAt" = now()
    WHERE "status" IN ('SCHEDULED', 'SEATED')
      AND "endsAt" < now() - make_interval(hours => ${RECONCILE_GRACE_HOURS})
  `;

  // Release holds for ANY finished reservation still holding its tables
  // (covers rows completed above and rows completed via free-early historically
  // plus COMPLETED rows from before this job existed).
  const released = await prisma.$executeRaw`
    UPDATE "reservation_tables" rt
    SET "releasedAt" = rt."endsAt"
    FROM "reservations" r
    WHERE rt."reservationId" = r."id"
      AND rt."releasedAt" IS NULL
      AND r."status" IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
      AND rt."endsAt" < now()
  `;

  return { completed, released };
}

/** Expired refresh tokens are dead weight — the JWT itself can no longer verify. */
async function purgeExpiredRefreshTokens(): Promise<Record<string, number>> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { deleted: count };
}

/** Retention-bounded audit trail (AUDIT_LOG_RETENTION_DAYS, default 365). */
async function pruneAuditLogs(): Promise<Record<string, number>> {
  const cutoff = new Date(
    Date.now() - env.AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const { count } = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: count };
}

const JOBS: JobSpec[] = [
  { name: 'reconcile-reservations', pattern: '*/5 * * * *', run: reconcileReservations },
  { name: 'purge-expired-refresh-tokens', pattern: '20 4 * * *', run: purgeExpiredRefreshTokens },
  { name: 'prune-audit-logs', pattern: '40 4 * * *', run: pruneAuditLogs },
];

/** Exported for tests. */
export const __maintenanceJobs = {
  reconcileReservations,
  purgeExpiredRefreshTokens,
  pruneAuditLogs,
};

export function startMaintenanceWorker(): () => Promise<void> {
  const queue = new Queue(MAINTENANCE_QUEUE, {
    connection: getBullmqConnection(),
    defaultJobOptions: {
      removeOnComplete: 20,
      removeOnFail: 50,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    },
  });

  // Idempotent by scheduler id — restarts and multiple processes converge on
  // one schedule per job.
  for (const job of JOBS) {
    queue
      .upsertJobScheduler(job.name, { pattern: job.pattern }, { name: job.name })
      .catch((err: unknown) => {
        logger.error({ err, job: job.name }, '[Maintenance] failed to schedule job');
      });
  }

  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job: Job) => {
      const spec = JOBS.find((j) => j.name === job.name);
      if (!spec) {
        logger.warn({ jobName: job.name }, '[Maintenance] unknown job — skipping');
        return;
      }
      const started = Date.now();
      const result = await spec.run();
      logger.info(
        { job: job.name, ...result, ms: Date.now() - started },
        '[Maintenance] job completed',
      );
    },
    {
      connection: getBullmqConnection(),
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobName: job?.name, err }, '[Maintenance] job failed');
    const attempts = job?.opts.attempts ?? 1;
    if (job && job.attemptsMade >= attempts) {
      void reportCriticalError({
        source: 'maintenance-worker',
        message: `Maintenance job ${job.name} failed after all retries`,
        err,
      });
    }
  });

  worker.on('error', (err) => {
    logger.error({ err }, '[Maintenance] worker error');
  });

  logger.info('[Maintenance] worker started (reconcile 5m, purges daily)');

  return async () => {
    await worker.close();
    await queue.close();
  };
}
