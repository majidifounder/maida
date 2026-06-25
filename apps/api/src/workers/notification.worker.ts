import { Worker, type Job } from 'bullmq';
import { prisma } from '@restaurant/db';
import { env } from '../env.js';
import {
  getBullmqConnection,
  type BookingEventPayload,
} from '../lib/queue.js';
import {
  sendBookingCreated,
  sendBookingConfirmed,
  sendBookingCancelledByDiner,
  sendBookingCancelledByOwner,
  type BookingEmailData,
} from '../services/email.service.js';

async function fetchEmailData(bookingId: string): Promise<BookingEmailData> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      id: true,
      partySize: true,
      slot: { select: { startsAt: true } },
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
    bookingId: booking.id,
    partySize: booking.partySize,
    slotStartsAt: booking.slot.startsAt.toISOString(),
    dinerEmail: booking.diner.email,
    ownerEmail: booking.restaurant.owner.email,
    restaurantName: booking.restaurant.name,
  };
}

async function processNotificationJob(
  job: Job<BookingEventPayload>,
): Promise<void> {
  const { eventType, bookingId, cancelledBy } = job.data;
  const data = await fetchEmailData(bookingId);

  switch (eventType) {
    case 'booking.created':
      await sendBookingCreated(data);
      break;

    case 'booking.confirmed':
      await sendBookingConfirmed(data);
      break;

    case 'booking.cancelled':
      if (cancelledBy === 'owner') {
        await sendBookingCancelledByOwner(data);
      } else {
        await sendBookingCancelledByDiner(data);
      }
      break;

    default: {
      const unknown = eventType as string;
      console.warn(
        `[NotificationWorker] Unknown event type: "${unknown}" on job ${job.id} — skipping`,
      );
    }
  }
}

export function startNotificationWorker(): () => Promise<void> {
  const worker = new Worker<BookingEventPayload>(
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
