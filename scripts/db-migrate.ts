#!/usr/bin/env tsx
/**
 * Applies Prisma migrations, then regenerates the client.
 *
 * On Windows, `prisma generate` can fail with EPERM when another Node process
 * (dev server, vitest) holds the query engine DLL. Migrations must still run
 * first — the old script order (generate && deploy) blocked deploy entirely.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(label: string, args: string[]): number {
  console.log(`\n▶ ${label}`);
  const result = spawnSync('pnpm', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status ?? 1;
}

const deployStatus = run(
  'Applying pending migrations (pnpm db:migrate:deploy)',
  ['db:migrate:deploy'],
);

if (deployStatus !== 0) {
  console.error('\n❌ Migration deploy failed.');
  console.error('   • Confirm DIRECT_DATABASE_URL uses the Supabase session pooler (port 5432).');
  console.error('   • Or run the SQL in packages/db/prisma/migrations/*/migration.sql via Supabase SQL Editor.\n');
  process.exit(deployStatus);
}

const generateStatus = run(
  'Regenerating Prisma client (pnpm db:generate)',
  ['db:generate'],
);

if (generateStatus !== 0) {
  console.warn('\n⚠️  prisma generate failed — migrations were applied successfully.');
  console.warn('   On Windows this is usually EPERM: stop dev servers and tests, then run:');
  console.warn('     pnpm db:generate\n');
  process.exit(0);
}

console.log('\n✅ Database migrations and Prisma client are up to date.\n');
