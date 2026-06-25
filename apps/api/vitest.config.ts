import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: resolve(__dirname, '../../.env') });

process.env.RESEND_API_KEY ??= 're_test_placeholder';
process.env.EMAIL_FROM ??= 'reservations@restaurant-booking.app';

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
