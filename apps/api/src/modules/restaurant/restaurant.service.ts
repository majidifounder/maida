import { randomUUID } from 'node:crypto';
import { prisma } from '@restaurant/db';
import { getRedisClient } from '../../lib/redis.js';
import { NotFoundError, ForbiddenError, UnprocessableError } from '../../errors/index.js';
import { getPlanLimits } from '../../lib/plan.js';
import { getCurrentPlan } from '../subscription/subscription.service.js';
import type {
  CreateRestaurantInput,
  UpdateRestaurantInput,
  SearchRestaurantsInput,
  CreateSlotsInput,
  UpdateSlotInput,
} from './restaurant.schema.js';

const SLOT_CACHE_TTL = 300;
const DEFAULT_MAX_CAPACITY = 20;

function slotCacheKey(restaurantId: string, date: string): string {
  return `restaurant:${restaurantId}:slots:${date}`;
}

function dateFromDatetime(iso: string): string {
  return iso.slice(0, 10);
}

type PublicSlot = {
  id: string;
  startsAt: string;
  capacity: number;
  available: number;
};

function filterUpcomingSlots(slots: PublicSlot[]): PublicSlot[] {
  const now = Date.now();
  return slots.filter((slot) => new Date(slot.startsAt).getTime() > now);
}

async function cacheGetSlots(
  restaurantId: string,
  date: string,
): Promise<unknown[] | null> {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(slotCacheKey(restaurantId, date));
    return cached ? (JSON.parse(cached) as unknown[]) : null;
  } catch (err) {
    console.warn(
      '[Redis] cache read failed (non-fatal):',
      (err as Error).message,
    );
    return null;
  }
}

async function cacheSetSlots(
  restaurantId: string,
  date: string,
  slots: unknown[],
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(
      slotCacheKey(restaurantId, date),
      JSON.stringify(slots),
      'EX',
      SLOT_CACHE_TTL,
    );
  } catch (err) {
    console.warn(
      '[Redis] cache write failed (non-fatal):',
      (err as Error).message,
    );
  }
}

async function cacheInvalidateSlots(
  restaurantId: string,
  dates: string[],
): Promise<void> {
  if (dates.length === 0) return;
  try {
    const redis = getRedisClient();
    const keys = [...new Set(dates)].map((d) => slotCacheKey(restaurantId, d));
    await redis.del(...keys);
  } catch (err) {
    console.warn(
      '[Redis] cache invalidation failed (non-fatal):',
      (err as Error).message,
    );
  }
}

async function assertRestaurantOwner(restaurantId: string, callerId: string) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, deletedAt: null },
    select: { ownerId: true },
  });

  if (!restaurant) throw new NotFoundError('Restaurant not found');
  if (restaurant.ownerId !== callerId) {
    throw new ForbiddenError('You do not own this restaurant');
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
} as const;

export async function searchRestaurants(input: SearchRestaurantsInput) {
  const { q, city, cuisine, date, partySize, page, limit } = input;
  const offset = (page - 1) * limit;

  let availableRestaurantIds: string[] | undefined;

  if (date && partySize) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const rows = await prisma.$queryRaw<Array<{ restaurantId: string }>>`
      SELECT DISTINCT "restaurantId"
      FROM "time_slots"
      WHERE "startsAt" >= ${startOfDay}
        AND "startsAt" <= ${endOfDay}
        AND "isActive" = true
        AND (capacity - booked) >= ${partySize}
    `;

    availableRestaurantIds = rows.map((r) => r.restaurantId);

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

  return { restaurants, total, page, limit };
}

export async function getRestaurant(restaurantId: string) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: restaurantId, isActive: true, deletedAt: null },
    select: PUBLIC_RESTAURANT_SELECT,
  });

  if (!restaurant) throw new NotFoundError('Restaurant not found');
  return restaurant;
}

export async function getAvailableSlots(restaurantId: string, date: string) {
  const exists = await prisma.restaurant.findFirst({
    where: { id: restaurantId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Restaurant not found');

  const cached = await cacheGetSlots(restaurantId, date);
  if (cached) return filterUpcomingSlots(cached as PublicSlot[]);

  const startOfDay = new Date(`${date}T00:00:00.000Z`);
  const endOfDay = new Date(`${date}T23:59:59.999Z`);

  const slots = await prisma.timeSlot.findMany({
    where: {
      restaurantId,
      startsAt: { gte: startOfDay, lte: endOfDay },
      isActive: true,
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      capacity: true,
      booked: true,
    },
  });

  const publicSlots = slots.map((s) => ({
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    capacity: s.capacity,
    available: s.capacity - s.booked,
  }));

  const upcomingSlots = filterUpcomingSlots(publicSlots);

  await cacheSetSlots(restaurantId, date, upcomingSlots);

  return upcomingSlots;
}

export async function getMyRestaurants(ownerId: string) {
  return prisma.restaurant.findMany({
    where: { ownerId, deletedAt: null },
    select: { ...PUBLIC_RESTAURANT_SELECT, isActive: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function assertRestaurantPlanLimit(ownerId: string): Promise<void> {
  const plan = await getCurrentPlan(ownerId);
  const limits = getPlanLimits(plan as import('@restaurant/types').Plan);
  if (limits.restaurants === Infinity) return;

  const count = await prisma.restaurant.count({
    where: { ownerId, deletedAt: null },
  });

  if (count >= limits.restaurants) {
    throw new UnprocessableError(
      `Your ${plan} plan allows up to ${limits.restaurants} restaurant(s). ` +
        `Upgrade to add more.`,
    );
  }
}

export async function createRestaurant(
  ownerId: string,
  input: CreateRestaurantInput,
) {
  await assertRestaurantPlanLimit(ownerId);

  const slug = generateSlug(input.name);

  return prisma.restaurant.create({
    data: {
      name: input.name,
      description: input.description,
      cuisine: input.cuisine,
      address: input.address,
      city: input.city,
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      slug,
      ownerId,
      isActive: true,
      maxCapacity: DEFAULT_MAX_CAPACITY,
    },
    select: { ...PUBLIC_RESTAURANT_SELECT, isActive: true },
  });
}

export async function updateRestaurant(
  restaurantId: string,
  callerId: string,
  input: UpdateRestaurantInput,
) {
  await assertRestaurantOwner(restaurantId, callerId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.cuisine !== undefined) data.cuisine = input.cuisine;
  if (input.address !== undefined) data.address = input.address;
  if (input.city !== undefined) data.city = input.city;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return prisma.restaurant.update({
    where: { id: restaurantId },
    data,
    select: { ...PUBLIC_RESTAURANT_SELECT, isActive: true, updatedAt: true },
  });
}

export async function deleteRestaurant(restaurantId: string, callerId: string) {
  await assertRestaurantOwner(restaurantId, callerId);

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { deletedAt: new Date(), isActive: false },
  });
}

export async function createSlots(
  restaurantId: string,
  callerId: string,
  input: CreateSlotsInput,
) {
  await assertRestaurantOwner(restaurantId, callerId);

  const data = input.slots.map((s) => ({
    restaurantId,
    startsAt: new Date(s.startsAt),
    capacity: s.capacity,
    booked: 0,
    isActive: true,
  }));

  await prisma.timeSlot.createMany({ data });

  const dates = input.slots.map((s) => dateFromDatetime(s.startsAt));
  await cacheInvalidateSlots(restaurantId, dates);

  const startTimes = data.map((d) => d.startsAt);
  return prisma.timeSlot.findMany({
    where: { restaurantId, startsAt: { in: startTimes } },
    select: {
      id: true,
      startsAt: true,
      capacity: true,
      booked: true,
      isActive: true,
    },
    orderBy: { startsAt: 'asc' },
  });
}

export async function updateSlot(
  restaurantId: string,
  slotId: string,
  callerId: string,
  input: UpdateSlotInput,
) {
  await assertRestaurantOwner(restaurantId, callerId);

  const existing = await prisma.timeSlot.findFirst({
    where: { id: slotId, restaurantId },
    select: { startsAt: true },
  });
  if (!existing) throw new NotFoundError('Slot not found');

  const updated = await prisma.timeSlot.update({
    where: { id: slotId },
    data: {
      ...(input.startsAt !== undefined && {
        startsAt: new Date(input.startsAt),
      }),
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    select: {
      id: true,
      startsAt: true,
      capacity: true,
      booked: true,
      isActive: true,
    },
  });

  const datesToInvalidate = [dateFromDatetime(existing.startsAt.toISOString())];
  if (input.startsAt) {
    datesToInvalidate.push(dateFromDatetime(input.startsAt));
  }
  await cacheInvalidateSlots(restaurantId, datesToInvalidate);

  return updated;
}

export async function deleteSlot(
  restaurantId: string,
  slotId: string,
  callerId: string,
) {
  await assertRestaurantOwner(restaurantId, callerId);

  const slot = await prisma.timeSlot.findFirst({
    where: { id: slotId, restaurantId },
    select: { startsAt: true },
  });
  if (!slot) throw new NotFoundError('Slot not found');

  await prisma.timeSlot.update({
    where: { id: slotId },
    data: { isActive: false },
  });

  await cacheInvalidateSlots(restaurantId, [
    dateFromDatetime(slot.startsAt.toISOString()),
  ]);
}
