import { prisma } from '@restaurant/db';
import type { FastifyInstance } from 'fastify';

export interface TestBooking {
  id: string;
  restaurantId: string;
  slotId: string;
  partySize: number;
  status: string;
}

/**
 * Create a booking via the API as the given diner token.
 * Throws if the request does not return 201.
 */
export async function createTestBooking(
  server: FastifyInstance,
  dinerToken: string,
  payload: { restaurantId: string; slotId: string; partySize: number },
): Promise<TestBooking> {
  const res = await server.inject({
    method: 'POST',
    url: '/bookings',
    headers: { authorization: `Bearer ${dinerToken}` },
    payload,
  });

  if (res.statusCode !== 201) {
    throw new Error(`createTestBooking failed: ${res.statusCode} ${res.body}`);
  }

  const body = JSON.parse(res.body) as { booking: TestBooking };
  return body.booking;
}

/**
 * Hard-delete bookings by ID.
 * Must be called BEFORE cleanupTestRestaurants (FK: booking → slot/restaurant).
 */
export async function cleanupTestBookings(bookingIds: string[]): Promise<void> {
  if (bookingIds.length === 0) return;
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
}
