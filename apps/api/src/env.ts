import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  CORS_ORIGIN: z
    .string()
    .default(
      'http://localhost:5173,http://localhost:5174,http://localhost:5175',
    ),
  QUEUE_NAME: z.string().default('booking_events'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  EMAIL_FROM: z
    .string()
    .email()
    .default('reservations@restaurant-booking.app'),
  CLOUDFLARE_TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  CF_ORIGIN_SECRET: z.string().min(1).optional(),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  DASHBOARD_URL: z.string().url().default('http://localhost:5174'),
  LEMON_SQUEEZY_WEBHOOK_SECRET: z.string().min(1),
  LEMON_SQUEEZY_API_KEY: z.string().min(1),
  LEMON_SQUEEZY_STORE_ID: z.string().min(1),
  LS_VARIANT_STARTER: z.string().min(1),
  LS_VARIANT_PRO: z.string().min(1),
  LS_VARIANT_PREMIUM: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME: z.string().min(1).optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
  // Run the BullMQ notification worker inside the API process. Set to 'false' in
  // production to run it as a separate process (pnpm --filter @restaurant/api worker),
  // so an email backlog or worker crash cannot take the API down and vice versa.
  RUN_WORKER_IN_PROCESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Optional webhook (e.g. Slack Incoming Webhook) that critical alerts POST to.
  // When unset, alerts are logged at error level only.
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  // Audit log retention. Rows older than this are pruned by the maintenance
  // worker. Minimum 30 days — the audit trail is a compliance surface.
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console -- bootstrap validation before logger is available
  console.error(
    '❌ Invalid environment variables:\n',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );
  process.exit(1);
}

export const env = parsed.data;

env.JWT_PRIVATE_KEY = env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
env.JWT_PUBLIC_KEY = env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
