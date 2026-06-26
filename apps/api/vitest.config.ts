import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: resolve(__dirname, '../../.env') });

process.env.RESEND_API_KEY ??= 're_test_placeholder';
process.env.EMAIL_FROM ??= 'reservations@restaurant-booking.app';

// Cloudflare secrets must be absent in tests
delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
delete process.env.CF_ORIGIN_SECRET;

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    sequence: { concurrent: false },
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/auth/**', 'src/plugins/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
