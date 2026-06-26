import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@restaurant/db';
import { verifyAccessToken } from '../../lib/jwt.js';

/** Returns a YYYY-MM-DD string N days from today (UTC) */
export function futureDate(daysFromNow = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/** Returns a full ISO datetime string N days from today at the given UTC hour */
export function futureDatetime(daysFromNow = 1, hourUtc = 12): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

export interface TestRestaurant {
  id: string;
  name: string;
  slug: string;
}

/**
 * Create a restaurant via the API as the given owner token.
 * Returns the created restaurant — throws if the request fails.
 */
export async function createTestRestaurant(
  server: FastifyInstance,
  ownerToken: string,
  overrides: Record<string, unknown> = {},
): Promise<TestRestaurant> {
  const { sub: ownerId } = verifyAccessToken(ownerToken);
  await prisma.subscription.upsert({
    where: { userId: ownerId },
    create: { userId: ownerId, plan: 'PREMIUM' },
    update: { plan: 'PREMIUM' },
  });

  const res = await server.inject({
    method: 'POST',
    url: '/restaurants',
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {
      name: `Test Restaurant ${randomUUID().slice(0, 8)}`,
      description: 'A test restaurant created by the integration test suite',
      cuisine: 'FRENCH',
      address: '1 Test Street',
      city: 'TestCity',
      ...overrides,
    },
  });

  if (res.statusCode !== 201) {
    throw new Error(`createTestRestaurant failed: ${res.statusCode} ${res.body}`);
  }

  const body = JSON.parse(res.body) as { restaurant: TestRestaurant };
  return body.restaurant;
}

export interface TestSlot {
  id: string;
  startsAt: string;
  capacity: number;
}

/**
 * Bulk-create slots for a restaurant on the given date (default: tomorrow).
 * Returns the array of created slots.
 */
export async function createTestSlots(
  server: FastifyInstance,
  restaurantId: string,
  ownerToken: string,
  opts: { date?: string; count?: number; capacity?: number } = {},
): Promise<TestSlot[]> {
  const date = opts.date ?? futureDate(1);
  const count = opts.count ?? 3;
  const capacity = opts.capacity ?? 10;

  const slots = Array.from({ length: count }, (_, i) => ({
    startsAt: `${date}T${String(12 + i).padStart(2, '0')}:00:00.000Z`,
    capacity,
  }));

  const res = await server.inject({
    method: 'POST',
    url: `/restaurants/${restaurantId}/slots`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { slots },
  });

  if (res.statusCode !== 201) {
    throw new Error(`createTestSlots failed: ${res.statusCode} ${res.body}`);
  }

  const body = JSON.parse(res.body) as { slots: TestSlot[] };
  return body.slots;
}

/**
 * Hard-delete restaurants and their slots by ID.
 * Safe to call even if some IDs were already soft-deleted.
 * Call this in afterAll alongside cleanupTestUsers.
 */
export async function cleanupTestRestaurants(
  restaurantIds: string[],
): Promise<void> {
  if (restaurantIds.length === 0) return;

  await prisma.timeSlot.deleteMany({
    where: { restaurantId: { in: restaurantIds } },
  });

  await prisma.restaurant.deleteMany({
    where: { id: { in: restaurantIds } },
  });
}
