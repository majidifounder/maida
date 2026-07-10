import { prisma, Prisma } from '@restaurant/db';
import { publishReservationEvent } from '../../lib/queue.js';
import { publishToRestaurantChannel } from '../../lib/pubsub.js';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  UnprocessableError,
} from '../../errors/index.js';
import { startOfCurrentMonth } from '../../lib/plan.js';
import {
  assertOwnerCanOperate,
  getEffectiveLimitsForOwner,
} from '../subscription/subscription.service.js';
import {
  addMinutes,
  deriveDisplayStatus,
  findBestFitUnit,
  findNextAvailableStart,
  isExclusionViolation,
  loadBookableUnits,
  resolveCustomReservationWindow,
  resolveDurationMins,
  computeEstimatedFee,
  maxCustomDurationMins,
} from '../../lib/reservation-engine.js';
import {
  findContainingWindow,
  loadRestaurantSchedule,
} from '../../lib/service-schedule.js';
import { localDayBoundsUtc, formatLocalDate } from '../../lib/timezone.js';
import { invalidateAvailabilityCacheForDate } from '../../lib/availability-cache.js';

// ── Diner-facing booking guards (abuse controls) ──────────────────────────────
// Furthest ahead a diner may book online. Staff/override paths are exempt so
// owners can still take private-event bookings months out.
const MAX_ADVANCE_DAYS = 365;
// Most concurrent upcoming reservations a single diner may hold across the whole
// platform — caps enumeration/hoarding of tables at zero cost.
const MAX_ACTIVE_RESERVATIONS_PER_DINER = 20;
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
  untilClose: true,
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

async function invalidateAvailabilityCache(
  restaurantId: string,
  startsAt: Date,
  endsAt?: Date,
): Promise<void> {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId },
    select: { timezone: true },
  });
  const tz = restaurant?.timezone ?? 'UTC';
  const startDate = formatLocalDate(startsAt, tz);
  await invalidateAvailabilityCacheForDate(restaurantId, startDate);

  // A reservation crossing local midnight (overnight service windows,
  // until-close, extensions) also changes the NEXT day's availability.
  if (endsAt) {
    const endDate = formatLocalDate(endsAt, tz);
    if (endDate !== startDate) {
      await invalidateAvailabilityCacheForDate(restaurantId, endDate);
    }
  }
}

function formatReservation<T extends { status: string; endsAt: Date }>(
  row: T,
): T & { status: string; rawStatus: string } {
  return {
    ...row,
    // Display status flips past SCHEDULED/SEATED rows to COMPLETED the moment
    // endsAt passes. rawStatus is the DB truth — the owner dashboard needs it
    // to know which lifecycle actions are still legal (e.g. marking a no-show
    // on a row the display layer already retired).
    rawStatus: row.status,
    status: deriveDisplayStatus(row.status, row.endsAt),
  };
}

function serializeReservation<T extends Record<string, unknown>>(
  row: T,
  extras?: { wasCapped?: boolean; standardDurationMins?: number },
) {
  const formatted = formatReservation(
    row as T & { status: string; endsAt: Date },
  );
  const startsAtDate =
    formatted.startsAt instanceof Date
      ? formatted.startsAt
      : new Date(String(formatted.startsAt));
  const endsAtDate =
    formatted.endsAt instanceof Date
      ? formatted.endsAt
      : new Date(String(formatted.endsAt));

  let estimatedFee: string | null = null;
  if (
    formatted.reservationType === 'CUSTOM' &&
    extras?.standardDurationMins != null
  ) {
    const total = computeEstimatedFee(
      formatted.customFeeSnapshot as { toString(): string } | null,
      formatted.extraHourFeeSnapshot as { toString(): string } | null,
      startsAtDate,
      endsAtDate,
      extras.standardDurationMins,
    );
    if (total > 0) estimatedFee = total.toFixed(2);
  }

  return {
    ...formatted,
    startsAt: startsAtDate.toISOString(),
    endsAt: endsAtDate.toISOString(),
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
    untilClose: Boolean(formatted.untilClose),
    wasCapped: extras?.wasCapped ?? false,
    estimatedFee,
  };
}

// Cancelled and no-show reservations do not consume the owner's monthly quota —
// otherwise a diner could burn a restaurant's allowance with fake no-shows.
const RESERVATION_QUOTA_STATUS_EXCLUDED = ['CANCELLED', 'NO_SHOW'] as const;

function reservationQuotaMessage(limit: number): string {
  return `This restaurant has reached its monthly limit of ${limit} reservations. The owner needs to upgrade on Billing before more bookings can be accepted.`;
}

type ReservationQuota = { ownerId: string; monthlyLimit: number };

async function assertReservationPlanLimit(
  restaurantId: string,
): Promise<ReservationQuota> {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId },
    select: { ownerId: true },
  });
  if (!restaurant) throw new NotFoundError('Restaurant not found');

  await assertOwnerCanOperate(restaurant.ownerId);
  const limits = await getEffectiveLimitsForOwner(restaurant.ownerId);
  const monthlyLimit = limits.reservationsPerMonth;
  if (monthlyLimit === Infinity) {
    return { ownerId: restaurant.ownerId, monthlyLimit: Infinity };
  }

  const count = await prisma.reservation.count({
    where: {
      restaurant: { ownerId: restaurant.ownerId },
      status: { notIn: [...RESERVATION_QUOTA_STATUS_EXCLUDED] },
      createdAt: { gte: startOfCurrentMonth() },
    },
  });

  if (count >= monthlyLimit) {
    throw new UnprocessableError(reservationQuotaMessage(monthlyLimit));
  }

  return { ownerId: restaurant.ownerId, monthlyLimit };
}

/** Diner-facing abuse guards: booking horizon, overlap, and concurrent-hold cap. */
async function assertDinerBookingAllowed(
  dinerId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<void> {
  const now = Date.now();
  if (startsAt.getTime() > now + MAX_ADVANCE_DAYS * 86_400_000) {
    throw new UnprocessableError(
      `Reservations can be made up to ${MAX_ADVANCE_DAYS} days in advance.`,
    );
  }

  const overlapping = await prisma.reservation.findFirst({
    where: {
      dinerId,
      status: { in: ['SCHEDULED', 'SEATED'] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  });
  if (overlapping) {
    throw new ConflictError(
      'You already have a reservation that overlaps this time. Cancel it first or choose another time.',
    );
  }

  const activeCount = await prisma.reservation.count({
    where: {
      dinerId,
      status: { in: ['SCHEDULED', 'SEATED'] },
      endsAt: { gt: new Date(now) },
    },
  });
  if (activeCount >= MAX_ACTIVE_RESERVATIONS_PER_DINER) {
    throw new UnprocessableError(
      `You have reached the maximum of ${MAX_ACTIVE_RESERVATIONS_PER_DINER} upcoming reservations. Cancel one before booking again.`,
    );
  }
}

/** Rejects a table set that does not consist of active tables of this restaurant. */
async function assertTablesBelongToRestaurant(
  restaurantId: string,
  tableIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(tableIds)];
  const found = await prisma.diningTable.count({
    where: { id: { in: uniqueIds }, restaurantId, isActive: true },
  });
  if (found !== uniqueIds.length) {
    throw new NotFoundError('One or more tables not found for this restaurant');
  }
}

async function assertCustomReservationAllowed(
  ownerId: string,
): Promise<void> {
  await assertOwnerCanOperate(ownerId);
  const limits = await getEffectiveLimitsForOwner(ownerId);
  if (!limits.customReservations) {
    throw new UnprocessableError(
      'Custom-length reservations and fees need a Pro or Premium plan. Upgrade on Billing to offer them.',
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
      maxExtraHours: true,
    },
  });
  if (!restaurant) throw new NotFoundError('Restaurant not found');
  return restaurant;
}

// Ownership check ONLY — does NOT require an operable subscription. Managing
// reservations that already exist (view, seat, cancel, no-show, extend, free
// early) must keep working after a trial or paid plan lapses; only creating new
// bookings is gated (via assertReservationPlanLimit → assertOwnerCanOperate).
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
  untilClose?: boolean;
  status?: 'SCHEDULED' | 'SEATED';
  seatedAt?: Date;
};

async function createReservationWithHolds(
  params: CreateHoldParams,
  actorId?: string,
  auditAction = 'reservation.created',
  quota?: ReservationQuota,
) {
  const reservation = await prisma.$transaction(async (tx) => {
    // Enforce the owner's monthly reservation quota exactly, even under
    // concurrent bookings: a per-owner advisory lock serialises the count-then-
    // insert so parallel requests cannot both slip past the limit.
    if (quota && Number.isFinite(quota.monthlyLimit)) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${quota.ownerId}))`;
      const used = await tx.reservation.count({
        where: {
          restaurant: { ownerId: quota.ownerId },
          status: { notIn: [...RESERVATION_QUOTA_STATUS_EXCLUDED] },
          createdAt: { gte: startOfCurrentMonth() },
        },
      });
      if (used >= quota.monthlyLimit) {
        throw new UnprocessableError(reservationQuotaMessage(quota.monthlyLimit));
      }
    }

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
        untilClose: params.untilClose ?? false,
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
    untilClose?: boolean;
    guestName?: string;
    notes?: string;
    tableIds?: string[];
    isOverride?: boolean;
    status?: 'SCHEDULED' | 'SEATED';
  },
  actorId?: string,
  quota?: ReservationQuota,
): Promise<{
  row: Awaited<ReturnType<typeof createReservationWithHolds>>;
  wasCapped: boolean;
  standardDurationMins: number;
}> {
  if (params.startsAt <= new Date() && params.source === 'ONLINE') {
    throw new ConflictError('Choose a reservation time in the future.');
  }

  if (params.reservationType === 'CUSTOM') {
    await assertCustomReservationAllowed(restaurant.ownerId);
  }

  // Any explicitly provided tables must be active tables of THIS restaurant —
  // never another tenant's, which would silently block their inventory.
  if (params.tableIds?.length) {
    await assertTablesBelongToRestaurant(restaurant.id, params.tableIds);
  }

  const schedule = await loadRestaurantSchedule(restaurant.id, restaurant);

  const standardDurationMins = await resolveDurationMins(
    restaurant.id,
    params.partySize,
    restaurant.defaultDurationMins,
  );

  let tableIds: string[];
  let endsAt: Date;
  let wasCapped = false;

  if (params.reservationType === 'CUSTOM') {
    const bookingContext = {
      id: restaurant.id,
      seatingMode: restaurant.seatingMode,
      defaultDurationMins: restaurant.defaultDurationMins,
      openMinutes: restaurant.openMinutes,
      closeMinutes: restaurant.closeMinutes,
      timezone: restaurant.timezone,
      maxExtraHours: restaurant.maxExtraHours,
    };

    if (params.untilClose) {
      const resolved = await resolveCustomReservationWindow(
        bookingContext,
        params.partySize,
        params.startsAt,
        { kind: 'untilClose' },
        prisma,
        schedule,
      );
      if (!resolved) {
        const nextAvailable = await findNextAvailableStart(
          restaurant,
          params.partySize,
          params.startsAt,
          maxCustomDurationMins(standardDurationMins, restaurant.maxExtraHours),
          schedule,
        );
        throw new ConflictError(
          'No table available for the requested time',
          nextAvailable
            ? { suggestedNextAvailableAt: nextAvailable.toISOString() }
            : undefined,
        );
      }
      tableIds = params.tableIds?.length ? params.tableIds : resolved.tableIds;
      endsAt = resolved.endsAt;
      wasCapped = resolved.wasCapped;
    } else {
      const durationMins = params.durationMins!;
      const cap = maxCustomDurationMins(
        standardDurationMins,
        restaurant.maxExtraHours,
      );
      if (durationMins > cap) {
        throw new UnprocessableError(
          `Custom reservations cannot exceed ${cap} minutes (${restaurant.maxExtraHours} extra hour(s) beyond the standard table turn).`,
          {
            maxDurationMins: cap,
            standardDurationMins,
            maxExtraHours: restaurant.maxExtraHours,
          },
        );
      }

      const resolved = await resolveCustomReservationWindow(
        bookingContext,
        params.partySize,
        params.startsAt,
        { kind: 'extended', durationMins },
        prisma,
        schedule,
      );
      if (!resolved) {
        const nextAvailable = await findNextAvailableStart(
          restaurant,
          params.partySize,
          params.startsAt,
          durationMins,
          schedule,
        );
        throw new ConflictError(
          'No table available for the requested time',
          nextAvailable
            ? { suggestedNextAvailableAt: nextAvailable.toISOString() }
            : undefined,
        );
      }
      tableIds = params.tableIds?.length ? params.tableIds : resolved.tableIds;
      endsAt = resolved.endsAt;
      wasCapped = resolved.wasCapped;
    }
  } else {
    const durationMins = params.durationMins ?? standardDurationMins;
    endsAt = addMinutes(params.startsAt, durationMins);

    if (params.tableIds?.length) {
      tableIds = params.tableIds;
    } else {
      const units = await loadBookableUnits(
        restaurant.id,
        restaurant.seatingMode,
      );
      if (units.length === 0) {
        throw new ConflictError(
          'This restaurant has no bookable tables yet. The owner needs to add tables before reservations can be accepted.',
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
          undefined,
          schedule,
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
  }

  // The requested interval must fall within the restaurant's opening schedule.
  // Walk-ins (seated now, at staff discretion) and explicit overrides are exempt;
  // online and staff-placed future bookings are not — this is the server-side
  // guard the availability UI relies on but never itself enforced.
  if (params.source === 'ONLINE' || params.source === 'STAFF') {
    const window = findContainingWindow(
      params.startsAt,
      endsAt,
      restaurant.timezone,
      schedule,
    );
    if (!window) {
      const nextAvailable = await findNextAvailableStart(
        restaurant,
        params.partySize,
        params.startsAt,
        params.reservationType === 'CUSTOM' && params.durationMins
          ? params.durationMins
          : undefined,
        schedule,
      );
      throw new ConflictError(
        'The restaurant is not open for the selected time.',
        nextAvailable
          ? { suggestedNextAvailableAt: nextAvailable.toISOString() }
          : undefined,
      );
    }
  }

  // Diner-initiated online bookings are subject to abuse guards (booking horizon,
  // no overlapping holds, concurrent-reservation cap). Staff/walk-in/override
  // paths are owner-initiated and exempt.
  if (params.source === 'ONLINE' && params.dinerId) {
    await assertDinerBookingAllowed(params.dinerId, params.startsAt, endsAt);
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
    const row = await createReservationWithHolds(
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
        ...(params.untilClose && { untilClose: true }),
        ...(params.status !== undefined && { status: params.status }),
        ...(params.status === 'SEATED' && { seatedAt: new Date() }),
      },
      actorId,
      'reservation.created',
      quota,
    );
    return { row, wasCapped, standardDurationMins };
  } catch (err) {
    if (isExclusionViolation(err)) {
      const nextAvailable = await findNextAvailableStart(
        restaurant,
        params.partySize,
        params.startsAt,
        params.reservationType === 'CUSTOM' && params.durationMins
          ? params.durationMins
          : undefined,
        schedule,
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
  const quota = await assertReservationPlanLimit(input.restaurantId);

  const startsAt = new Date(input.startsAt);
  const { row: reservation, wasCapped, standardDurationMins } =
    await createWithAllocation(
    restaurant,
    {
      dinerId,
      partySize: input.partySize,
      startsAt,
      reservationType: input.reservationType,
      source: 'ONLINE',
      ...(input.durationMins !== undefined && { durationMins: input.durationMins }),
      ...(input.untilClose && { untilClose: true }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    dinerId,
    quota,
  );

  await invalidateAvailabilityCache(
    input.restaurantId,
    startsAt,
    reservation.endsAt,
  );

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

  return serializeReservation(reservation, { wasCapped, standardDurationMins });
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
    reservations: rows.map((row) => serializeReservation(row)),
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
      endsAt: true,
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

  await invalidateAvailabilityCache(
    existing.restaurantId,
    existing.startsAt,
    existing.endsAt,
  );

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
    reservations: rows.map((row) => serializeReservation(row)),
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
      endsAt: true,
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

  await invalidateAvailabilityCache(
    restaurantId,
    existing.startsAt,
    existing.endsAt,
  );

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
    select: { id: true, status: true, startsAt: true, endsAt: true },
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

  await invalidateAvailabilityCache(
    restaurantId,
    existing.startsAt,
    existing.endsAt,
  );

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

    await invalidateAvailabilityCache(restaurantId, existing.startsAt, newEndsAt);

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

  await invalidateAvailabilityCache(
    restaurantId,
    existing.startsAt,
    existing.endsAt,
  );

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
  const quota = await assertReservationPlanLimit(restaurantId);

  const restaurant = await loadRestaurantForBooking(restaurantId);
  const now = new Date();
  const durationMins =
    input.durationMins ??
    (await resolveDurationMins(
      restaurant.id,
      input.partySize,
      restaurant.defaultDurationMins,
    ));

  const { row: reservation } = await createWithAllocation(
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
    quota,
  );

  await invalidateAvailabilityCache(restaurantId, now, reservation.endsAt);

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
  const quota = await assertReservationPlanLimit(restaurantId);

  const restaurant = await loadRestaurantForBooking(restaurantId);
  const startsAt = new Date(input.startsAt);

  const { row: reservation } = await createWithAllocation(
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
    quota,
  );

  await invalidateAvailabilityCache(
    restaurantId,
    startsAt,
    reservation.endsAt,
  );

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
  const quota = await assertReservationPlanLimit(restaurantId);

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
      quota,
    );

    await invalidateAvailabilityCache(
    restaurantId,
    startsAt,
    reservation.endsAt,
  );

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
