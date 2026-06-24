import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  CreateRestaurantSchema,
  UpdateRestaurantSchema,
  SearchRestaurantsSchema,
  GetSlotsQuerySchema,
  CreateSlotsSchema,
  UpdateSlotSchema,
} from './restaurant.schema.js';
import * as RestaurantService from './restaurant.service.js';
import { AppError } from '../../errors/index.js';

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply
      .code(err.statusCode)
      .send({ error: err.message, code: err.code });
  }
  throw err;
}

export async function restaurantRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/restaurants', async (request, reply) => {
    const query = SearchRestaurantsSchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: query.error.flatten() });
    }
    try {
      return reply
        .code(200)
        .send(await RestaurantService.searchRestaurants(query.data));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.get(
    '/restaurants/mine',
    { preHandler: [fastify.authenticate, fastify.requireRole('owner')] },
    async (request, reply) => {
      try {
        const restaurants = await RestaurantService.getMyRestaurants(
          request.user!.sub,
        );
        return reply.code(200).send({ restaurants });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  fastify.get('/restaurants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.code(200).send(await RestaurantService.getRestaurant(id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.get('/restaurants/:id/slots', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = GetSlotsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: query.error.flatten() });
    }
    try {
      const slots = await RestaurantService.getAvailableSlots(
        id,
        query.data.date,
      );
      return reply.code(200).send({ slots });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  const ownerHooks = {
    preHandler: [fastify.authenticate, fastify.requireRole('owner')],
  };

  fastify.post('/restaurants', ownerHooks, async (request, reply) => {
    const body = CreateRestaurantSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }
    try {
      const restaurant = await RestaurantService.createRestaurant(
        request.user!.sub,
        body.data,
      );
      return reply.code(201).send({ restaurant });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.patch('/restaurants/:id', ownerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateRestaurantSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }
    try {
      const restaurant = await RestaurantService.updateRestaurant(
        id,
        request.user!.sub,
        body.data,
      );
      return reply.code(200).send({ restaurant });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.delete('/restaurants/:id', ownerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await RestaurantService.deleteRestaurant(id, request.user!.sub);
      return reply.code(204).send();
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.post('/restaurants/:id/slots', ownerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = CreateSlotsSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }
    try {
      const slots = await RestaurantService.createSlots(
        id,
        request.user!.sub,
        body.data,
      );
      return reply.code(201).send({ slots });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.patch(
    '/restaurants/:id/slots/:slotId',
    ownerHooks,
    async (request, reply) => {
      const { id, slotId } = request.params as { id: string; slotId: string };
      const body = UpdateSlotSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const slot = await RestaurantService.updateSlot(
          id,
          slotId,
          request.user!.sub,
          body.data,
        );
        return reply.code(200).send({ slot });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  fastify.delete(
    '/restaurants/:id/slots/:slotId',
    ownerHooks,
    async (request, reply) => {
      const { id, slotId } = request.params as { id: string; slotId: string };
      try {
        await RestaurantService.deleteSlot(id, slotId, request.user!.sub);
        return reply.code(204).send();
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  await Promise.resolve();
}
