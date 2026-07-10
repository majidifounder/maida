import type { FastifyInstance } from 'fastify';
import {
  CancelReservationSchema,
  CreateReservationSchema,
  ExtendReservationSchema,
  ListReservationsQuerySchema,
  ListRestaurantReservationsQuerySchema,
  OverrideReservationSchema,
  StaffCreateReservationSchema,
  WalkInSchema,
} from './reservation.schema.js';
import * as ReservationService from './reservation.service.js';
import { handleRouteError } from '../../lib/handle-route-error.js';
import { getRealIp } from '../../lib/cloudflare.js';

export async function reservationRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const dinerHooks = {
    preHandler: [fastify.authenticate, fastify.requireRole('diner')],
  };

  fastify.post(
    '/reservations',
    {
      ...dinerHooks,
      config: {
        rateLimit: {
          max: 12,
          timeWindow: '1 minute',
          keyGenerator: (req) =>
            `reservation-create:${getRealIp(req)}:${req.user?.sub ?? 'anon'}`,
          errorResponseBuilder: () => ({
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'Too many booking attempts. Please wait a moment and try again.',
            retryAfter: 60,
          }),
        },
      },
    },
    async (request, reply) => {
    const body = CreateReservationSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }
    try {
      const reservation = await ReservationService.createReservation(
        request.user!.sub,
        body.data,
      );
      return reply.code(201).send({ reservation });
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });

  fastify.get('/reservations', dinerHooks, async (request, reply) => {
    const query = ListReservationsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: query.error.flatten() });
    }
    try {
      return reply
        .code(200)
        .send(
          await ReservationService.listMyReservations(
            request.user!.sub,
            query.data,
          ),
        );
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });

  fastify.get('/reservations/:id', dinerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply
        .code(200)
        .send(
          await ReservationService.getMyReservation(id, request.user!.sub),
        );
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });

  fastify.patch(
    '/reservations/:id/cancel',
    dinerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = CancelReservationSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const reservation = await ReservationService.cancelMyReservation(
          id,
          request.user!.sub,
          body.data.reason,
        );
        return reply.code(200).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  const ownerHooks = {
    preHandler: [fastify.authenticate, fastify.requireRole('owner')],
  };

  fastify.get(
    '/restaurants/:id/reservations',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = ListRestaurantReservationsQuerySchema.safeParse(
        request.query,
      );
      if (!query.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: query.error.flatten() });
      }
      try {
        return reply
          .code(200)
          .send(
            await ReservationService.listRestaurantReservations(
              id,
              request.user!.sub,
              query.data,
            ),
          );
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/reservations/:reservationId/seat',
    ownerHooks,
    async (request, reply) => {
      const { id, reservationId } = request.params as {
        id: string;
        reservationId: string;
      };
      try {
        const reservation = await ReservationService.seatReservation(
          id,
          reservationId,
          request.user!.sub,
        );
        return reply.code(200).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/reservations/:reservationId/cancel',
    ownerHooks,
    async (request, reply) => {
      const { id, reservationId } = request.params as {
        id: string;
        reservationId: string;
      };
      const body = CancelReservationSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const reservation = await ReservationService.cancelReservationByOwner(
          id,
          reservationId,
          request.user!.sub,
          body.data.reason,
        );
        return reply.code(200).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/reservations/:reservationId/no-show',
    ownerHooks,
    async (request, reply) => {
      const { id, reservationId } = request.params as {
        id: string;
        reservationId: string;
      };
      try {
        const reservation = await ReservationService.markNoShow(
          id,
          reservationId,
          request.user!.sub,
        );
        return reply.code(200).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/reservations/:reservationId/extend',
    ownerHooks,
    async (request, reply) => {
      const { id, reservationId } = request.params as {
        id: string;
        reservationId: string;
      };
      const body = ExtendReservationSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const reservation = await ReservationService.extendReservation(
          id,
          reservationId,
          request.user!.sub,
          body.data,
        );
        return reply.code(200).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/reservations/:reservationId/free-early',
    ownerHooks,
    async (request, reply) => {
      const { id, reservationId } = request.params as {
        id: string;
        reservationId: string;
      };
      try {
        const reservation = await ReservationService.freeTableEarly(
          id,
          reservationId,
          request.user!.sub,
        );
        return reply.code(200).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.post(
    '/restaurants/:id/reservations/walk-in',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = WalkInSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const reservation = await ReservationService.createWalkIn(
          id,
          request.user!.sub,
          body.data,
        );
        return reply.code(201).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.post(
    '/restaurants/:id/reservations/staff',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = StaffCreateReservationSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const reservation = await ReservationService.createStaffReservation(
          id,
          request.user!.sub,
          body.data,
        );
        return reply.code(201).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.post(
    '/restaurants/:id/reservations/override',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = OverrideReservationSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const reservation = await ReservationService.createOverrideReservation(
          id,
          request.user!.sub,
          body.data,
        );
        return reply.code(201).send({ reservation });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  await Promise.resolve();
}
