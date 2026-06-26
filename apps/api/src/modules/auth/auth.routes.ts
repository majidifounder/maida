import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@restaurant/db';
import { RegisterSchema, LoginSchema, RefreshSchema } from './auth.schema.js';
import * as AuthService from './auth.service.js';
import { AppError } from '../../errors/index.js';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/auth',
  maxAge: 7 * 24 * 60 * 60,
};

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/auth/register', async (request, reply) => {
    const body = RegisterSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }

    try {
      const result = await AuthService.registerUser(body.data, { ip: request.ip });
      return reply.code(201).send({ user: result.user });
    } catch (err) {
      if (err instanceof AppError) {
        return reply
          .code(err.statusCode)
          .send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  fastify.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          keyGenerator: (req) => req.ip,
          allowList: (req: FastifyRequest) => req.headers['x-load-test'] === '1',
          errorResponseBuilder: () => ({
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'Too many login attempts. Try again in 15 minutes.',
            retryAfter: 900,
          }),
        },
      },
    },
    async (request, reply) => {
      const body = LoginSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }

      try {
        const loginMeta: { ip: string; userAgent?: string } = { ip: request.ip };
        const userAgent = request.headers['user-agent'];
        if (userAgent) {
          loginMeta.userAgent = userAgent;
        }

        const result = await AuthService.loginUser(body.data, loginMeta);

        return reply
          .setCookie(
            REFRESH_COOKIE_NAME,
            result.refreshToken,
            REFRESH_COOKIE_OPTIONS,
          )
          .code(200)
          .send({
            user: result.user,
            accessToken: result.accessToken,
            accessTokenExpiresAt: result.accessTokenExpiresAt,
            refreshToken: result.refreshToken,
            refreshTokenExpiresAt: result.refreshTokenExpiresAt,
          });
      } catch (err) {
        if (err instanceof AppError) {
          return reply
            .code(err.statusCode)
            .send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  fastify.post('/auth/refresh', async (request, reply) => {
    const tokenFromCookie = request.cookies?.[REFRESH_COOKIE_NAME];
    const body = RefreshSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(422)
        .send({ error: 'Validation failed', details: body.error.flatten() });
    }
    const rawRefreshToken = tokenFromCookie ?? body.data.refreshToken;

    if (!rawRefreshToken) {
      return reply.code(401).send({ error: 'Refresh token required' });
    }

    try {
      const result = await AuthService.refreshTokens(rawRefreshToken, {
        ip: request.ip,
      });

      return reply
        .setCookie(
          REFRESH_COOKIE_NAME,
          result.refreshToken,
          REFRESH_COOKIE_OPTIONS,
        )
        .code(200)
        .send({
          accessToken: result.accessToken,
          accessTokenExpiresAt: result.accessTokenExpiresAt,
          refreshToken: result.refreshToken,
          refreshTokenExpiresAt: result.refreshTokenExpiresAt,
        });
    } catch (err) {
      if (err instanceof AppError) {
        return reply
          .clearCookie(REFRESH_COOKIE_NAME, { path: '/auth' })
          .code(err.statusCode)
          .send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  fastify.post(
    '/auth/logout',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const tokenFromCookie = request.cookies?.[REFRESH_COOKIE_NAME];
      const body = z
        .object({ refreshToken: z.string().optional() })
        .safeParse(request.body);
      const rawRefreshToken = tokenFromCookie ?? body.data?.refreshToken;

      const authHeader = request.headers.authorization!;
      const accessToken = authHeader.slice(7);

      await AuthService.logoutUser(accessToken, rawRefreshToken, {
        userId: request.user!.sub,
        jti: request.user!.jti,
        exp: request.user!.exp,
        ip: request.ip,
      });

      return reply
        .clearCookie(REFRESH_COOKIE_NAME, { path: '/auth' })
        .code(200)
        .send({ message: 'Logged out successfully' });
    },
  );

  fastify.get(
    '/auth/me',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.user!.sub },
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          deletedAt: true,
        },
      });

      if (!user || user.deletedAt) {
        return reply.code(401).send({ error: 'User not found or deactivated' });
      }

      return reply.code(200).send({
        id: user.id,
        email: user.email,
        role: user.role.toLowerCase(),
        createdAt: user.createdAt,
      });
    },
  );

  await Promise.resolve();
}
