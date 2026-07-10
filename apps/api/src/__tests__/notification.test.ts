import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';

const {
  mockEmailSend,
  mockFindUniqueOrThrow,
  mockWorkerOn,
  mockWorkerClose,
  MockWorker,
  MockResend,
} = vi.hoisted(() => {
  const mockEmailSend = vi.fn().mockResolvedValue({ id: 'mock-resend-id' });
  const mockFindUniqueOrThrow = vi.fn();
  const mockWorkerOn = vi.fn();
  const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
  const MockWorker = vi.fn(function MockWorker(this: {
    on: typeof mockWorkerOn;
    close: typeof mockWorkerClose;
  }) {
    this.on = mockWorkerOn;
    this.close = mockWorkerClose;
  });
  const MockResend = vi.fn(function MockResend(this: {
    emails: { send: typeof mockEmailSend };
  }) {
    this.emails = { send: mockEmailSend };
  });
  return {
    mockEmailSend,
    mockFindUniqueOrThrow,
    mockWorkerOn,
    mockWorkerClose,
    MockWorker,
    MockResend,
  };
});

vi.mock('bullmq', () => ({
  Worker: MockWorker,
}));

vi.mock('resend', () => ({
  Resend: MockResend,
}));

vi.mock('@restaurant/db', () => ({
  prisma: {
    reservation: { findUniqueOrThrow: mockFindUniqueOrThrow },
  },
}));

vi.mock('../lib/notify-once.js', () => ({
  notifyOnce: (_key: string, fn: () => Promise<void>) => fn(),
}));

import {
  sendReservationCreated,
  sendReservationSeated,
  sendReservationCancelledByDiner,
  sendReservationCancelledByOwner,
  type ReservationEmailData,
} from '../services/email.service.js';
import {
  processNotificationJob,
  startNotificationWorker,
} from '../workers/notification.worker.js';
import type {
  ReservationEventPayload,
  ReservationEventType,
} from '../lib/queue.js';

const MOCK_RESERVATION_ID = 'aaaabbbb-0000-0000-0000-000000000001';

const MOCK_DB_RESERVATION = {
  id: MOCK_RESERVATION_ID,
  partySize: 3,
  startsAt: new Date('2026-09-15T19:00:00.000Z'),
  diner: { email: 'diner@example.com' },
  restaurant: {
    name: 'La Bella',
    timezone: 'Europe/Paris',
    owner: { email: 'owner@labella.com' },
  },
};

const BASE_EMAIL_DATA: ReservationEmailData = {
  reservationId: MOCK_RESERVATION_ID,
  partySize: MOCK_DB_RESERVATION.partySize,
  startsAt: MOCK_DB_RESERVATION.startsAt.toISOString(),
  dinerEmail: MOCK_DB_RESERVATION.diner.email,
  ownerEmail: MOCK_DB_RESERVATION.restaurant.owner.email,
  restaurantName: MOCK_DB_RESERVATION.restaurant.name,
  restaurantTimezone: MOCK_DB_RESERVATION.restaurant.timezone,
};

function emailCalls(): Array<{ to: string; subject: string; html: string }> {
  return mockEmailSend.mock.calls.map(
    ([arg]) => arg as { to: string; subject: string; html: string },
  );
}

function makeJob(
  data: Partial<ReservationEventPayload> &
    Pick<ReservationEventPayload, 'eventType' | 'reservationId'>,
): Job<ReservationEventPayload> {
  return {
    id: 'job-1',
    data: {
      publishedAt: new Date().toISOString(),
      ...data,
    },
  } as Job<ReservationEventPayload>;
}

describe('email.service', () => {
  beforeEach(() => {
    mockEmailSend.mockClear();
  });

  describe('sendReservationCreated', () => {
    it('sends two emails — one to diner, one to owner', async () => {
      await sendReservationCreated(BASE_EMAIL_DATA);

      const calls = emailCalls();
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.to)).toEqual(
        expect.arrayContaining(['diner@example.com', 'owner@labella.com']),
      );
    });

    it('diner email subject contains the restaurant name', async () => {
      await sendReservationCreated(BASE_EMAIL_DATA);

      const dinerCall = emailCalls().find((c) => c.to === 'diner@example.com')!;
      expect(dinerCall.subject).toContain('La Bella');
    });
  });

  describe('sendReservationSeated', () => {
    it('sends exactly one email to the diner', async () => {
      await sendReservationSeated(BASE_EMAIL_DATA);

      const calls = emailCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.to).toBe('diner@example.com');
    });

    it('subject contains the restaurant name', async () => {
      await sendReservationSeated(BASE_EMAIL_DATA);

      expect(emailCalls()[0]!.subject).toContain('La Bella');
    });
  });

  describe('sendReservationCancelledByDiner', () => {
    it('sends two emails — receipt to diner, alert to owner', async () => {
      await sendReservationCancelledByDiner(BASE_EMAIL_DATA);

      const calls = emailCalls();
      expect(calls).toHaveLength(2);
    });

    it('diner subject signals cancellation', async () => {
      await sendReservationCancelledByDiner(BASE_EMAIL_DATA);

      const dinerCall = emailCalls().find((c) => c.to === 'diner@example.com')!;
      expect(dinerCall.subject.toLowerCase()).toContain('cancel');
    });
  });

  describe('sendReservationCancelledByOwner', () => {
    it('sends exactly one email to the diner', async () => {
      await sendReservationCancelledByOwner(BASE_EMAIL_DATA);

      expect(emailCalls()).toHaveLength(1);
      expect(emailCalls()[0]!.to).toBe('diner@example.com');
    });
  });
});

describe('processNotificationJob', () => {
  beforeEach(() => {
    mockEmailSend.mockClear();
    mockFindUniqueOrThrow.mockReset();
    mockFindUniqueOrThrow.mockResolvedValue(MOCK_DB_RESERVATION);
  });

  it('reservation.created → sends 2 emails', async () => {
    await processNotificationJob(
      makeJob({
        eventType: 'reservation.created',
        reservationId: MOCK_RESERVATION_ID,
      }),
    );

    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  it('reservation.seated → sends 1 email to diner', async () => {
    await processNotificationJob(
      makeJob({
        eventType: 'reservation.seated',
        reservationId: MOCK_RESERVATION_ID,
      }),
    );

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(emailCalls()[0]!.to).toBe('diner@example.com');
  });

  it('reservation.cancelled + cancelledBy=diner → 2 emails', async () => {
    await processNotificationJob(
      makeJob({
        eventType: 'reservation.cancelled',
        reservationId: MOCK_RESERVATION_ID,
        cancelledBy: 'diner',
      }),
    );

    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  it('reservation.cancelled + cancelledBy=owner → 1 email', async () => {
    await processNotificationJob(
      makeJob({
        eventType: 'reservation.cancelled',
        reservationId: MOCK_RESERVATION_ID,
        cancelledBy: 'owner',
      }),
    );

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });

  it('calls findUniqueOrThrow with the reservation id', async () => {
    await processNotificationJob(
      makeJob({
        eventType: 'reservation.created',
        reservationId: MOCK_RESERVATION_ID,
      }),
    );

    expect(mockFindUniqueOrThrow).toHaveBeenCalledOnce();
    const call = mockFindUniqueOrThrow.mock.calls[0]![0] as {
      where: { id: string };
    };
    expect(call.where.id).toBe(MOCK_RESERVATION_ID);
  });

  it('unknown event name → does NOT throw', async () => {
    const job = makeJob({
      eventType: 'reservation.unknown' as ReservationEventType,
      reservationId: MOCK_RESERVATION_ID,
    });

    await expect(processNotificationJob(job)).resolves.toBeUndefined();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('Resend failure → re-throws so BullMQ can retry', async () => {
    mockEmailSend.mockRejectedValueOnce(new Error('Resend 503'));

    await expect(
      processNotificationJob(
        makeJob({
          eventType: 'reservation.created',
          reservationId: MOCK_RESERVATION_ID,
        }),
      ),
    ).rejects.toThrow('Resend 503');
  });

  it('Prisma failure → re-throws so BullMQ can retry', async () => {
    mockFindUniqueOrThrow.mockRejectedValueOnce(new Error('DB timeout'));

    await expect(
      processNotificationJob(
        makeJob({
          eventType: 'reservation.created',
          reservationId: MOCK_RESERVATION_ID,
        }),
      ),
    ).rejects.toThrow('DB timeout');
  });
});

describe('startNotificationWorker', () => {
  beforeEach(() => {
    MockWorker.mockClear();
    mockWorkerOn.mockClear();
    mockWorkerClose.mockClear();
  });

  it('creates a Worker with the correct queue name from env', () => {
    startNotificationWorker();

    expect(MockWorker).toHaveBeenCalledOnce();
    const queueName = (MockWorker.mock.calls[0] as unknown[] | undefined)?.[0];
    expect(queueName).toBe(process.env.QUEUE_NAME ?? 'booking_events');
  });

  it('registers completed, failed, and error event listeners', () => {
    startNotificationWorker();

    const events = mockWorkerOn.mock.calls.map(([e]) => e as string);
    expect(events).toContain('completed');
    expect(events).toContain('failed');
    expect(events).toContain('error');
  });

  it('teardown function calls worker.close()', async () => {
    const stopWorker = startNotificationWorker();
    await stopWorker();

    expect(mockWorkerClose).toHaveBeenCalledOnce();
  });
});
