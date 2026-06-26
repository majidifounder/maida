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
    booking: { findUniqueOrThrow: mockFindUniqueOrThrow },
  },
}));

vi.mock('../lib/notify-once.js', () => ({
  notifyOnce: (_key: string, fn: () => Promise<void>) => fn(),
}));

import {
  sendBookingCreated,
  sendBookingConfirmed,
  sendBookingCancelledByDiner,
  sendBookingCancelledByOwner,
  type BookingEmailData,
} from '../services/email.service.js';
import {
  processNotificationJob,
  startNotificationWorker,
} from '../workers/notification.worker.js';
import type { BookingEventPayload, BookingEventType } from '../lib/queue.js';

const MOCK_BOOKING_ID = 'aaaabbbb-0000-0000-0000-000000000001';

const MOCK_DB_BOOKING = {
  id: MOCK_BOOKING_ID,
  partySize: 3,
  slot: { startsAt: new Date('2026-09-15T19:00:00.000Z') },
  diner: { email: 'diner@example.com' },
  restaurant: {
    name: 'La Bella',
    owner: { email: 'owner@labella.com' },
  },
};

const BASE_EMAIL_DATA: BookingEmailData = {
  bookingId: MOCK_BOOKING_ID,
  partySize: MOCK_DB_BOOKING.partySize,
  slotStartsAt: MOCK_DB_BOOKING.slot.startsAt.toISOString(),
  dinerEmail: MOCK_DB_BOOKING.diner.email,
  ownerEmail: MOCK_DB_BOOKING.restaurant.owner.email,
  restaurantName: MOCK_DB_BOOKING.restaurant.name,
};

function emailCalls(): Array<{ to: string; subject: string; html: string }> {
  return mockEmailSend.mock.calls.map(
    ([arg]) => arg as { to: string; subject: string; html: string },
  );
}

function makeJob(
  data: Partial<BookingEventPayload> &
    Pick<BookingEventPayload, 'eventType' | 'bookingId'>,
): Job<BookingEventPayload> {
  return {
    id: 'job-1',
    data: {
      publishedAt: new Date().toISOString(),
      ...data,
    },
  } as Job<BookingEventPayload>;
}

describe('email.service', () => {
  beforeEach(() => {
    mockEmailSend.mockClear();
  });

  describe('sendBookingCreated', () => {
    it('sends two emails — one to diner, one to owner', async () => {
      await sendBookingCreated(BASE_EMAIL_DATA);

      const calls = emailCalls();
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.to)).toEqual(
        expect.arrayContaining(['diner@example.com', 'owner@labella.com']),
      );
    });

    it('diner email subject contains the restaurant name', async () => {
      await sendBookingCreated(BASE_EMAIL_DATA);

      const dinerCall = emailCalls().find((c) => c.to === 'diner@example.com')!;
      expect(dinerCall.subject).toContain('La Bella');
    });

    it('owner email subject contains the restaurant name', async () => {
      await sendBookingCreated(BASE_EMAIL_DATA);

      const ownerCall = emailCalls().find((c) => c.to === 'owner@labella.com')!;
      expect(ownerCall.subject).toContain('La Bella');
    });

    it('both emails reference the correct party size', async () => {
      await sendBookingCreated(BASE_EMAIL_DATA);

      emailCalls().forEach((call) => {
        expect(call.html).toContain('3');
      });
    });
  });

  describe('sendBookingConfirmed', () => {
    it('sends exactly one email to the diner', async () => {
      await sendBookingConfirmed(BASE_EMAIL_DATA);

      const calls = emailCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.to).toBe('diner@example.com');
    });

    it('subject contains the restaurant name and a confirmation token', async () => {
      await sendBookingConfirmed(BASE_EMAIL_DATA);

      expect(emailCalls()[0]!.subject).toContain('La Bella');
      expect(emailCalls()[0]!.subject).toMatch(/confirmed|✓/i);
    });

    it('does NOT email the owner', async () => {
      await sendBookingConfirmed(BASE_EMAIL_DATA);

      expect(
        emailCalls().some((c) => c.to === 'owner@labella.com'),
      ).toBe(false);
    });
  });

  describe('sendBookingCancelledByDiner', () => {
    it('sends two emails — receipt to diner, alert to owner', async () => {
      await sendBookingCancelledByDiner(BASE_EMAIL_DATA);

      const calls = emailCalls();
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.to)).toEqual(
        expect.arrayContaining(['diner@example.com', 'owner@labella.com']),
      );
    });

    it('diner subject signals cancellation', async () => {
      await sendBookingCancelledByDiner(BASE_EMAIL_DATA);

      const dinerCall = emailCalls().find((c) => c.to === 'diner@example.com')!;
      expect(dinerCall.subject.toLowerCase()).toContain('cancel');
    });

    it('owner subject signals guest cancellation', async () => {
      await sendBookingCancelledByDiner(BASE_EMAIL_DATA);

      const ownerCall = emailCalls().find((c) => c.to === 'owner@labella.com')!;
      expect(ownerCall.subject.toLowerCase()).toContain('guest');
    });
  });

  describe('sendBookingCancelledByOwner', () => {
    it('sends exactly one email to the diner', async () => {
      await sendBookingCancelledByOwner(BASE_EMAIL_DATA);

      const calls = emailCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.to).toBe('diner@example.com');
    });

    it('subject signals cancellation by restaurant', async () => {
      await sendBookingCancelledByOwner(BASE_EMAIL_DATA);

      expect(emailCalls()[0]!.subject.toLowerCase()).toContain('cancel');
    });

    it('does NOT email the owner', async () => {
      await sendBookingCancelledByOwner(BASE_EMAIL_DATA);

      expect(
        emailCalls().some((c) => c.to === 'owner@labella.com'),
      ).toBe(false);
    });
  });
});

describe('processNotificationJob', () => {
  beforeEach(() => {
    mockEmailSend.mockClear();
    mockFindUniqueOrThrow.mockReset();
    mockFindUniqueOrThrow.mockResolvedValue(MOCK_DB_BOOKING);
  });

  it('booking.created → calls sendBookingCreated (2 emails)', async () => {
    await processNotificationJob(
      makeJob({ eventType: 'booking.created', bookingId: MOCK_BOOKING_ID }),
    );

    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  it('booking.confirmed → calls sendBookingConfirmed (1 email, diner only)', async () => {
    await processNotificationJob(
      makeJob({ eventType: 'booking.confirmed', bookingId: MOCK_BOOKING_ID }),
    );

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(emailCalls()[0]!.to).toBe('diner@example.com');
  });

  it('booking.cancelled + cancelledBy=diner → sendBookingCancelledByDiner (2 emails)', async () => {
    await processNotificationJob(
      makeJob({
        eventType: 'booking.cancelled',
        bookingId: MOCK_BOOKING_ID,
        cancelledBy: 'diner',
      }),
    );

    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  it('booking.cancelled + cancelledBy=owner → sendBookingCancelledByOwner (1 email)', async () => {
    await processNotificationJob(
      makeJob({
        eventType: 'booking.cancelled',
        bookingId: MOCK_BOOKING_ID,
        cancelledBy: 'owner',
      }),
    );

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(emailCalls()[0]!.to).toBe('diner@example.com');
  });

  it('calls findUniqueOrThrow with the booking id from the job payload', async () => {
    await processNotificationJob(
      makeJob({ eventType: 'booking.created', bookingId: MOCK_BOOKING_ID }),
    );

    expect(mockFindUniqueOrThrow).toHaveBeenCalledOnce();
    const call = mockFindUniqueOrThrow.mock.calls[0]![0] as {
      where: { id: string };
      select: unknown;
    };
    expect(call.where.id).toBe(MOCK_BOOKING_ID);
    expect(call.select).toMatchObject({
      diner: { select: { email: true } },
      restaurant: { select: { owner: { select: { email: true } } } },
      slot: { select: { startsAt: true } },
    });
  });

  it('unknown event name → does NOT throw (logs and skips)', async () => {
    const job = makeJob({
      eventType: 'booking.unknown_event' as BookingEventType,
      bookingId: MOCK_BOOKING_ID,
    });

    await expect(processNotificationJob(job)).resolves.toBeUndefined();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('Resend failure → re-throws so BullMQ can retry', async () => {
    mockEmailSend.mockRejectedValueOnce(new Error('Resend 503'));

    const job = makeJob({
      eventType: 'booking.created',
      bookingId: MOCK_BOOKING_ID,
    });

    await expect(processNotificationJob(job)).rejects.toThrow('Resend 503');
  });

  it('Prisma failure → re-throws so BullMQ can retry', async () => {
    mockFindUniqueOrThrow.mockRejectedValueOnce(new Error('DB timeout'));

    const job = makeJob({
      eventType: 'booking.created',
      bookingId: MOCK_BOOKING_ID,
    });

    await expect(processNotificationJob(job)).rejects.toThrow('DB timeout');
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
