import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The suites load `.env.test` (throwaway TEST databases), NOT `.env`. That
// separation is what keeps `pnpm test` from ever creating/deleting rows in
// production. CI injects its env vars inline (no file), so a missing file is
// fine there.
const envTest = resolve(__dirname, '../../.env.test');
const envDefault = resolve(__dirname, '../../.env');
loadDotenv({ path: existsSync(envTest) ? envTest : envDefault });

// Hard safety gate: refuse to run against anything not explicitly a test DB.
// Production (Railway) never sets TEST_DATABASE, so the destructive suites
// cannot touch it even if prod credentials were somehow loaded.
if (process.env.TEST_DATABASE !== 'true') {
  // eslint-disable-next-line no-console -- bootstrap guard before any test loads
  console.error(
    '\n❌ Refusing to run tests: TEST_DATABASE is not "true".\n' +
      '   The suites CREATE and DELETE data, so they must point at a throwaway\n' +
      '   test database — never production.\n\n' +
      '   Fix: cp .env.test.example .env.test   (it sets TEST_DATABASE=true and\n' +
      '   points at the local Docker containers), then:\n' +
      '     pnpm db:up             # start Docker postgres + redis\n' +
      '     pnpm db:migrate:test   # apply the schema to the local test db\n' +
      '   See LAUNCH_CHECKLIST_V2.md → 2.1 "The test/production wall".\n',
  );
  process.exit(1);
}

process.env.RESEND_API_KEY ??= 're_test_placeholder';
// Tests publish real BullMQ jobs — isolate them on their own queue so they can
// never pollute the queue a dev/staging worker drains on the same Redis.
process.env.QUEUE_NAME = 'booking_events_test';
process.env.EMAIL_FROM ??= 'reservations@restaurant-booking.app';
process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = 'test_secret';
process.env.LEMON_SQUEEZY_API_KEY = 'test_key';
process.env.LEMON_SQUEEZY_STORE_ID = '1';
process.env.LS_VARIANT_STARTER = '100';
process.env.LS_VARIANT_PRO = '200';
process.env.LS_VARIANT_PREMIUM = '300';

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
