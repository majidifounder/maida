import { randomUUID } from 'node:crypto';
import { prisma } from '@restaurant/db';
import { getRedisClient } from '../../lib/redis.js';
import { NotFoundError, UnprocessableError } from '../../errors/index.js';
import { validateLogoBuffer } from '../../lib/image-validation.js';
import { isLogoUploadAvailable, uploadRestaurantLogo as putLogoInR2 } from '../../lib/r2-storage.js';
import {
  assertOwnerCanOperate,
  canOwnerOperateFromSubscription,
  getEffectiveLimitsForOwner,
  resolveOwnerBillingState,
} from '../subscription/subscription.service.js';
import {
  computeAvailabilityTimes,
  resolveDurationMins,
} from '../../lib/reservation-engine.js';
import {
  loadRestaurantSchedule,
  loadRestaurantSchedules,
  serviceWindowsForLocalDate,
} from '../../lib/service-schedule.js';
import type {
  CreateCombinationInput,
  CreateRestaurantInput,
  CreateTableInput,
  CreateTurnTimeRuleInput,
  SearchRestaurantsInput,
  UpdateCombinationInput,
  UpdateReservationConfigInput,
  UpdateRestaurantInput,
  UpdateTableInput,
} from './restaurant.schema.js';

import {
  availabilityCacheKey,
  readAvailabilityCacheBatch,
  writeAvailabilityCache,
} from '../../lib/availability-cache.js';

const AVAILABILITY_CACHE_TTL = 300;

async function assertRestaurantOwner(restaurantId: string, callerId: string) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, deletedAt: null },
    select: { ownerId: true },
  });

  if (!restaurant) throw new NotFoundError('Restaurant not found');
  if (restaurant.ownerId !== callerId) {
    throw new NotFoundError('Restaurant not found');
  }

  return restaurant;
}

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
  return `${base}-${randomUUID().slice(0, 8)}`;
}

const PUBLIC_RESTAURANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  cuisine: true,
  description: true,
  address: true,
  city: true,
  imageUrl: true,
  createdAt: true,
  seatingMode: true,
  timezone: true,
  defaultDurationMins: true,
  openMinutes: true,
  closeMinutes: true,
  customFee: true,
  extraHourFee: true,
  feeCurrency: true,
  maxExtraHours: true,
} as const;

const OWNER_RESTAURANT_SELECT = {
  ...PUBLIC_RESTAURANT_SELECT,
  isActive: true,
  updatedAt: true,
} as const;

function formatPublicRestaurant<T extends {
  customFee: unknown;
  extraHourFee: unknown;
}>(restaurant: T) {
  return {
    ...restaurant,
    customFee:
      restaurant.customFee != null ? String(restaurant.customFee) : null,
    extraHourFee:
      restaurant.extraHourFee != null ? String(restaurant.extraHourFee) : null,
  };
}

async function assertRestaurantPlanLimit(ownerId: string): Promise<void> {
  await assertOwnerCanOperate(ownerId);
  const limits = await getEffectiveLimitsForOwner(ownerId);
  if (limits.restaurants === Infinity) return;

  const count = await prisma.restaurant.count({
    where: { ownerId, deletedAt: null },
  });

  if (count >= limits.restaurants) {
    throw new UnprocessableError(
      `You've reached your plan limit of ${limits.restaurants} restaurant(s). Upgrade your plan on Billing to add another.`,
    );
  }
}

async function assertTablePlanLimit(
  restaurantId: string,
  ownerId: string,
): Promise<void> {
  await assertOwnerCanOperate(ownerId);
  const limits = await getEffectiveLimitsForOwner(ownerId);
  if (limits.tablesPerRestaurant === Infinity) return;

  const count = await prisma.diningTable.count({
    where: { restaurantId, isActive: true },
  });

  if (count >= limits.tablesPerRestaurant) {
    throw new UnprocessableError(
      `You've reached your plan limit of ${limits.tablesPerRestaurant} active table(s) for this restaurant. Remove a table or upgrade your plan on Billing.`,
    );
  }
}

async function assertCombinationPlanLimit(
  restaurantId: string,
  ownerId: string,
): Promise<void> {
  await assertOwnerCanOperate(ownerId);
  const limits = await getEffectiveLimitsForOwner(ownerId);
  if (!limits.flexibleSeating) {
    throw new UnprocessableError(
      'Flexible seating and table combinations need a Pro or Premium plan. Upgrade on Billing to unlock this.',
    );
  }
  if (limits.combinationsPerRestaurant === Infinity) return;

  const count = await prisma.tableCombination.count({
    where: { restaurantId, isActive: true },
  });

  if (count >= limits.combinationsPerRestaurant) {
    throw new UnprocessableError(
      `You've reached your plan limit of ${limits.combinationsPerRestaurant} table combination(s). Upgrade on Billing to add more.`,
    );
  }
}

async function assertTurnTimeRulePlanLimit(
  restaurantId: string,
  ownerId: string,
): Promise<void> {
  await assertOwnerCanOperate(ownerId);
  const limits = await getEffectiveLimitsForOwner(ownerId);
  if (limits.turnTimeRulesPerRestaurant === Infinity) return;

  const count = await prisma.turnTimeRule.count({
    where: { restaurantId },
  });

  if (count >= limits.turnTimeRulesPerRestaurant) {
    throw new UnprocessableError(
      `You've reached your plan limit of ${limits.turnTimeRulesPerRestaurant} turn-time rule(s). Upgrade on Billing to add more, or delete an existing rule.`,
    );
  }
}

/**
 * Search-with-availability candidate cap. Beyond this we'd rather ship a
 * precomputed availability index than fan out further — revisit when a single
 * market approaches this many candidate restaurants (documented in
 * docs/ARCHITECTURE-AVAILABILITY.md).
 */
const SEARCH_AVAILABILITY_CANDIDATES = 100;
/** Parallel availability computations for cache misses — bounds pool usage. */
const SEARCH_COMPUTE_CONCURRENCY = 6;

/** Minimal dependency-free concurrency limiter (p-limit shape). */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Restaurant ids with ≥1 bookable slot on `date` for `partySize`.
 *
 * The old implementation ran the full availability engine for up to 100
 * restaurants in parallel per anonymous request (~5 queries each). This
 * version funnels candidates through three near-free gates before any engine
 * work, then serves the survivors cache-first:
 *
 *   1. SQL: active, has tables, matches q/city/cuisine (q was previously NOT
 *      applied here — availability was computed for restaurants the search
 *      would never return, and matches beyond the cap were silently dropped).
 *   2. Billing (1 batched query + pure math): owners who can't operate are
 *      excluded — search must never advertise a restaurant that will refuse
 *      the booking.
 *   3. Schedule (2 batched queries + pure math): closed that day ⇒ out. On a
 *      Monday this alone typically halves the candidate set for free.
 *   4. Shared availability cache (ONE Redis MGET round-trip): the same keys
 *      the detail endpoint reads and mutations invalidate — search hits are
 *      exactly as fresh as detail-page hits.
 *   5. Misses only: engine computation at bounded concurrency, writing back
 *      to the shared cache — every cold search warms the path for both the
 *      next search AND the detail pages diners click through to.
 *
 * Correctness: this filter is advisory (which restaurants to SHOW). The
 * engine + DB exclusion constraint remain the sole authority at booking time.
 */
async function findAvailableRestaurantIds(
  filters: { q?: string; city?: string; cuisine?: SearchRestaurantsInput['cuisine'] },
  date: string,
  partySize: number,
): Promise<string[]> {
  const candidates = await prisma.restaurant.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      tables: { some: { isActive: true } },
      ...(filters.q && {
        name: { contains: filters.q, mode: 'insensitive' as const },
      }),
      ...(filters.city && {
        city: { contains: filters.city, mode: 'insensitive' as const },
      }),
      ...(filters.cuisine && { cuisine: filters.cuisine }),
    },
    select: {
      id: true,
      ownerId: true,
      seatingMode: true,
      defaultDurationMins: true,
      openMinutes: true,
      closeMinutes: true,
      timezone: true,
      owner: {
        select: {
          createdAt: true,
          subscription: {
            select: { status: true, trialStartedAt: true, createdAt: true },
          },
        },
      },
    },
    take: SEARCH_AVAILABILITY_CANDIDATES,
  });
  if (candidates.length === 0) return [];

  // Gate 2 — billing, pure math on the joined subscription row.
  const operable = candidates.filter((r) =>
    canOwnerOperateFromSubscription(r.owner.subscription, r.owner.createdAt),
  );
  if (operable.length === 0) return [];

  // Gate 3 — open that day at all? Two batched queries, then pure math.
  const schedules = await loadRestaurantSchedules(operable);
  const open = operable.filter(
    (r) =>
      serviceWindowsForLocalDate(date, r.timezone, schedules.get(r.id)!)
        .length > 0,
  );
  if (open.length === 0) return [];

  // Gate 4 — shared cache, one MGET round-trip.
  const cached = await readAvailabilityCacheBatch(
    open.map((r) => r.id),
    date,
    partySize,
  );

  const available: string[] = [];
  const misses: typeof open = [];
  open.forEach((r, i) => {
    const raw = cached[i];
    if (raw == null) {
      misses.push(r);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { times: unknown[] };
      if (parsed.times.length > 0) available.push(r.id);
    } catch {
      misses.push(r); // corrupt entry — recompute
    }
  });

  // Gate 5 — engine work for misses only, bounded, cache-warming.
  await mapWithConcurrency(misses, SEARCH_COMPUTE_CONCURRENCY, async (r) => {
    const times = await computeAvailabilityTimes(
      r,
      date,
      partySize,
      schedules.get(r.id),
    );
    if (times.length > 0) available.push(r.id);
    try {
      await writeAvailabilityCache(
        r.id,
        date,
        partySize,
        JSON.stringify({ times }),
      );
    } catch {
      /* cache write is best-effort */
    }
  });

  return available;
}

export async function searchRestaurants(input: SearchRestaurantsInput) {
  const { q, city, cuisine, date, partySize, page, limit } = input;
  const offset = (page - 1) * limit;

  let availableRestaurantIds: string[] | undefined;

  if (date && partySize) {
    availableRestaurantIds = await findAvailableRestaurantIds(
      {
        ...(q !== undefined && { q }),
        ...(city !== undefined && { city }),
        ...(cuisine !== undefined && { cuisine }),
      },
      date,
      partySize,
    );

    if (availableRestaurantIds.length === 0) {
      return { restaurants: [], total: 0, page, limit };
    }
  }

  const where = {
    isActive: true,
    deletedAt: null,
    ...(q && { name: { contains: q, mode: 'insensitive' as const } }),
    ...(city && { city: { contains: city, mode: 'insensitive' as const } }),
    ...(cuisine && { cuisine }),
    ...(availableRestaurantIds && { id: { in: availableRestaurantIds } }),
  };

  const [restaurants, total] = await prisma.$transaction([
    prisma.restaurant.findMany({
      where,
      select: PUBLIC_RESTAURANT_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.restaurant.count({ where }),
  ]);

  return { restaurants: restaurants.map(formatPublicRestaurant), total, page, limit };
}

export async function getRestaurant(restaurantId: string) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, isActive: true, deletedAt: null },
    select: { ...PUBLIC_RESTAURANT_SELECT, ownerId: true },
  });

  if (!restaurant) throw new NotFoundError('Restaurant not found');

  // Custom-length reservations are gated by the owner's plan, not by whether a
  // fee happens to be set. Expose a single authoritative flag so the diner UI
  // and the booking API agree on who may offer them.
  const limits = await getEffectiveLimitsForOwner(restaurant.ownerId);
  const offersCustomReservations =
    limits.customReservations && restaurant.maxExtraHours > 0;

  const { ownerId: _ownerId, ...publicFields } = restaurant;
  return { ...formatPublicRestaurant(publicFields), offersCustomReservations };
}

export async function getRestaurantConfig(
  restaurantId: string,
  callerId: string,
) {
  await assertRestaurantOwner(restaurantId, callerId);

  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, deletedAt: null },
    select: OWNER_RESTAURANT_SELECT,
  });
  if (!restaurant) throw new NotFoundError('Restaurant not found');

  return formatPublicRestaurant(restaurant);
}

export async function getAvailability(
  restaurantId: string,
  date: string,
  partySize: number,
) {
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
    },
  });
  if (!restaurant) throw new NotFoundError('Restaurant not found');

  const schedule = await loadRestaurantSchedule(restaurant.id, restaurant);
  const windows = serviceWindowsForLocalDate(date, restaurant.timezone, schedule);
  const serviceWindows = windows.map((w) => ({
    open: w.start.toISOString(),
    close: w.end.toISOString(),
  }));
  const serviceWindow =
    serviceWindows.length > 0
      ? {
          open: serviceWindows[0]!.open,
          close: serviceWindows[serviceWindows.length - 1]!.close,
        }
      : null;

  const standardDurationMins = await resolveDurationMins(
    restaurant.id,
    partySize,
    restaurant.defaultDurationMins,
  );

  // A restaurant whose owner cannot currently operate (expired trial / lapsed
  // plan) is not taking online reservations. Return no slots and a clear reason
  // so the diner app can explain instead of failing at booking time.
  const billing = await resolveOwnerBillingState(restaurant.ownerId);
  if (!billing.canOperate) {
    return {
      times: [],
      standardDurationMins,
      serviceWindow,
      serviceWindows,
      bookable: false,
      notice:
        'This restaurant is not currently accepting online reservations. Please check back later.',
    };
  }

  const cacheKey = availabilityCacheKey(restaurantId, date, partySize);
  let times: Awaited<ReturnType<typeof computeAvailabilityTimes>> | null = null;
  try {
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { times: typeof times };
      times = parsed.times;
    }
  } catch {
    /* non-fatal */
  }

  if (!times) {
    times = await computeAvailabilityTimes(
      restaurant,
      date,
      partySize,
      schedule,
    );
    try {
      await writeAvailabilityCache(
        restaurantId,
        date,
        partySize,
        JSON.stringify({ times }),
        AVAILABILITY_CACHE_TTL,
      );
    } catch {
      /* non-fatal */
    }
  }

  return {
    times,
    standardDurationMins,
    serviceWindow,
    serviceWindows,
    bookable: true,
  };
}

export async function getMyRestaurants(ownerId: string) {
  const rows = await prisma.restaurant.findMany({
    where: { ownerId, deletedAt: null },
    select: OWNER_RESTAURANT_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(formatPublicRestaurant);
}

async function assertFlexibleSeatingAllowed(
  ownerId: string,
  seatingMode?: import('@restaurant/db').SeatingMode,
): Promise<void> {
  if (seatingMode !== 'FLEXIBLE') return;

  await assertOwnerCanOperate(ownerId);
  const limits = await getEffectiveLimitsForOwner(ownerId);
  if (!limits.flexibleSeating) {
    throw new UnprocessableError(
      'Flexible seating needs a Pro or Premium plan. Upgrade on Billing, then switch seating mode here — your tables and hours stay as they are.',
    );
  }
}

export async function createRestaurant(
  ownerId: string,
  input: CreateRestaurantInput,
) {
  await assertRestaurantPlanLimit(ownerId);
  await assertFlexibleSeatingAllowed(ownerId, input.seatingMode);

  const slug = generateSlug(input.name);

  const restaurant = await prisma.$transaction(async (tx) => {
    const created = await tx.restaurant.create({
      data: {
        name: input.name,
        description: input.description,
        cuisine: input.cuisine,
        address: input.address,
        city: input.city,
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.seatingMode !== undefined && { seatingMode: input.seatingMode }),
        ...(input.defaultDurationMins !== undefined && {
          defaultDurationMins: input.defaultDurationMins,
        }),
        ...(input.openMinutes !== undefined && { openMinutes: input.openMinutes }),
        ...(input.closeMinutes !== undefined && {
          closeMinutes: input.closeMinutes,
        }),
        slug,
        ownerId,
        isActive: true,
      },
      select: OWNER_RESTAURANT_SELECT,
    });

    // Seed a uniform weekly schedule from the initial open/close window so the
    // reservation engine has explicit ServicePeriod rows to work from.
    await tx.servicePeriod.createMany({
      data: uniformWeeklyPeriods(
        created.id,
        created.openMinutes,
        created.closeMinutes,
      ),
    });

    return created;
  });

  return formatPublicRestaurant(restaurant);
}

export async function updateRestaurant(
  restaurantId: string,
  callerId: string,
  input: UpdateRestaurantInput,
) {
  await assertOwnerCanOperate(callerId);
  await assertRestaurantOwner(restaurantId, callerId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.cuisine !== undefined) data.cuisine = input.cuisine;
  if (input.address !== undefined) data.address = input.address;
  if (input.city !== undefined) data.city = input.city;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.timezone !== undefined) data.timezone = input.timezone;

  return prisma.restaurant.update({
    where: { id: restaurantId },
    data,
    select: OWNER_RESTAURANT_SELECT,
  });
}

export async function updateReservationConfig(
  restaurantId: string,
  callerId: string,
  input: UpdateReservationConfigInput,
) {
  const { ownerId } = await assertRestaurantOwner(restaurantId, callerId);
  await assertOwnerCanOperate(ownerId);
  const limits = await getEffectiveLimitsForOwner(ownerId);

  if (input.seatingMode === 'FLEXIBLE' && !limits.flexibleSeating) {
    throw new UnprocessableError(
      'Flexible seating needs a Pro or Premium plan. Upgrade on Billing, then switch seating mode here — your tables and hours stay as they are.',
    );
  }

  // Custom-length reservations (fees + extra time) are a Pro/Premium capability.
  const wantsCustomReservationChange =
    input.customFee !== undefined ||
    input.extraHourFee !== undefined ||
    input.maxExtraHours !== undefined;
  if (wantsCustomReservationChange && !limits.customReservations) {
    throw new UnprocessableError(
      'Custom-length reservations, fees, and extra time need a Pro or Premium plan. Upgrade on Billing to configure them.',
    );
  }

  const data: Record<string, unknown> = {};
  if (input.seatingMode !== undefined) data.seatingMode = input.seatingMode;
  if (input.defaultDurationMins !== undefined)
    data.defaultDurationMins = input.defaultDurationMins;
  if (input.openMinutes !== undefined) data.openMinutes = input.openMinutes;
  if (input.closeMinutes !== undefined) data.closeMinutes = input.closeMinutes;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.customFee !== undefined) data.customFee = input.customFee;
  if (input.extraHourFee !== undefined) data.extraHourFee = input.extraHourFee;
  if (input.feeCurrency !== undefined) data.feeCurrency = input.feeCurrency;
  if (input.maxExtraHours !== undefined) data.maxExtraHours = input.maxExtraHours;

  // Setting the simple open/close window resets the weekly schedule to a uniform
  // one for all seven days. Granular per-day hours and closures are managed via
  // the weekly-schedule endpoints, which do not go through this path.
  const regenerateSchedule =
    input.openMinutes !== undefined || input.closeMinutes !== undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.restaurant.update({
      where: { id: restaurantId },
      data,
      select: OWNER_RESTAURANT_SELECT,
    });

    if (regenerateSchedule) {
      await tx.servicePeriod.deleteMany({ where: { restaurantId } });
      await tx.servicePeriod.createMany({
        data: uniformWeeklyPeriods(
          restaurantId,
          row.openMinutes,
          row.closeMinutes,
        ),
      });
    }

    return row;
  });

  return {
    ...updated,
    customFee: updated.customFee != null ? String(updated.customFee) : null,
    extraHourFee:
      updated.extraHourFee != null ? String(updated.extraHourFee) : null,
  };
}

/** Seven identical daily windows — the default schedule for a simple open/close. */
function uniformWeeklyPeriods(
  restaurantId: string,
  openMinute: number,
  closeMinute: number,
): Array<{
  restaurantId: string;
  dayOfWeek: number;
  openMinute: number;
  closeMinute: number;
}> {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    restaurantId,
    dayOfWeek,
    openMinute,
    closeMinute,
  }));
}

export async function deleteRestaurant(restaurantId: string, callerId: string) {
  await assertOwnerCanOperate(callerId);
  await assertRestaurantOwner(restaurantId, callerId);

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { deletedAt: new Date(), isActive: false },
  });
}

// ── Dining tables ─────────────────────────────────────────────────────────────

export async function listTables(restaurantId: string, callerId: string) {
  await assertRestaurantOwner(restaurantId, callerId);
  return prisma.diningTable.findMany({
    where: { restaurantId },
    orderBy: { name: 'asc' },
  });
}

export async function createTable(
  restaurantId: string,
  callerId: string,
  input: CreateTableInput,
) {
  await assertRestaurantOwner(restaurantId, callerId);
  await assertTablePlanLimit(restaurantId, callerId);

  if (input.maxPartySize < input.minPartySize) {
    throw new UnprocessableError('maxPartySize must be >= minPartySize');
  }

  return prisma.diningTable.create({
    data: {
      restaurantId,
      name: input.name,
      minPartySize: input.minPartySize,
      maxPartySize: input.maxPartySize,
    },
  });
}

export async function updateTable(
  restaurantId: string,
  tableId: string,
  callerId: string,
  input: UpdateTableInput,
) {
  await assertOwnerCanOperate(callerId);
  await assertRestaurantOwner(restaurantId, callerId);

  const existing = await prisma.diningTable.findFirst({
    where: { id: tableId, restaurantId },
  });
  if (!existing) throw new NotFoundError('Table not found');

  return prisma.diningTable.update({
    where: { id: tableId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.minPartySize !== undefined && { minPartySize: input.minPartySize }),
      ...(input.maxPartySize !== undefined && { maxPartySize: input.maxPartySize }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

export async function deleteTable(
  restaurantId: string,
  tableId: string,
  callerId: string,
) {
  await assertOwnerCanOperate(callerId);
  await assertRestaurantOwner(restaurantId, callerId);

  const existing = await prisma.diningTable.findFirst({
    where: { id: tableId, restaurantId },
  });
  if (!existing) throw new NotFoundError('Table not found');

  await prisma.diningTable.update({
    where: { id: tableId },
    data: { isActive: false },
  });
}

// ── Table combinations ────────────────────────────────────────────────────────

export async function listCombinations(restaurantId: string, callerId: string) {
  await assertRestaurantOwner(restaurantId, callerId);

  const combos = await prisma.tableCombination.findMany({
    where: { restaurantId },
    include: { members: { select: { tableId: true } } },
    orderBy: { name: 'asc' },
  });

  return combos.map((c) => ({
    id: c.id,
    restaurantId: c.restaurantId,
    name: c.name,
    minPartySize: c.minPartySize,
    maxPartySize: c.maxPartySize,
    isActive: c.isActive,
    tableIds: c.members.map((m) => m.tableId),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

export async function createCombination(
  restaurantId: string,
  callerId: string,
  input: CreateCombinationInput,
) {
  await assertRestaurantOwner(restaurantId, callerId);
  await assertCombinationPlanLimit(restaurantId, callerId);

  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId },
    select: { seatingMode: true },
  });
  if (restaurant?.seatingMode !== 'FLEXIBLE') {
    throw new UnprocessableError(
      'Table combinations only work in Flexible seating mode. Change seating mode in Reservation settings first.',
    );
  }

  const tables = await prisma.diningTable.findMany({
    where: { id: { in: input.tableIds }, restaurantId, isActive: true },
    select: { id: true },
  });
  if (tables.length !== input.tableIds.length) {
    throw new NotFoundError('One or more tables not found');
  }

  return prisma.$transaction(async (tx) => {
    const combo = await tx.tableCombination.create({
      data: {
        restaurantId,
        name: input.name,
        minPartySize: input.minPartySize,
        maxPartySize: input.maxPartySize,
        members: {
          create: input.tableIds.map((tableId) => ({ tableId })),
        },
      },
      include: { members: { select: { tableId: true } } },
    });

    return {
      ...combo,
      tableIds: combo.members.map((m) => m.tableId),
    };
  });
}

export async function updateCombination(
  restaurantId: string,
  combinationId: string,
  callerId: string,
  input: UpdateCombinationInput,
) {
  await assertOwnerCanOperate(callerId);
  await assertRestaurantOwner(restaurantId, callerId);

  const existing = await prisma.tableCombination.findFirst({
    where: { id: combinationId, restaurantId },
  });
  if (!existing) throw new NotFoundError('Combination not found');

  if (input.tableIds) {
    const tables = await prisma.diningTable.findMany({
      where: { id: { in: input.tableIds }, restaurantId, isActive: true },
    });
    if (tables.length !== input.tableIds.length) {
      throw new NotFoundError('One or more tables not found');
    }

    await prisma.tableCombinationMember.deleteMany({
      where: { combinationId },
    });
    await prisma.tableCombinationMember.createMany({
      data: input.tableIds.map((tableId) => ({ combinationId, tableId })),
    });
  }

  const updated = await prisma.tableCombination.update({
    where: { id: combinationId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.minPartySize !== undefined && { minPartySize: input.minPartySize }),
      ...(input.maxPartySize !== undefined && { maxPartySize: input.maxPartySize }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    include: { members: { select: { tableId: true } } },
  });

  return {
    ...updated,
    tableIds: updated.members.map((m) => m.tableId),
  };
}

export async function deleteCombination(
  restaurantId: string,
  combinationId: string,
  callerId: string,
) {
  await assertOwnerCanOperate(callerId);
  await assertRestaurantOwner(restaurantId, callerId);

  const existing = await prisma.tableCombination.findFirst({
    where: { id: combinationId, restaurantId },
  });
  if (!existing) throw new NotFoundError('Combination not found');

  await prisma.tableCombination.update({
    where: { id: combinationId },
    data: { isActive: false },
  });
}

// ── Turn-time rules ─────────────────────────────────────────────────────────

export async function listTurnTimeRules(
  restaurantId: string,
  callerId: string,
) {
  await assertRestaurantOwner(restaurantId, callerId);
  return prisma.turnTimeRule.findMany({
    where: { restaurantId },
    orderBy: { minPartySize: 'asc' },
  });
}

export async function createTurnTimeRule(
  restaurantId: string,
  callerId: string,
  input: CreateTurnTimeRuleInput,
) {
  await assertRestaurantOwner(restaurantId, callerId);
  await assertTurnTimeRulePlanLimit(restaurantId, callerId);

  if (input.maxPartySize < input.minPartySize) {
    throw new UnprocessableError('maxPartySize must be >= minPartySize');
  }

  return prisma.turnTimeRule.create({
    data: {
      restaurantId,
      minPartySize: input.minPartySize,
      maxPartySize: input.maxPartySize,
      durationMins: input.durationMins,
    },
  });
}

export async function deleteTurnTimeRule(
  restaurantId: string,
  ruleId: string,
  callerId: string,
) {
  await assertOwnerCanOperate(callerId);
  await assertRestaurantOwner(restaurantId, callerId);

  const existing = await prisma.turnTimeRule.findFirst({
    where: { id: ruleId, restaurantId },
  });
  if (!existing) throw new NotFoundError('Turn-time rule not found');

  await prisma.turnTimeRule.delete({ where: { id: ruleId } });
}

export async function setRestaurantLogo(
  restaurantId: string,
  callerId: string,
  fileBuffer: Buffer,
): Promise<{ imageUrl: string }> {
  await assertOwnerCanOperate(callerId);
  await assertRestaurantOwner(restaurantId, callerId);

  if (!isLogoUploadAvailable()) {
    throw new UnprocessableError(
      'Logo upload is not configured on this server. Please try again later.',
    );
  }

  let image;
  try {
    image = validateLogoBuffer(fileBuffer);
  } catch (err) {
    throw new UnprocessableError(
      err instanceof Error ? err.message : 'Invalid image file',
    );
  }

  const imageUrl = await putLogoInR2(restaurantId, fileBuffer, image);

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { imageUrl },
  });

  return { imageUrl };
}

// ── Weekly schedule & closures ─────────────────────────────────────────────────

function closureDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getRestaurantSchedule(
  restaurantId: string,
  callerId: string,
) {
  await assertRestaurantOwner(restaurantId, callerId);

  const [periods, closures] = await Promise.all([
    prisma.servicePeriod.findMany({
      where: { restaurantId },
      orderBy: [{ dayOfWeek: 'asc' }, { openMinute: 'asc' }],
      select: { id: true, dayOfWeek: true, openMinute: true, closeMinute: true },
    }),
    prisma.restaurantClosure.findMany({
      where: { restaurantId },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, reason: true },
    }),
  ]);

  return {
    periods,
    closures: closures.map((c) => ({
      id: c.id,
      date: closureDateIso(c.date),
      reason: c.reason,
    })),
  };
}

export async function replaceRestaurantSchedule(
  restaurantId: string,
  callerId: string,
  periods: Array<{ dayOfWeek: number; openMinute: number; closeMinute: number }>,
) {
  const { ownerId } = await assertRestaurantOwner(restaurantId, callerId);
  await assertOwnerCanOperate(ownerId);

  // Refresh the coarse legacy day-span columns for display. Overnight windows
  // (closeMinute <= openMinute) count as running to end-of-day for the span.
  let spanUpdate: { openMinutes: number; closeMinutes: number } | undefined;
  if (periods.length > 0) {
    const openMinutes = Math.min(...periods.map((p) => p.openMinute));
    const closeMinutes = Math.max(
      ...periods.map((p) => (p.closeMinute > p.openMinute ? p.closeMinute : 1440)),
    );
    spanUpdate = {
      openMinutes,
      closeMinutes: Math.max(closeMinutes, openMinutes + 1),
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.servicePeriod.deleteMany({ where: { restaurantId } });
    if (periods.length > 0) {
      await tx.servicePeriod.createMany({
        data: periods.map((p) => ({
          restaurantId,
          dayOfWeek: p.dayOfWeek,
          openMinute: p.openMinute,
          closeMinute: p.closeMinute,
        })),
      });
    }
    if (spanUpdate) {
      await tx.restaurant.update({
        where: { id: restaurantId },
        data: spanUpdate,
      });
    }
  });

  return getRestaurantSchedule(restaurantId, callerId);
}

export async function addRestaurantClosure(
  restaurantId: string,
  callerId: string,
  input: { date: string; reason?: string | undefined },
) {
  const { ownerId } = await assertRestaurantOwner(restaurantId, callerId);
  await assertOwnerCanOperate(ownerId);

  const closure = await prisma.restaurantClosure.create({
    data: {
      restaurantId,
      date: new Date(`${input.date}T00:00:00.000Z`),
      reason: input.reason ?? null,
    },
    select: { id: true, date: true, reason: true },
  });

  return {
    id: closure.id,
    date: closureDateIso(closure.date),
    reason: closure.reason,
  };
}

export async function deleteRestaurantClosure(
  restaurantId: string,
  closureId: string,
  callerId: string,
) {
  const { ownerId } = await assertRestaurantOwner(restaurantId, callerId);
  await assertOwnerCanOperate(ownerId);

  const existing = await prisma.restaurantClosure.findFirst({
    where: { id: closureId, restaurantId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Closure not found');

  await prisma.restaurantClosure.delete({ where: { id: closureId } });
}
