import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AdminLoginSchema,
  AdminUpdatePlanSchema,
  AdminPaginationSchema,
} from './admin.schema.js';
import * as AdminService from './admin.service.js';
import { AppError } from '../../errors/index.js';

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply
      .code(err.statusCode)
      .send({ error: err.message, code: err.code });
  }
  throw err;
}

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.post('/admin/auth/login', async (request, reply) => {
    const body = AdminLoginSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }
    try {
      const result = await AdminService.adminLogin(body.data, {
        ip: request.ip,
      });

      if ('requiresTOTPSetup' in result || 'requiresTOTP' in result) {
        return reply.code(200).send(result);
      }

      reply.setCookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.code(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

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
        { ip: request.ip },
      );

      reply.setCookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.code(200).send(result);
    } catch (err) {
      return handleError(err, reply);
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
      return handleError(err, reply);
    }
  });

  fastify.patch('/admin/users/:id/ban', adminHooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await AdminService.banUser(id, request.user!.sub);
      return reply.code(200).send({ message: 'User banned' });
    } catch (err) {
      return handleError(err, reply);
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
        return handleError(err, reply);
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
        return handleError(err, reply);
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
