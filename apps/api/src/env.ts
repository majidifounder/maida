import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174'),
  QUEUE_NAME: z.string().default('booking_events'),
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
