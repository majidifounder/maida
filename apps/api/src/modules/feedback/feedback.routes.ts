import type { FastifyInstance } from 'fastify';
import { getRealIp } from '../../lib/cloudflare.js';
import { handleRouteError } from '../../lib/handle-route-error.js';
import { SubmitFeedbackSchema } from './feedback.schema.js';
import { submitProductFeedback } from './feedback.service.js';

export async function feedbackRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/feedback',
    {
      preHandler: [fastify.authenticate],
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
          keyGenerator: (req) => `feedback:${getRealIp(req)}:${req.user?.sub ?? 'anon'}`,
          errorResponseBuilder: () => ({
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'You can submit up to 5 feedback messages per hour.',
            retryAfter: 3600,
          }),
        },
      },
    },
    async (request, reply) => {
      const role = request.user!.role;
      if (role !== 'diner' && role !== 'owner') {
        return reply.code(403).send({ error: 'Only diners and owners can submit feedback.' });
      }

      const body = SubmitFeedbackSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(422)
          .send({ error: 'Validation failed', details: body.error.flatten() });
      }

      try {
        const result = await submitProductFeedback(
          request.user!.sub,
          role.toUpperCase() as 'DINER' | 'OWNER',
          body.data,
        );
        return reply.code(201).send({ feedback: result, message: 'Thank you for your feedback.' });
      } catch (err) {
        return handleRouteError(err, reply);
      }
    },
  );

  await Promise.resolve();
}
