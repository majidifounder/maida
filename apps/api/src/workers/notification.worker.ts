import { Worker, type Job } from 'bullmq';
import { prisma, Prisma } from '@restaurant/db';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import {
  getBullmqConnection,
  scheduleReservationReminder,
  type ReservationEventPayload,
} from '../lib/queue.js';
import {
  sendReservationCreated,
  sendReservationSeated,
  sendReservationCancelledByDiner,
  sendReservationCancelledByOwner,
  sendReservationReminder,
  type ReservationEmailData,
} from '../services/email.service.js';
import { reportCriticalError } from '../lib/alert.js';

async function fetchEmailData(
  reservationId: string,
): Promise<ReservationEmailData> {
  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: {
      id: true,
      partySize: true,
      startsAt: true,
      endsAt: true,
      status: true,
      diner: { select: { email: true } },
      restaurant: {
        select: {
          name: true,
          timezone: true,
          address: true,
          city: true,
          owner: { select: { email: true } },
        },
      },
    },
  });

  return {
    reservationId: reservation.id,
    partySize: reservation.partySize,
    startsAt: reservation.startsAt.toISOString(),
    endsAt: reservation.endsAt.toISOString(),
    status: reservation.status,
    dinerEmail: reservation.diner?.email ?? null,
    ownerEmail: reservation.restaurant.owner.email,
    restaurantName: reservation.restaurant.name,
    restaurantTimezone: reservation.restaurant.timezone,
    restaurantAddress: reservation.restaurant.address,
    restaurantCity: reservation.restaurant.city,
  };
}

async function processNotificationJob(
  job: Job<ReservationEventPayload>,
): Promise<void> {
  const { eventType, reservationId, cancelledBy } = job.data;

  let data: ReservationEmailData;
  try {
    data = await fetchEmailData(reservationId);
  } catch (err) {
    // Reservation gone (hard-deleted: GDPR erasure, admin cleanup, test data).
    // There is nothing left to notify anyone about — complete the job quietly
    // instead of burning retries and paging the operator.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2025'
    ) {
      logger.warn(
        { jobId: job.id, eventType, reservationId },
        '[NotificationWorker] reservation no longer exists — skipping notification',
      );
      return;
    }
    throw err;
  }

  switch (eventType) {
    case 'reservation.created':
      await sendReservationCreated(data);
      // Day-of reminder for future-dated bookings with a reachable diner.
      // Walk-ins (startsAt ≈ now) are skipped by the lead-time rules.
      if (data.dinerEmail) {
        await scheduleReservationReminder(
          data.reservationId,
          new Date(data.startsAt),
        );
      }
      break;

    case 'reservation.reminder':
      // Status re-checked at delivery time — a reservation cancelled after
      // scheduling simply produces no email.
      if (data.status === 'SCHEDULED') {
        await sendReservationReminder(data);
      }
      break;

    case 'reservation.seated':
      await sendReservationSeated(data);
      break;

    case 'reservation.cancelled':
      if (cancelledBy === 'owner' || cancelledBy === 'staff') {
        await sendReservationCancelledByOwner(data);
      } else {
        await sendReservationCancelledByDiner(data);
      }
      break;

    default:
      logger.warn(
        { eventType, jobId: job.id },
        '[NotificationWorker] No email handler for event',
      );
  }
}

export { processNotificationJob };

export function startNotificationWorker(): () => Promise<void> {
  const worker = new Worker<ReservationEventPayload>(
    env.QUEUE_NAME,
    processNotificationJob,
    {
      connection: getBullmqConnection(),
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, eventType: job.data.eventType },
      '[NotificationWorker] job completed',
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, eventType: job?.data.eventType, err },
      '[NotificationWorker] job failed',
    );
    // Alert only once the job has exhausted its retries — a dead notification is
    // operator-actionable (a diner/owner never got their email).
    const attempts = job?.opts.attempts ?? 1;
    if (job && job.attemptsMade >= attempts) {
      void reportCriticalError({
        source: 'notification-worker',
        message: 'Notification job failed after all retries',
        err,
        detail: {
          jobId: job.id,
          eventType: job.data.eventType,
          reservationId: job.data.reservationId,
        },
      });
    }
  });

  worker.on('error', (err) => {
    logger.error({ err }, '[NotificationWorker] worker error');
  });

  logger.info({ queue: env.QUEUE_NAME }, '[NotificationWorker] listening on queue');

  return async () => {
    await worker.close();
    logger.info('[NotificationWorker] gracefully stopped');
  };
}
