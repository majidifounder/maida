import { randomUUID } from 'node:crypto';
import { prisma } from '@restaurant/db';
import { getRedisClient } from '../../lib/redis.js';
import { NotFoundError, UnprocessableError } from '../../errors/index.js';
import { validateLogoBuffer } from '../../lib/image-validation.js';
import { isLogoUploadAvailable, uploadRestaurantLogo as putLogoInR2 } from '../../lib/r2-storage.js';
import {
  assertOwnerCanOperate,
  getEffectiveLimitsForOwner,
} from '../subscription/subscription.service.js';
import {
  computeAvailabilityTimes,
  resolveDurationMins,
  serviceWindowBounds,
} from '../../lib/reservation-engine.js';
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

import { availabilityCacheKey, writeAvailabilityCache } from '../../lib/availability-cache.js';

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

export async function searchRestaurants(input: SearchRestaurantsInput) {
  const { q, city, cuisine, date, partySize, page, limit } = input;
  const offset = (page - 1) * limit;

  let availableRestaurantIds: string[] | undefined;

  if (date && partySize) {
    const restaurantsWithTables = await prisma.restaurant.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        tables: { some: { isActive: true } },
        ...(city && { city: { contains: city, mode: 'insensitive' as const } }),
        ...(cuisine && { cuisine }),
      },
      select: {
        id: true,
        seatingMode: true,
        defaultDurationMins: true,
        openMinutes: true,
        closeMinutes: true,
        timezone: true,
      },
      take: 100,
    });

    const available: string[] = [];
    await Promise.all(
      restaurantsWithTables.map(async (r) => {
        const times = await computeAvailabilityTimes(r, date, partySize);
        if (times.length > 0) available.push(r.id);
      }),
    );
    availableRestaurantIds = available;

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
    select: PUBLIC_RESTAURANT_SELECT,
  });

  if (!restaurant) throw new NotFoundError('Restaurant not found');
  return formatPublicRestaurant(restaurant);
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
      seatingMode: true,
      defaultDurationMins: true,
      openMinutes: true,
      closeMinutes: true,
      timezone: true,
    },
  });
  if (!restaurant) throw new NotFoundError('Restaurant not found');

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
    times = await computeAvailabilityTimes(restaurant, date, partySize);
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

  const standardDurationMins = await resolveDurationMins(
    restaurant.id,
    partySize,
    restaurant.defaultDurationMins,
  );
  const serviceWindow = serviceWindowBounds(
    date,
    restaurant.openMinutes,
    restaurant.closeMinutes,
    restaurant.timezone,
  );

  return {
    times,
    standardDurationMins,
    serviceWindow: {
      open: serviceWindow.windowStart.toISOString(),
      close: serviceWindow.windowEnd.toISOString(),
    },
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

  const restaurant = await prisma.restaurant.create({
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

  if (input.seatingMode === 'FLEXIBLE') {
    const limits = await getEffectiveLimitsForOwner(ownerId);
    if (!limits.flexibleSeating) {
      throw new UnprocessableError(
        'Flexible seating needs a Pro or Premium plan. Upgrade on Billing, then switch seating mode here — your tables and hours stay as they are.',
      );
    }
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
  if (input.maxExtraHours !== undefined) {
    const limits = await getEffectiveLimitsForOwner(ownerId);
    if (!limits.customReservations) {
      throw new UnprocessableError(
        'Maximum extra time for diners needs a Pro or Premium plan. Upgrade on Billing to configure it.',
      );
    }
    data.maxExtraHours = input.maxExtraHours;
  }

  const updated = await prisma.restaurant.update({
    where: { id: restaurantId },
    data,
    select: OWNER_RESTAURANT_SELECT,
  });

  return {
    ...updated,
    customFee: updated.customFee != null ? String(updated.customFee) : null,
    extraHourFee:
      updated.extraHourFee != null ? String(updated.extraHourFee) : null,
  };
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
