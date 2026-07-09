import { Worker, type Job } from 'bullmq';
import { prisma } from '@restaurant/db';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import {
  getBullmqConnection,
  type ReservationEventPayload,
} from '../lib/queue.js';
import {
  sendReservationCreated,
  sendReservationSeated,
  sendReservationCancelledByDiner,
  sendReservationCancelledByOwner,
  type ReservationEmailData,
} from '../services/email.service.js';

async function fetchEmailData(
  reservationId: string,
): Promise<ReservationEmailData> {
  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: {
      id: true,
      partySize: true,
      startsAt: true,
      diner: { select: { email: true } },
      restaurant: {
        select: {
          name: true,
          owner: { select: { email: true } },
        },
      },
    },
  });

  return {
    reservationId: reservation.id,
    partySize: reservation.partySize,
    startsAt: reservation.startsAt.toISOString(),
    dinerEmail: reservation.diner?.email ?? 'guest@walk-in.local',
    ownerEmail: reservation.restaurant.owner.email,
    restaurantName: reservation.restaurant.name,
  };
}

async function processNotificationJob(
  job: Job<ReservationEventPayload>,
): Promise<void> {
  const { eventType, reservationId, cancelledBy } = job.data;
  const data = await fetchEmailData(reservationId);

  switch (eventType) {
    case 'reservation.created':
      await sendReservationCreated(data);
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
