import { prisma } from '@restaurant/db';
import { getRedisClient } from '../../lib/redis.js';
import { publishBookingEvent } from '../../lib/queue.js';
import { publishToRestaurantChannel } from '../../lib/pubsub.js';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../errors/index.js';
import type {
  CreateBookingInput,
  ListBookingsQuery,
  ListRestaurantBookingsQuery,
} from './booking.schema.js';

async function invalidateSlotCache(
  restaurantId: string,
  slotStartsAt: Date,
): Promise<void> {
  try {
    const date = slotStartsAt.toISOString().slice(0, 10);
    const redis = getRedisClient();
    await redis.del(`restaurant:${restaurantId}:slots:${date}`);
  } catch (err) {
    console.warn(
      '[Redis] slot cache invalidation failed (non-fatal):',
      (err as Error).message,
    );
  }
}

const BOOKING_SELECT = {
  id: true,
  restaurantId: true,
  slotId: true,
  partySize: true,
  status: true,
  createdAt: true,
  cancelledAt: true,
  slot: {
    select: { startsAt: true, capacity: true },
  },
  restaurant: {
    select: { name: true, city: true, cuisine: true },
  },
} as const;

const BOOKING_SELECT_OWNER = {
  ...BOOKING_SELECT,
  dinerId: true,
  diner: {
    select: { email: true },
  },
} as const;

const BOOKING_TX_OPTIONS = {
  maxWait: 15_000,
  timeout: 20_000,
} as const;

const BOOKING_TX_MAX_ATTEMPTS = 4;

function isPrismaTransactionTimeout(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2028'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createBooking(dinerId: string, input: CreateBookingInput) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: input.restaurantId, isActive: true, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!restaurant) throw new NotFoundError('Restaurant not found');

  let booking;

  for (let attempt = 0; attempt < BOOKING_TX_MAX_ATTEMPTS; attempt++) {
    try {
      booking = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            capacity: number;
            booked: number;
            restaurantId: string;
            isActive: boolean;
            startsAt: Date;
          }>
        >`
          SELECT id, capacity, booked, "restaurantId", "isActive", "startsAt"
          FROM "time_slots"
          WHERE id = CAST(${input.slotId} AS uuid)
          FOR UPDATE
        `;

        if (rows.length === 0) {
          throw new NotFoundError('Time slot not found');
        }

        const slot = rows[0]!;

        if (!slot.isActive) {
          throw new NotFoundError('Time slot is no longer available');
        }

        if (slot.restaurantId !== input.restaurantId) {
          throw new NotFoundError('Time slot does not belong to this restaurant');
        }

        if (slot.startsAt <= new Date()) {
          throw new ConflictError('Cannot book a slot in the past');
        }

        const available = slot.capacity - slot.booked;
        if (available < input.partySize) {
          throw new ConflictError(
            available === 0
              ? 'This time slot is fully booked'
              : 'Not enough availability for your party size',
          );
        }

        const newBooking = await tx.booking.create({
          data: {
            dinerId,
            restaurantId: input.restaurantId,
            slotId: input.slotId,
            partySize: input.partySize,
            status: 'PENDING',
          },
          select: BOOKING_SELECT,
        });

        await tx.timeSlot.update({
          where: { id: input.slotId },
          data: { booked: { increment: input.partySize } },
        });

        await tx.auditLog.create({
          data: {
            actorId: dinerId,
            action: 'BOOKING_CREATED',
            entityType: 'Booking',
            entityId: newBooking.id,
            metadata: { partySize: input.partySize, slotId: input.slotId },
          },
        });

        return { booking: newBooking, slotStartsAt: slot.startsAt };
      }, BOOKING_TX_OPTIONS);
      break;
    } catch (err) {
      if (err instanceof ConflictError || err instanceof NotFoundError) {
        throw err;
      }
      if (isPrismaTransactionTimeout(err) && attempt < BOOKING_TX_MAX_ATTEMPTS - 1) {
        await sleep(50 * (attempt + 1));
        continue;
      }
      if (isPrismaTransactionTimeout(err)) {
        throw new ConflictError('This time slot is fully booked');
      }
      throw err;
    }
  }

  if (!booking) {
    throw new ConflictError('This time slot is fully booked');
  }

  await invalidateSlotCache(input.restaurantId, booking.slotStartsAt);

  await publishBookingEvent('booking.created', {
    bookingId: booking.booking.id,
    dinerId,
    restaurantId: input.restaurantId,
    slotId: input.slotId,
    partySize: input.partySize,
  });

  await publishToRestaurantChannel(input.restaurantId, {
    eventType: 'booking.created',
    bookingId: booking.booking.id,
    restaurantId: input.restaurantId,
    partySize: input.partySize,
    slotStartsAt: booking.slotStartsAt.toISOString(),
  });

  return booking.booking;
}

export async function listMyBookings(
  dinerId: string,
  query: ListBookingsQuery,
) {
  const { status, page, limit } = query;
  const offset = (page - 1) * limit;

  const where = {
    dinerId,
    ...(status && { status }),
  };

  const [bookings, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      select: BOOKING_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.booking.count({ where }),
  ]);

  return { bookings, total, page, limit };
}

export async function getMyBooking(bookingId: string, dinerId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, dinerId },
    select: BOOKING_SELECT,
  });
  if (!booking) throw new NotFoundError('Booking not found');
  return booking;
}

export async function cancelMyBooking(bookingId: string, dinerId: string) {
  const existing = await prisma.booking.findFirst({
    where: { id: bookingId, dinerId },
    select: {
      id: true,
      status: true,
      partySize: true,
      slotId: true,
      restaurantId: true,
    },
  });

  if (!existing) throw new NotFoundError('Booking not found');

  if (existing.status === 'CANCELLED') {
    throw new ConflictError('Booking is already cancelled');
  }

  if (existing.status === 'NO_SHOW') {
    throw new ConflictError('No-show bookings cannot be cancelled');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      select: BOOKING_SELECT,
    });

    await tx.timeSlot.update({
      where: { id: existing.slotId },
      data: { booked: { decrement: existing.partySize } },
    });

    await tx.auditLog.create({
      data: {
        actorId: dinerId,
        action: 'BOOKING_CANCELLED',
        entityType: 'Booking',
        entityId: bookingId,
        metadata: { cancelledBy: 'diner' },
      },
    });

    return cancelled;
  });

  const slot = await prisma.timeSlot.findUnique({
    where: { id: existing.slotId },
    select: { startsAt: true },
  });
  if (slot) await invalidateSlotCache(existing.restaurantId, slot.startsAt);

  await publishBookingEvent('booking.cancelled', {
    bookingId,
    dinerId,
    cancelledBy: 'diner',
  });

  await publishToRestaurantChannel(existing.restaurantId, {
    eventType: 'booking.cancelled',
    bookingId,
    cancelledBy: 'diner',
  });

  return updated;
}

export async function listRestaurantBookings(
  restaurantId: string,
  ownerId: string,
  query: ListRestaurantBookingsQuery,
) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!restaurant) {
    throw new ForbiddenError('Restaurant not found or access denied');
  }

  const { status, date, page, limit } = query;
  const offset = (page - 1) * limit;

  const slotWhere = date
    ? {
        startsAt: {
          gte: new Date(`${date}T00:00:00.000Z`),
          lte: new Date(`${date}T23:59:59.999Z`),
        },
      }
    : undefined;

  const where = {
    restaurantId,
    ...(status && { status }),
    ...(slotWhere && { slot: slotWhere }),
  };

  const [bookings, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      select: BOOKING_SELECT_OWNER,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.booking.count({ where }),
  ]);

  return { bookings, total, page, limit };
}

export async function confirmBooking(
  restaurantId: string,
  bookingId: string,
  ownerId: string,
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, restaurantId },
    select: { id: true, status: true, dinerId: true },
  });

  if (!booking) throw new NotFoundError('Booking not found');

  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!restaurant) throw new ForbiddenError('Access denied');

  if (booking.status !== 'PENDING') {
    throw new ConflictError(
      `Cannot confirm a booking with status ${booking.status}`,
    );
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CONFIRMED' },
    select: BOOKING_SELECT_OWNER,
  });

  await prisma.auditLog
    .create({
      data: {
        actorId: ownerId,
        action: 'BOOKING_CONFIRMED',
        entityType: 'Booking',
        entityId: bookingId,
      },
    })
    .catch(() => {});

  await publishBookingEvent('booking.confirmed', {
    bookingId,
    restaurantId,
    dinerId: booking.dinerId,
  });

  await publishToRestaurantChannel(restaurantId, {
    eventType: 'booking.confirmed',
    bookingId,
  });

  return updated;
}

export async function cancelBookingByOwner(
  restaurantId: string,
  bookingId: string,
  ownerId: string,
) {
  const existing = await prisma.booking.findFirst({
    where: { id: bookingId, restaurantId },
    select: {
      id: true,
      status: true,
      partySize: true,
      slotId: true,
      dinerId: true,
      slot: { select: { startsAt: true } },
    },
  });

  if (!existing) throw new NotFoundError('Booking not found');

  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!restaurant) throw new ForbiddenError('Access denied');

  if (existing.status === 'CANCELLED') {
    throw new ConflictError('Booking is already cancelled');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      select: BOOKING_SELECT_OWNER,
    });

    await tx.timeSlot.update({
      where: { id: existing.slotId },
      data: { booked: { decrement: existing.partySize } },
    });

    await tx.auditLog.create({
      data: {
        actorId: ownerId,
        action: 'BOOKING_CANCELLED',
        entityType: 'Booking',
        entityId: bookingId,
        metadata: { cancelledBy: 'owner' },
      },
    });

    return cancelled;
  });

  if (existing.slot?.startsAt) {
    await invalidateSlotCache(restaurantId, existing.slot.startsAt);
  }

  await publishBookingEvent('booking.cancelled', {
    bookingId,
    restaurantId,
    dinerId: existing.dinerId,
    cancelledBy: 'owner',
  });

  await publishToRestaurantChannel(restaurantId, {
    eventType: 'booking.cancelled',
    bookingId,
    cancelledBy: 'owner',
  });

  return updated;
}
