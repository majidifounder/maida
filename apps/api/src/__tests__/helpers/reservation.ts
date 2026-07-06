import { prisma } from '@restaurant/db';
import type { FastifyInstance } from 'fastify';

export interface TestReservation {
  id: string;
  restaurantId: string;
  partySize: number;
  status: string;
  startsAt: string;
}

export async function createTestReservation(
  server: FastifyInstance,
  dinerToken: string,
  payload: { restaurantId: string; startsAt: string; partySize: number },
): Promise<TestReservation> {
  const res = await server.inject({
    method: 'POST',
    url: '/reservations',
    headers: { authorization: `Bearer ${dinerToken}` },
    payload: {
      ...payload,
      reservationType: 'STANDARD',
    },
  });

  if (res.statusCode !== 201) {
    throw new Error(
      `createTestReservation failed: ${res.statusCode} ${res.body}`,
    );
  }

  const body = JSON.parse(res.body) as { reservation: TestReservation };
  return body.reservation;
}

export async function cleanupTestReservations(
  reservationIds: string[],
): Promise<void> {
  if (reservationIds.length === 0) return;
  await prisma.reservation.deleteMany({
    where: { id: { in: reservationIds } },
  });
}
