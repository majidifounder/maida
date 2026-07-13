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
      '   Fix: copy .env.test.example → .env.test with your TEST Supabase +\n' +
      '   Upstash credentials (it sets TEST_DATABASE=true), and make sure the\n' +
      '   API server under test uses the same test databases.\n' +
      '   See LAUNCH_CHECKLIST.md → "Test vs Production environments".\n',
  );
  process.exit(1);
}
