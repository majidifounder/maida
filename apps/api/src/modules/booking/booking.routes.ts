import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  CreateBookingSchema,
  ListBookingsQuerySchema,
  ListRestaurantBookingsQuerySchema,
} from './booking.schema.js';
import * as BookingService from './booking.service.js';
import { AppError } from '../../errors/index.js';

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply
      .code(err.statusCode)
      .send({ error: err.message, code: err.code });
  }
  throw err;
}

export async function bookingRoutes(fastify: FastifyInstance): Promise<void> {
  const dinerHooks = {
    preHandler: [fastify.authenticate, fastify.requireRole('diner')],
  };

  fastify.post('/bookings', dinerHooks, async (request, reply) => {
    const body = CreateBookingSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }
    try {
      const booking = await BookingService.createBooking(
        request.user!.sub,
        body.data,
      );
      return reply.code(201).send({ booking });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.get('/bookings', dinerHooks, async (request, reply) => {
    const query = ListBookingsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: query.error.flatten() });
    }
    try {
      return reply
        .code(200)
        .send(await BookingService.listMyBookings(request.user!.sub, query.data));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.get('/bookings/:id', dinerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply
        .code(200)
        .send(await BookingService.getMyBooking(id, request.user!.sub));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.patch('/bookings/:id/cancel', dinerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const booking = await BookingService.cancelMyBooking(
        id,
        request.user!.sub,
      );
      return reply.code(200).send({ booking });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  const ownerHooks = {
    preHandler: [fastify.authenticate, fastify.requireRole('owner')],
  };

  fastify.get(
    '/restaurants/:id/bookings',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = ListRestaurantBookingsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: query.error.flatten() });
      }
      try {
        return reply
          .code(200)
          .send(
            await BookingService.listRestaurantBookings(
              id,
              request.user!.sub,
              query.data,
            ),
          );
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/bookings/:bookingId/confirm',
    ownerHooks,
    async (request, reply) => {
      const { id, bookingId } = request.params as {
        id: string;
        bookingId: string;
      };
      try {
        const booking = await BookingService.confirmBooking(
          id,
          bookingId,
          request.user!.sub,
        );
        return reply.code(200).send({ booking });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/bookings/:bookingId/cancel',
    ownerHooks,
    async (request, reply) => {
      const { id, bookingId } = request.params as {
        id: string;
        bookingId: string;
      };
      try {
        const booking = await BookingService.cancelBookingByOwner(
          id,
          bookingId,
          request.user!.sub,
        );
        return reply.code(200).send({ booking });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  await Promise.resolve();
}
