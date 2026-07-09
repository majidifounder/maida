import type { FastifyInstance } from 'fastify';
import {
  CreateCombinationSchema,
  CreateRestaurantSchema,
  CreateTableSchema,
  CreateTurnTimeRuleSchema,
  GetAvailabilityQuerySchema,
  SearchRestaurantsSchema,
  UpdateCombinationSchema,
  UpdateReservationConfigSchema,
  UpdateRestaurantSchema,
  UpdateTableSchema,
} from './restaurant.schema.js';
import * as RestaurantService from './restaurant.service.js';
import { assertOwnerRestaurantPlanLimit } from '../subscription/subscription.service.js';
import { handleRouteError } from '../../lib/handle-route-error.js';
import { getRealIp } from '../../lib/cloudflare.js';

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
      return handleRouteError(err, reply);
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
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.get('/restaurants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.code(200).send(await RestaurantService.getRestaurant(id));
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });

  fastify.get('/restaurants/:id/availability', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = GetAvailabilityQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: query.error.flatten() });
    }
    try {
      const availability = await RestaurantService.getAvailability(
        id,
        query.data.date,
        query.data.partySize,
      );
      return reply.code(200).send(availability);
    } catch (err) {
      return handleRouteError(err, reply);
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
      const { plan, atLimit, limit } = await assertOwnerRestaurantPlanLimit(
        request.user!.sub,
      );
      if (atLimit) {
        return reply.code(403).send({
          error: 'Plan limit reached',
          message: `You've reached your ${plan} plan limit of ${limit === Infinity ? 'unlimited' : limit} restaurant(s). Upgrade on Billing to add more.`,
          upgrade: '/subscriptions/checkout',
        });
      }

      const restaurant = await RestaurantService.createRestaurant(
        request.user!.sub,
        body.data,
      );
      return reply.code(201).send({ restaurant });
    } catch (err) {
      return handleRouteError(err, reply);
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
      return handleRouteError(err, reply);
    }
  });

  fastify.post(
    '/restaurants/:id/logo',
    {
      ...ownerHooks,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
          keyGenerator: (req) =>
            `logo-upload:${getRealIp(req)}:${req.user?.sub ?? 'anon'}`,
          errorResponseBuilder: () => ({
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'Too many logo uploads. Try again in an hour.',
            retryAfter: 3600,
          }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const file = await request.file();
        if (!file) {
          return reply.code(422).send({ error: 'No file uploaded. Send multipart field "logo".' });
        }
        if (file.fieldname !== 'logo') {
          await file.toBuffer().catch(() => undefined);
          return reply.code(422).send({ error: 'Upload field must be named "logo".' });
        }
        const buffer = await file.toBuffer();
        const result = await RestaurantService.setRestaurantLogo(
          id,
          request.user!.sub,
          buffer,
        );
        return reply.code(200).send(result);
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/reservation-config',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = UpdateReservationConfigSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const config = await RestaurantService.updateReservationConfig(
          id,
          request.user!.sub,
          body.data,
        );
        return reply.code(200).send({ config });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.get(
    '/restaurants/:id/config',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const config = await RestaurantService.getRestaurantConfig(
          id,
          request.user!.sub,
        );
        return reply.code(200).send({ config });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.delete('/restaurants/:id', ownerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await RestaurantService.deleteRestaurant(id, request.user!.sub);
      return reply.code(204).send();
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });

  // ── Tables ──────────────────────────────────────────────────────────────────

  fastify.get('/restaurants/:id/tables', ownerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const tables = await RestaurantService.listTables(id, request.user!.sub);
      return reply.code(200).send({ tables });
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });

  fastify.post('/restaurants/:id/tables', ownerHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = CreateTableSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }
    try {
      const table = await RestaurantService.createTable(
        id,
        request.user!.sub,
        body.data,
      );
      return reply.code(201).send({ table });
    } catch (err) {
      return handleRouteError(err, reply);
    }
  });

  fastify.patch(
    '/restaurants/:id/tables/:tableId',
    ownerHooks,
    async (request, reply) => {
      const { id, tableId } = request.params as { id: string; tableId: string };
      const body = UpdateTableSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const table = await RestaurantService.updateTable(
          id,
          tableId,
          request.user!.sub,
          body.data,
        );
        return reply.code(200).send({ table });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.delete(
    '/restaurants/:id/tables/:tableId',
    ownerHooks,
    async (request, reply) => {
      const { id, tableId } = request.params as { id: string; tableId: string };
      try {
        await RestaurantService.deleteTable(id, tableId, request.user!.sub);
        return reply.code(204).send();
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  // ── Combinations ────────────────────────────────────────────────────────────

  fastify.get(
    '/restaurants/:id/combinations',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const combinations = await RestaurantService.listCombinations(
          id,
          request.user!.sub,
        );
        return reply.code(200).send({ combinations });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.post(
    '/restaurants/:id/combinations',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = CreateCombinationSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const combination = await RestaurantService.createCombination(
          id,
          request.user!.sub,
          body.data,
        );
        return reply.code(201).send({ combination });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.patch(
    '/restaurants/:id/combinations/:combinationId',
    ownerHooks,
    async (request, reply) => {
      const { id, combinationId } = request.params as {
        id: string;
        combinationId: string;
      };
      const body = UpdateCombinationSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const combination = await RestaurantService.updateCombination(
          id,
          combinationId,
          request.user!.sub,
          body.data,
        );
        return reply.code(200).send({ combination });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.delete(
    '/restaurants/:id/combinations/:combinationId',
    ownerHooks,
    async (request, reply) => {
      const { id, combinationId } = request.params as {
        id: string;
        combinationId: string;
      };
      try {
        await RestaurantService.deleteCombination(
          id,
          combinationId,
          request.user!.sub,
        );
        return reply.code(204).send();
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  // ── Turn-time rules ─────────────────────────────────────────────────────────

  fastify.get(
    '/restaurants/:id/turn-time-rules',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const rules = await RestaurantService.listTurnTimeRules(
          id,
          request.user!.sub,
        );
        return reply.code(200).send({ rules });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.post(
    '/restaurants/:id/turn-time-rules',
    ownerHooks,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = CreateTurnTimeRuleSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }
      try {
        const rule = await RestaurantService.createTurnTimeRule(
          id,
          request.user!.sub,
          body.data,
        );
        return reply.code(201).send({ rule });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  fastify.delete(
    '/restaurants/:id/turn-time-rules/:ruleId',
    ownerHooks,
    async (request, reply) => {
      const { id, ruleId } = request.params as { id: string; ruleId: string };
      try {
        await RestaurantService.deleteTurnTimeRule(
          id,
          ruleId,
          request.user!.sub,
        );
        return reply.code(204).send();
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  await Promise.resolve();
}
