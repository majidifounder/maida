import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// E2E loads `.env.test` (throwaway TEST databases), NOT `.env`, so it can never
// create/delete rows in production. CI injects env vars inline (no file).
const envTest = resolve(__dirname, '../../.env.test');
const envDefault = resolve(__dirname, '../../.env');
config({ path: existsSync(envTest) ? envTest : envDefault });

// Hard safety gate — production (Railway) never sets TEST_DATABASE.
if (process.env.TEST_DATABASE !== 'true') {
  console.error(
    '\n❌ Refusing to run e2e: TEST_DATABASE is not "true".\n' +
      '   The e2e suite creates AND deletes real rows, so it must point at a\n' +
      '   throwaway test database — never production.\n\n' +
      '   Fix: cp .env.test.example .env.test   (it sets TEST_DATABASE=true and\n' +
      '   points at the local Docker containers), then:\n' +
      '     pnpm db:up                            # start Docker postgres + redis\n' +
      '     pnpm db:migrate:test                  # apply the schema\n' +
      '     pnpm --filter @restaurant/api dev:test  # API on the SAME test env\n' +
      '   See LAUNCH_CHECKLIST_V2.md → 2.1 "The test/production wall".\n',
  );
  process.exit(1);
}
