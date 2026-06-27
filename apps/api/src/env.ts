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
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    '❌ Invalid environment variables:\n',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );
  process.exit(1);
}

export const env = parsed.data;

env.JWT_PRIVATE_KEY = env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
env.JWT_PUBLIC_KEY = env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
