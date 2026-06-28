import type { FastifyInstance } from 'fastify';

import {

  AdminLoginSchema,

  AdminUpdatePlanSchema,

  AdminPaginationSchema,

} from './admin.schema.js';

import * as AdminService from './admin.service.js';

import { getRealIp } from '../../lib/cloudflare.js';

import { handleRouteError } from '../../lib/handle-route-error.js';

import {

  REFRESH_COOKIE_NAME,

  REFRESH_COOKIE_OPTIONS,

} from '../../lib/cookies.js';



export async function adminRoutes(fastify: FastifyInstance) {

  fastify.post(

    '/admin/auth/login',

    {

      config: {

        rateLimit: {

          max: 5,

          timeWindow: '15 minutes',

          keyGenerator: (req) => `admin-login:${getRealIp(req)}`,

          errorResponseBuilder: () => ({

            statusCode: 429,

            error: 'Too Many Requests',

            message: 'Too many admin login attempts. Try again in 15 minutes.',

            retryAfter: 900,

          }),

        },

      },

    },

    async (request, reply) => {

      const body = AdminLoginSchema.safeParse(request.body);

      if (!body.success) {

        return reply

          .code(422)

          .send({ error: 'Validation failed', details: body.error.flatten() });

      }

      try {

        const result = await AdminService.adminLogin(body.data, {

          ip: getRealIp(request),

        });



        if ('requiresTOTPSetup' in result || 'requiresTOTP' in result) {

          return reply.code(200).send(result);

        }



        reply.setCookie(

          REFRESH_COOKIE_NAME,

          result.refreshToken,

          REFRESH_COOKIE_OPTIONS,

        );

        // Omit refreshToken from body — HttpOnly cookie is the sole delivery mechanism.
        const { refreshToken: _rt, refreshTokenExpiresAt: _rte, ...safeResult } = result;

        return reply.code(200).send(safeResult);

      } catch (err) {

        return handleRouteError(err, reply);

      }

    },

  );



  fastify.post('/admin/auth/totp/setup', async (request, reply) => {

    const body = AdminLoginSchema.safeParse(request.body);

    if (!body.success || !body.data.pendingToken || !body.data.totpToken) {

      return reply

        .code(422)

        .send({ error: 'pendingToken and totpToken are required' });

    }

    try {

      const result = await AdminService.adminTotpSetup(

        {

          pendingToken: body.data.pendingToken,

          totpToken: body.data.totpToken,

        },

        { ip: getRealIp(request) },

      );



      reply.setCookie(

        REFRESH_COOKIE_NAME,

        result.refreshToken,

        REFRESH_COOKIE_OPTIONS,

      );

      // Omit refreshToken from body — HttpOnly cookie is the sole delivery mechanism.
      const { refreshToken: _rt, refreshTokenExpiresAt: _rte, ...safeResult } = result;

      return reply.code(200).send(safeResult);

    } catch (err) {

      return handleRouteError(err, reply);

    }

  });



  const adminHooks = {

    preHandler: [fastify.authenticate, fastify.requireRole('admin')],

  };



  fastify.get('/admin/stats', adminHooks, async (_req, reply) => {

    return reply.send(await AdminService.getStats());

  });



  fastify.get('/admin/users', adminHooks, async (request, reply) => {

    const query = AdminPaginationSchema.safeParse(request.query);

    if (!query.success) {

      return reply.code(422).send({ error: 'Validation failed' });

    }

    return reply.send(await AdminService.listUsers(query.data));

  });



  fastify.get('/admin/users/:id', adminHooks, async (request, reply) => {

    const { id } = request.params as { id: string };

    try {

      return reply.send(await AdminService.getUser(id));

    } catch (err) {

      return handleRouteError(err, reply);

    }

  });



  fastify.patch('/admin/users/:id/ban', adminHooks, async (request, reply) => {

    const { id } = request.params as { id: string };

    try {

      await AdminService.banUser(id, request.user!.sub);

      return reply.code(200).send({ message: 'User banned' });

    } catch (err) {

      return handleRouteError(err, reply);

    }

  });



  fastify.patch(

    '/admin/users/:id/unban',

    adminHooks,

    async (request, reply) => {

      const { id } = request.params as { id: string };

      try {

        await AdminService.unbanUser(id, request.user!.sub);

        return reply.code(200).send({ message: 'User unbanned' });

      } catch (err) {

        return handleRouteError(err, reply);

      }

    },

  );



  fastify.patch(

    '/admin/users/:id/plan',

    adminHooks,

    async (request, reply) => {

      const { id } = request.params as { id: string };

      const body = AdminUpdatePlanSchema.safeParse(request.body);

      if (!body.success) {

        return reply.code(422).send({ error: 'Validation failed' });

      }

      try {

        await AdminService.updateUserPlan(id, body.data, request.user!.sub);

        return reply

          .code(200)

          .send({ message: `Plan updated to ${body.data.plan}` });

      } catch (err) {

        return handleRouteError(err, reply);

      }

    },

  );



  fastify.get('/admin/restaurants', adminHooks, async (request, reply) => {

    const query = AdminPaginationSchema.safeParse(request.query);

    if (!query.success) {

      return reply.code(422).send({ error: 'Validation failed' });

    }

    return reply.send(await AdminService.listRestaurants(query.data));

  });



  fastify.get('/admin/bookings', adminHooks, async (request, reply) => {

    const query = AdminPaginationSchema.safeParse(request.query);

    if (!query.success) {

      return reply.code(422).send({ error: 'Validation failed' });

    }

    return reply.send(await AdminService.listBookings(query.data));

  });



  fastify.get('/admin/subscriptions', adminHooks, async (request, reply) => {

    const query = AdminPaginationSchema.safeParse(request.query);

    if (!query.success) {

      return reply.code(422).send({ error: 'Validation failed' });

    }

    return reply.send(await AdminService.listSubscriptions(query.data));

  });



  fastify.get('/admin/audit-logs', adminHooks, async (request, reply) => {

    const query = AdminPaginationSchema.safeParse(request.query);

    if (!query.success) {

      return reply.code(422).send({ error: 'Validation failed' });

    }

    return reply.send(await AdminService.listAuditLogs(query.data));

  });

}


