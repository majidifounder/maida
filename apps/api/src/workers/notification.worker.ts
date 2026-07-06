import { Worker, type Job } from 'bullmq';
import { prisma } from '@restaurant/db';
import { env } from '../env.js';
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
      console.warn(
        `[NotificationWorker] No email handler for "${eventType}" on job ${job.id}`,
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
    console.info(
      `[NotificationWorker] ✓ job ${job.id} — event: ${job.data.eventType}`,
    );
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[NotificationWorker] ✗ job ${job?.id} — event: ${job?.data.eventType}`,
      err,
    );
  });

  worker.on('error', (err) => {
    console.error('[NotificationWorker] Worker error', err);
  });

  console.info(`[NotificationWorker] Listening on queue "${env.QUEUE_NAME}"`);

  return async () => {
    await worker.close();
    console.info('[NotificationWorker] Gracefully stopped');
  };
}
