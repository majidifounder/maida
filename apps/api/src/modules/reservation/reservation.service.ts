import { prisma, Prisma } from '@restaurant/db';
import { getRedisClient } from '../../lib/redis.js';
import { publishReservationEvent } from '../../lib/queue.js';
import { publishToRestaurantChannel } from '../../lib/pubsub.js';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  UnprocessableError,
} from '../../errors/index.js';
import { getPlanLimits, startOfCurrentMonth } from '../../lib/plan.js';
import { getCurrentPlan } from '../subscription/subscription.service.js';
import {
  addMinutes,
  deriveDisplayStatus,
  findBestFitUnit,
  findNextAvailableStart,
  isExclusionViolation,
  loadBookableUnits,
  resolveDurationMins,
} from '../../lib/reservation-engine.js';
import { localDayBoundsUtc, formatLocalDate } from '../../lib/timezone.js';
import type {
  CancelReservationSchema,
  CreateReservationInput,
  ExtendReservationInput,
  ListReservationsQuery,
  ListRestaurantReservationsQuery,
  OverrideReservationInput,
  StaffCreateReservationInput,
  WalkInInput,
} from './reservation.schema.js';
import type { z } from 'zod';

const RESERVATION_SELECT = {
  id: true,
  restaurantId: true,
  partySize: true,
  startsAt: true,
  endsAt: true,
  status: true,
  reservationType: true,
  source: true,
  customFeeSnapshot: true,
  extraHourFeeSnapshot: true,
  feeCurrency: true,
  createdAt: true,
  cancelledAt: true,
  seatedAt: true,
  guestName: true,
  notes: true,
  restaurant: {
    select: { name: true, city: true, cuisine: true },
  },
  tables: {
    select: {
      tableId: true,
      table: { select: { name: true, maxPartySize: true } },
    },
  },
} as const;

const RESERVATION_SELECT_OWNER = {
  ...RESERVATION_SELECT,
  dinerId: true,
  isOverride: true,
  diner: { select: { email: true } },
} as const;

const TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 } as const;

function availabilityCacheKey(restaurantId: string, date: string): string {
  return `restaurant:${restaurantId}:availability:${date}`;
}

async function invalidateAvailabilityCache(
  restaurantId: string,
  startsAt: Date,
): Promise<void> {
  try {
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: restaurantId },
      select: { timezone: true },
    });
    const date = formatLocalDate(startsAt, restaurant?.timezone ?? 'UTC');
    const redis = getRedisClient();
    await redis.del(availabilityCacheKey(restaurantId, date));
  } catch (err) {
    console.warn(
      '[Redis] availability cache invalidation failed (non-fatal):',
      (err as Error).message,
    );
  }
}

function formatReservation<T extends { status: string; endsAt: Date }>(
  row: T,
): T & { status: string } {
  return {
    ...row,
    status: deriveDisplayStatus(row.status, row.endsAt),
  };
}

function serializeReservation<T extends Record<string, unknown>>(row: T) {
  const formatted = formatReservation(
    row as T & { status: string; endsAt: Date },
  );
  return {
    ...formatted,
    startsAt:
      formatted.startsAt instanceof Date
        ? formatted.startsAt.toISOString()
        : formatted.startsAt,
    endsAt:
      formatted.endsAt instanceof Date
        ? formatted.endsAt.toISOString()
        : formatted.endsAt,
    customFeeSnapshot:
      formatted.customFeeSnapshot != null
        ? String(formatted.customFeeSnapshot)
        : null,
    extraHourFeeSnapshot:
      formatted.extraHourFeeSnapshot != null
        ? String(formatted.extraHourFeeSnapshot)
        : null,
    createdAt:
      formatted.createdAt instanceof Date
        ? formatted.createdAt.toISOString()
        : formatted.createdAt,
    cancelledAt:
      formatted.cancelledAt instanceof Date
        ? formatted.cancelledAt.toISOString()
        : formatted.cancelledAt ?? null,
    seatedAt:
      formatted.seatedAt instanceof Date
        ? formatted.seatedAt.toISOString()
        : formatted.seatedAt ?? null,
  };
}

async function assertReservationPlanLimit(restaurantId: string): Promise<void> {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId },
    select: { ownerId: true },
  });
  if (!restaurant) return;

  const plan = await getCurrentPlan(restaurant.ownerId);
  const limits = getPlanLimits(plan as import('@restaurant/types').Plan);
  if (limits.reservationsPerMonth === Infinity) return;

  const monthStart = startOfCurrentMonth();
  const count = await prisma.reservation.count({
    where: {
      restaurant: { ownerId: restaurant.ownerId },
      status: { notIn: ['CANCELLED'] },
      createdAt: { gte: monthStart },
    },
  });

  if (count >= limits.reservationsPerMonth) {
    throw new UnprocessableError(
      `This restaurant has reached its monthly reservation limit (${limits.reservationsPerMonth}). ` +
        `The owner must upgrade their plan.`,
    );
  }
}

async function assertCustomReservationAllowed(
  ownerId: string,
): Promise<void> {
  const plan = await getCurrentPlan(ownerId);
  const limits = getPlanLimits(plan as import('@restaurant/types').Plan);
  if (!limits.customReservations) {
    throw new UnprocessableError(
      `Custom-duration reservations require a Pro or Premium plan.`,
    );
  }
}

async function loadRestaurantForBooking(restaurantId: string) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, isActive: true, deletedAt: null },
    select: {
      id: true,
      ownerId: true,
      seatingMode: true,
      defaultDurationMins: true,
      openMinutes: true,
      closeMinutes: true,
      timezone: true,
      customFee: true,
      extraHourFee: true,
      feeCurrency: true,
    },
  });
  if (!restaurant) throw new NotFoundError('Restaurant not found');
  return restaurant;
}

async function assertOwnerAccess(restaurantId: string, ownerId: string) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!restaurant) throw new ForbiddenError('Restaurant not found or access denied');
}

type CreateHoldParams = {
  restaurantId: string;
  dinerId?: string | undefined;
  partySize: number;
  startsAt: Date;
  endsAt: Date;
  reservationType: 'STANDARD' | 'CUSTOM';
  source: 'ONLINE' | 'WALK_IN' | 'STAFF';
  tableIds: string[];
  guestName?: string | undefined;
  notes?: string | undefined;
  isOverride?: boolean;
  feeSnapshots?: {
    customFeeSnapshot: Prisma.Decimal | null;
    extraHourFeeSnapshot: Prisma.Decimal | null;
    feeCurrency: string | null;
  };
  status?: 'SCHEDULED' | 'SEATED';
  seatedAt?: Date;
};

async function createReservationWithHolds(
  params: CreateHoldParams,
  actorId?: string,
  auditAction = 'reservation.created',
) {
  const reservation = await prisma.$transaction(async (tx) => {
    const created = await tx.reservation.create({
      data: {
        restaurantId: params.restaurantId,
        dinerId: params.dinerId ?? null,
        partySize: params.partySize,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        status: params.status ?? 'SCHEDULED',
        reservationType: params.reservationType,
        source: params.source,
        guestName: params.guestName ?? null,
        notes: params.notes ?? null,
        isOverride: params.isOverride ?? false,
        seatedAt: params.seatedAt ?? null,
        customFeeSnapshot: params.feeSnapshots?.customFeeSnapshot ?? null,
        extraHourFeeSnapshot: params.feeSnapshots?.extraHourFeeSnapshot ?? null,
        feeCurrency: params.feeSnapshots?.feeCurrency ?? null,
        tables: {
          create: params.tableIds.map((tableId) => ({
            tableId,
            startsAt: params.startsAt,
            endsAt: params.endsAt,
          })),
        },
      },
      select: RESERVATION_SELECT,
    });

    if (actorId) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: auditAction,
          entityType: 'reservation',
          entityId: created.id,
          metadata: {
            partySize: params.partySize,
            tableIds: params.tableIds,
            isOverride: params.isOverride ?? false,
          },
        },
      });
    }

    return created;
  }, TX_OPTIONS);

  return reservation;
}

async function createWithAllocation(
  restaurant: Awaited<ReturnType<typeof loadRestaurantForBooking>>,
  params: {
    dinerId?: string;
    partySize: number;
    startsAt: Date;
    reservationType: 'STANDARD' | 'CUSTOM';
    source: 'ONLINE' | 'WALK_IN' | 'STAFF';
    durationMins?: number;
    guestName?: string;
    notes?: string;
    tableIds?: string[];
    isOverride?: boolean;
    status?: 'SCHEDULED' | 'SEATED';
  },
  actorId?: string,
) {
  if (params.reservationType === 'CUSTOM') {
    await assertCustomReservationAllowed(restaurant.ownerId);
  }

  const durationMins =
    params.durationMins ??
    (params.reservationType === 'CUSTOM' && params.durationMins
      ? params.durationMins
      : await resolveDurationMins(
          restaurant.id,
          params.partySize,
          restaurant.defaultDurationMins,
        ));

  const endsAt = addMinutes(params.startsAt, durationMins);

  if (params.startsAt <= new Date() && params.source === 'ONLINE') {
    throw new ConflictError('Cannot book a time in the past');
  }

  let tableIds: string[];

  if (params.tableIds?.length) {
    tableIds = params.tableIds;
  } else {
    const units = await loadBookableUnits(
      restaurant.id,
      restaurant.seatingMode,
    );
    if (units.length === 0) {
      throw new ConflictError(
        'No tables configured for this restaurant',
      );
    }

    const unit = await findBestFitUnit(
      units,
      params.partySize,
      params.startsAt,
      endsAt,
    );

    if (!unit) {
      const nextAvailable = await findNextAvailableStart(
        restaurant,
        params.partySize,
        params.startsAt,
        params.reservationType === 'CUSTOM' ? durationMins : undefined,
      );
      throw new ConflictError(
        'No table available for the requested time',
        nextAvailable
          ? { suggestedNextAvailableAt: nextAvailable.toISOString() }
          : undefined,
      );
    }

    tableIds = unit.tableIds;
  }

  const feeSnapshots =
    params.reservationType === 'CUSTOM'
      ? {
          customFeeSnapshot: restaurant.customFee,
          extraHourFeeSnapshot: restaurant.extraHourFee,
          feeCurrency: restaurant.feeCurrency,
        }
      : undefined;

  try {
    return await createReservationWithHolds(
      {
        restaurantId: restaurant.id,
        partySize: params.partySize,
        startsAt: params.startsAt,
        endsAt,
        reservationType: params.reservationType,
        source: params.source,
        tableIds,
        ...(params.dinerId !== undefined && { dinerId: params.dinerId }),
        ...(params.guestName !== undefined && { guestName: params.guestName }),
        ...(params.notes !== undefined && { notes: params.notes }),
        ...(params.isOverride !== undefined && { isOverride: params.isOverride }),
        ...(feeSnapshots !== undefined && { feeSnapshots }),
        ...(params.status !== undefined && { status: params.status }),
        ...(params.status === 'SEATED' && { seatedAt: new Date() }),
      },
      actorId,
    );
  } catch (err) {
    if (isExclusionViolation(err)) {
      const nextAvailable = await findNextAvailableStart(
        restaurant,
        params.partySize,
        params.startsAt,
      );
      throw new ConflictError(
        'The requested time is no longer available',
        nextAvailable
          ? { suggestedNextAvailableAt: nextAvailable.toISOString() }
          : undefined,
      );
    }
    throw err;
  }
}

export async function createReservation(
  dinerId: string,
  input: CreateReservationInput,
) {
  const restaurant = await loadRestaurantForBooking(input.restaurantId);
  await assertReservationPlanLimit(input.restaurantId);

  const startsAt = new Date(input.startsAt);
  const reservation = await createWithAllocation(
    restaurant,
    {
      dinerId,
      partySize: input.partySize,
      startsAt,
      reservationType: input.reservationType,
      source: 'ONLINE',
      ...(input.durationMins !== undefined && { durationMins: input.durationMins }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    dinerId,
  );

  await invalidateAvailabilityCache(input.restaurantId, startsAt);

  await publishReservationEvent('reservation.created', {
    reservationId: reservation.id,
    dinerId,
    restaurantId: input.restaurantId,
    partySize: input.partySize,
    startsAt: startsAt.toISOString(),
  });

  await publishToRestaurantChannel(input.restaurantId, {
    eventType: 'reservation.created',
    reservationId: reservation.id,
    restaurantId: input.restaurantId,
    partySize: input.partySize,
    startsAt: startsAt.toISOString(),
  });

  return serializeReservation(reservation);
}

export async function listMyReservations(
  dinerId: string,
  query: ListReservationsQuery,
) {
  const { status, page, limit } = query;
  const offset = (page - 1) * limit;

  const where = {
    dinerId,
    ...(status && { status }),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.reservation.findMany({
      where,
      select: RESERVATION_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    reservations: rows.map(serializeReservation),
    total,
    page,
    limit,
  };
}

export async function getMyReservation(reservationId: string, dinerId: string) {
  const row = await prisma.reservation.findFirst({
    where: { id: reservationId, dinerId },
    select: RESERVATION_SELECT,
  });
  if (!row) throw new NotFoundError('Reservation not found');
  return serializeReservation(row);
}

async function releaseHolds(
  tx: Prisma.TransactionClient,
  reservationId: string,
  releaseTime: Date,
) {
  await tx.reservationTable.updateMany({
    where: { reservationId, releasedAt: null },
    data: { releasedAt: releaseTime },
  });
}

export async function cancelMyReservation(
  reservationId: string,
  dinerId: string,
  reason?: string,
) {
  const existing = await prisma.reservation.findFirst({
    where: { id: reservationId, dinerId },
    select: {
      id: true,
      status: true,
      restaurantId: true,
      startsAt: true,
    },
  });

  if (!existing) throw new NotFoundError('Reservation not found');
  if (existing.status === 'CANCELLED') {
    throw new ConflictError('Reservation is already cancelled');
  }
  if (existing.status === 'NO_SHOW') {
    throw new ConflictError('No-show reservations cannot be cancelled');
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelReason: reason ?? null,
      },
      select: RESERVATION_SELECT,
    });

    await releaseHolds(tx, reservationId, now);

    await tx.auditLog.create({
      data: {
        actorId: dinerId,
        action: 'reservation.cancelled',
        entityType: 'reservation',
        entityId: reservationId,
        metadata: { cancelledBy: 'diner' },
      },
    });

    return cancelled;
  }, TX_OPTIONS);

  await invalidateAvailabilityCache(existing.restaurantId, existing.startsAt);

  await publishReservationEvent('reservation.cancelled', {
    reservationId,
    dinerId,
    cancelledBy: 'diner',
  });

  await publishToRestaurantChannel(existing.restaurantId, {
    eventType: 'reservation.cancelled',
    reservationId,
    cancelledBy: 'diner',
  });

  return serializeReservation(updated);
}

export async function listRestaurantReservations(
  restaurantId: string,
  ownerId: string,
  query: ListRestaurantReservationsQuery,
) {
  await assertOwnerAccess(restaurantId, ownerId);

  const { status, date, page, limit } = query;
  const offset = (page - 1) * limit;

  let dateFilter: { gte: Date; lt: Date } | undefined;
  if (date) {
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: restaurantId },
      select: { timezone: true },
    });
    if (!restaurant) throw new NotFoundError('Restaurant not found');
    const bounds = localDayBoundsUtc(date, restaurant.timezone);
    dateFilter = { gte: bounds.start, lt: bounds.end };
  }

  const where = {
    restaurantId,
    ...(status && { status }),
    ...(dateFilter && { startsAt: dateFilter }),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.reservation.findMany({
      where,
      select: RESERVATION_SELECT_OWNER,
      orderBy: { startsAt: 'asc' },
      skip: offset,
      take: limit,
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    reservations: rows.map(serializeReservation),
    total,
    page,
    limit,
  };
}

export async function seatReservation(
  restaurantId: string,
  reservationId: string,
  ownerId: string,
) {
  await assertOwnerAccess(restaurantId, ownerId);

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, restaurantId },
    select: { id: true, status: true, startsAt: true },
  });
  if (!reservation) throw new NotFoundError('Reservation not found');
  if (reservation.status !== 'SCHEDULED') {
    throw new ConflictError(
      `Cannot seat a reservation with status ${reservation.status}`,
    );
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: 'SEATED', seatedAt: now },
      select: RESERVATION_SELECT_OWNER,
    });

    await tx.auditLog.create({
      data: {
        actorId: ownerId,
        action: 'reservation.seated',
        entityType: 'reservation',
        entityId: reservationId,
      },
    });

    return row;
  }, TX_OPTIONS);

  await publishReservationEvent('reservation.seated', {
    reservationId,
    restaurantId,
  });

  await publishToRestaurantChannel(restaurantId, {
    eventType: 'reservation.seated',
    reservationId,
  });

  return serializeReservation(updated);
}

export async function cancelReservationByOwner(
  restaurantId: string,
  reservationId: string,
  ownerId: string,
  reason?: string,
) {
  await assertOwnerAccess(restaurantId, ownerId);

  const existing = await prisma.reservation.findFirst({
    where: { id: reservationId, restaurantId },
    select: {
      id: true,
      status: true,
      dinerId: true,
      startsAt: true,
    },
  });
  if (!existing) throw new NotFoundError('Reservation not found');
  if (existing.status === 'CANCELLED') {
    throw new ConflictError('Reservation is already cancelled');
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelReason: reason ?? null,
      },
      select: RESERVATION_SELECT_OWNER,
    });

    await releaseHolds(tx, reservationId, now);

    await tx.auditLog.create({
      data: {
        actorId: ownerId,
        action: 'reservation.cancelled',
        entityType: 'reservation',
        entityId: reservationId,
        metadata: { cancelledBy: 'owner' },
      },
    });

    return cancelled;
  }, TX_OPTIONS);

  await invalidateAvailabilityCache(restaurantId, existing.startsAt);

  await publishReservationEvent('reservation.cancelled', {
    reservationId,
    restaurantId,
    dinerId: existing.dinerId ?? undefined,
    cancelledBy: 'owner',
  });

  await publishToRestaurantChannel(restaurantId, {
    eventType: 'reservation.cancelled',
    reservationId,
    cancelledBy: 'owner',
  });

  return serializeReservation(updated);
}

export async function markNoShow(
  restaurantId: string,
  reservationId: string,
  ownerId: string,
) {
  await assertOwnerAccess(restaurantId, ownerId);

  const existing = await prisma.reservation.findFirst({
    where: { id: reservationId, restaurantId },
    select: { id: true, status: true, startsAt: true },
  });
  if (!existing) throw new NotFoundError('Reservation not found');
  if (existing.status !== 'SCHEDULED') {
    throw new ConflictError(
      `Cannot mark no-show for status ${existing.status}`,
    );
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: 'NO_SHOW', noShowAt: now },
      select: RESERVATION_SELECT_OWNER,
    });

    await releaseHolds(tx, reservationId, now);

    await tx.auditLog.create({
      data: {
        actorId: ownerId,
        action: 'reservation.no_show',
        entityType: 'reservation',
        entityId: reservationId,
      },
    });

    return row;
  }, TX_OPTIONS);

  await invalidateAvailabilityCache(restaurantId, existing.startsAt);

  await publishReservationEvent('reservation.no_show', {
    reservationId,
    restaurantId,
  });

  await publishToRestaurantChannel(restaurantId, {
    eventType: 'reservation.no_show',
    reservationId,
  });

  return serializeReservation(updated);
}

export async function extendReservation(
  restaurantId: string,
  reservationId: string,
  ownerId: string,
  input: ExtendReservationInput,
) {
  await assertOwnerAccess(restaurantId, ownerId);

  const existing = await prisma.reservation.findFirst({
    where: { id: reservationId, restaurantId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      tables: { select: { id: true, tableId: true } },
    },
  });
  if (!existing) throw new NotFoundError('Reservation not found');
  if (existing.status !== 'SEATED' && existing.status !== 'SCHEDULED') {
    throw new ConflictError(
      `Cannot extend a reservation with status ${existing.status}`,
    );
  }

  const newEndsAt = addMinutes(existing.endsAt, input.additionalMins);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.reservation.update({
        where: { id: reservationId },
        data: { endsAt: newEndsAt },
        select: RESERVATION_SELECT_OWNER,
      });

      for (const hold of existing.tables) {
        await tx.reservationTable.update({
          where: { id: hold.id },
          data: { endsAt: newEndsAt },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: ownerId,
          action: 'reservation.extended',
          entityType: 'reservation',
          entityId: reservationId,
          metadata: { additionalMins: input.additionalMins },
        },
      });

      return row;
    }, TX_OPTIONS);

    await invalidateAvailabilityCache(restaurantId, existing.startsAt);

    await publishReservationEvent('reservation.extended', {
      reservationId,
      restaurantId,
    });

    await publishToRestaurantChannel(restaurantId, {
      eventType: 'reservation.extended',
      reservationId,
    });

    return serializeReservation(updated);
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw new ConflictError(
        'Cannot extend — another reservation conflicts with the extended time',
      );
    }
    throw err;
  }
}

export async function freeTableEarly(
  restaurantId: string,
  reservationId: string,
  ownerId: string,
) {
  await assertOwnerAccess(restaurantId, ownerId);

  const existing = await prisma.reservation.findFirst({
    where: { id: reservationId, restaurantId },
    select: { id: true, status: true, startsAt: true, endsAt: true },
  });
  if (!existing) throw new NotFoundError('Reservation not found');
  if (existing.status !== 'SEATED' && existing.status !== 'SCHEDULED') {
    throw new ConflictError(
      `Cannot free table for status ${existing.status}`,
    );
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        endsAt: now,
      },
      select: RESERVATION_SELECT_OWNER,
    });

    await tx.reservationTable.updateMany({
      where: { reservationId, releasedAt: null },
      data: { endsAt: now, releasedAt: now },
    });

    await tx.auditLog.create({
      data: {
        actorId: ownerId,
        action: 'reservation.freed_early',
        entityType: 'reservation',
        entityId: reservationId,
      },
    });

    return row;
  }, TX_OPTIONS);

  await invalidateAvailabilityCache(restaurantId, existing.startsAt);

  await publishReservationEvent('reservation.freed_early', {
    reservationId,
    restaurantId,
  });

  await publishToRestaurantChannel(restaurantId, {
    eventType: 'reservation.freed_early',
    reservationId,
  });

  return serializeReservation(updated);
}

export async function createWalkIn(
  restaurantId: string,
  ownerId: string,
  input: WalkInInput,
) {
  await assertOwnerAccess(restaurantId, ownerId);
  await assertReservationPlanLimit(restaurantId);

  const restaurant = await loadRestaurantForBooking(restaurantId);
  const now = new Date();
  const durationMins =
    input.durationMins ??
    (await resolveDurationMins(
      restaurant.id,
      input.partySize,
      restaurant.defaultDurationMins,
    ));

  const reservation = await createWithAllocation(
    restaurant,
    {
      partySize: input.partySize,
      startsAt: now,
      reservationType: 'STANDARD',
      source: 'WALK_IN',
      durationMins,
      guestName: input.guestName,
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.tableIds !== undefined && { tableIds: input.tableIds }),
      status: 'SEATED',
    },
    ownerId,
  );

  await invalidateAvailabilityCache(restaurantId, now);

  await publishReservationEvent('reservation.created', {
    reservationId: reservation.id,
    restaurantId,
    partySize: input.partySize,
    startsAt: now.toISOString(),
  });

  await publishToRestaurantChannel(restaurantId, {
    eventType: 'reservation.created',
    reservationId: reservation.id,
    partySize: input.partySize,
    startsAt: now.toISOString(),
  });

  return serializeReservation(reservation);
}

export async function createStaffReservation(
  restaurantId: string,
  ownerId: string,
  input: StaffCreateReservationInput,
) {
  await assertOwnerAccess(restaurantId, ownerId);
  await assertReservationPlanLimit(restaurantId);

  const restaurant = await loadRestaurantForBooking(restaurantId);
  const startsAt = new Date(input.startsAt);

  const reservation = await createWithAllocation(
    restaurant,
    {
      ...(input.dinerId !== undefined && { dinerId: input.dinerId }),
      partySize: input.partySize,
      startsAt,
      reservationType: input.reservationType,
      source: 'STAFF',
      ...(input.durationMins !== undefined && { durationMins: input.durationMins }),
      guestName: input.guestName,
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    ownerId,
  );

  await invalidateAvailabilityCache(restaurantId, startsAt);

  await publishReservationEvent('reservation.created', {
    reservationId: reservation.id,
    restaurantId,
    partySize: input.partySize,
    startsAt: startsAt.toISOString(),
  });

  await publishToRestaurantChannel(restaurantId, {
    eventType: 'reservation.created',
    reservationId: reservation.id,
    partySize: input.partySize,
    startsAt: startsAt.toISOString(),
  });

  return serializeReservation(reservation);
}

export async function createOverrideReservation(
  restaurantId: string,
  ownerId: string,
  input: OverrideReservationInput,
) {
  await assertOwnerAccess(restaurantId, ownerId);
  await assertReservationPlanLimit(restaurantId);

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  if (endsAt <= startsAt) {
    throw new UnprocessableError('endsAt must be after startsAt');
  }

  const tables = await prisma.diningTable.findMany({
    where: {
      id: { in: input.tableIds },
      restaurantId,
      isActive: true,
    },
    select: { id: true },
  });
  if (tables.length !== input.tableIds.length) {
    throw new NotFoundError('One or more tables not found');
  }

  try {
    const reservation = await createReservationWithHolds(
      {
        restaurantId,
        partySize: input.partySize,
        startsAt,
        endsAt,
        reservationType: 'STANDARD',
        source: 'STAFF',
        tableIds: input.tableIds,
        ...(input.guestName !== undefined && { guestName: input.guestName }),
        ...(input.notes !== undefined && { notes: input.notes }),
        isOverride: true,
        status: 'SCHEDULED',
      },
      ownerId,
      'reservation.override_created',
    );

    await invalidateAvailabilityCache(restaurantId, startsAt);

    await publishReservationEvent('reservation.created', {
      reservationId: reservation.id,
      restaurantId,
      partySize: input.partySize,
      startsAt: startsAt.toISOString(),
    });

    await publishToRestaurantChannel(restaurantId, {
      eventType: 'reservation.created',
      reservationId: reservation.id,
      partySize: input.partySize,
      startsAt: startsAt.toISOString(),
    });

    return serializeReservation(reservation);
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw new ConflictError(
        'Override failed — tables conflict with an existing reservation',
      );
    }
    throw err;
  }
}

export type CancelReservationInput = z.infer<typeof CancelReservationSchema>;
