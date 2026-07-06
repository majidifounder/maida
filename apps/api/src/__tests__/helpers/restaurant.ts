import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@restaurant/db';
import { verifyAccessToken } from '../../lib/jwt.js';

export function futureDate(daysFromNow = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

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

export async function createTestRestaurant(
  server: FastifyInstance,
  ownerToken: string,
  overrides: Record<string, unknown> = {},
): Promise<TestRestaurant> {
  const { sub: ownerId } = verifyAccessToken(ownerToken);
  await prisma.subscription.upsert({
    where: { userId: ownerId },
    create: { userId: ownerId, plan: 'PREMIUM', status: 'ACTIVE' },
    update: { plan: 'PREMIUM', status: 'ACTIVE' },
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

export interface TestTable {
  id: string;
  name: string;
  maxPartySize: number;
}

export async function createTestTables(
  server: FastifyInstance,
  restaurantId: string,
  ownerToken: string,
  tables: Array<{ name: string; minPartySize?: number; maxPartySize: number }>,
): Promise<TestTable[]> {
  const created: TestTable[] = [];
  for (const t of tables) {
    const res = await server.inject({
      method: 'POST',
      url: `/restaurants/${restaurantId}/tables`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: t.name,
        minPartySize: t.minPartySize ?? 1,
        maxPartySize: t.maxPartySize,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`createTestTables failed: ${res.statusCode} ${res.body}`);
    }
    const body = JSON.parse(res.body) as { table: TestTable };
    created.push(body.table);
  }
  return created;
}

export async function cleanupTestRestaurants(
  restaurantIds: string[],
): Promise<void> {
  if (restaurantIds.length === 0) return;

  await prisma.reservation.deleteMany({
    where: { restaurantId: { in: restaurantIds } },
  });

  await prisma.diningTable.deleteMany({
    where: { restaurantId: { in: restaurantIds } },
  });

  await prisma.restaurant.deleteMany({
    where: { id: { in: restaurantIds } },
  });
}
