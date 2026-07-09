#!/usr/bin/env tsx
/**
 * Maida — Dev Data Reset
 *
 * Usage:
 *   pnpm db:dev-reset
 *
 * What happens:
 *   1. Validates DATABASE_URL points at a dev database (blocks prod/staging heuristics)
 *   2. Prints masked connection details and current row counts
 *   3. Requires typing "RESET DEV" to confirm
 *   4. Exports a fresh backup via `pnpm db:export` (reversible)
 *   5. Wipes all application data in FK-safe order (schema untouched)
 *   6. Verifies all tables are empty and prints admin re-setup steps
 *
 * ⚠️  Dev-only. Never run against staging or production.
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { prisma as PrismaInstance } from '@restaurant/db';
import {
  printDatabaseConnectionHint,
  useDirectDatabaseUrl,
} from './lib/script-db.js';

const CONFIRM_PHRASE = 'RESET DEV';

const BLOCKED_TARGET_PATTERNS = [
  /prod/i,
  /production/i,
  /staging/i,
];

// ─── Environment safety ───────────────────────────────────────────────────────

interface ParsedDatabaseUrl {
  host: string;
  port: string;
  database: string;
  user: string;
}

function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error('\n❌ DATABASE_URL is not a valid URL.\n');
    process.exit(1);
  }

  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, '') || 'postgres',
    user: decodeURIComponent(parsed.username),
  };
}

function maskUser(user: string): string {
  if (user.length <= 4) return '****';
  if (user.length <= 10) return `${user.slice(0, 2)}***`;
  return `${user.slice(0, 8)}***${user.slice(-2)}`;
}

function maskDatabaseTarget(url: string): string {
  const { host, port, database, user } = parseDatabaseUrl(url);
  return `${maskUser(user)}@${host}:${port}/${database}`;
}

function assertDevTarget(databaseUrl: string): ParsedDatabaseUrl {
  if (!databaseUrl.trim()) {
    console.error('\n❌ DATABASE_URL is not set. Load .env from the repo root.\n');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('\n❌ NODE_ENV is "production". This script is dev-only.\n');
    process.exit(1);
  }

  const parsed = parseDatabaseUrl(databaseUrl);
  const targetText = `${parsed.host}/${parsed.database}`;

  for (const pattern of BLOCKED_TARGET_PATTERNS) {
    if (pattern.test(parsed.host) || pattern.test(parsed.database)) {
      console.error('\n❌ Refusing to run — database target looks non-dev.');
      console.error(`   Target : ${maskDatabaseTarget(databaseUrl)}`);
      console.error(`   Matched: ${pattern.toString()} in host or database name`);
      console.error('   Point .env at your local/dev Supabase project only.\n');
      process.exit(1);
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  if (supabaseUrl) {
    try {
      const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
      if (projectRef && !parsed.user.includes(projectRef)) {
        console.log('\n⚠️  Note: SUPABASE_URL project ref does not appear in DATABASE_URL username.');
        console.log(`   SUPABASE_URL ref: ${projectRef}`);
        console.log(`   DATABASE_URL user: ${maskUser(parsed.user)}`);
        console.log('   Double-check you are on the intended dev project before confirming.\n');
      }
    } catch {
      // SUPABASE_URL optional / malformed — DATABASE_URL checks still apply
    }
  }

  return parsed;
}

// ─── Database helpers ─────────────────────────────────────────────────────────

type PrismaClient = typeof PrismaInstance;

async function assertSchemaCurrent(prisma: PrismaClient): Promise<void> {
  const [trialColumn, feedbackTable] = await Promise.all([
    prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'subscriptions'
        AND column_name = 'trialStartedAt'
    `,
    prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'product_feedback'
    `,
  ]);

  const missing: string[] = [];
  if (trialColumn.length === 0) missing.push('subscriptions.trialStartedAt');
  if (feedbackTable.length === 0) missing.push('product_feedback table');

  if (missing.length > 0) {
    console.error('\n❌ Database schema is behind the codebase.');
    console.error(`   Missing: ${missing.join(', ')}`);
    console.error('   Run: pnpm db:migrate');
    console.error('   If generate fails on Windows, stop dev servers/tests and run: pnpm db:generate\n');
    process.exit(1);
  }
}

async function getTableCounts(prisma: PrismaClient): Promise<Record<string, number>> {
  const [
    users,
    restaurants,
    diningTables,
    tableCombinations,
    tableCombinationMembers,
    turnTimeRules,
    reservations,
    reservationTables,
    subscriptions,
    productFeedback,
    auditLogs,
    refreshTokens,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.restaurant.count(),
    prisma.diningTable.count(),
    prisma.tableCombination.count(),
    prisma.tableCombinationMember.count(),
    prisma.turnTimeRule.count(),
    prisma.reservation.count(),
    prisma.reservationTable.count(),
    prisma.subscription.count(),
    prisma.productFeedback.count(),
    prisma.auditLog.count(),
    prisma.refreshToken.count(),
  ]);

  return {
    users,
    restaurants,
    diningTables,
    tableCombinations,
    tableCombinationMembers,
    turnTimeRules,
    reservations,
    reservationTables,
    subscriptions,
    productFeedback,
    auditLogs,
    refreshTokens,
  };
}

function printCounts(counts: Record<string, number>, title: string): void {
  console.log(`\n${title}`);
  console.log('   Table                     Records');
  console.log('   ─────────────────────────────────');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`   ${table.padEnd(26)} ${String(count).padStart(6)}`);
  }
}

async function wipeDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.productFeedback.deleteMany(),
    prisma.reservationTable.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.tableCombinationMember.deleteMany(),
    prisma.tableCombination.deleteMany(),
    prisma.turnTimeRule.deleteMany(),
    prisma.diningTable.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.restaurant.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

function runBackup(repoRoot: string): string {
  console.log('\n📦 Creating backup (pnpm db:export)...');

  const result = spawnSync('pnpm', ['db:export'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.error('\n❌ Backup failed — aborting reset. No data was deleted.\n');
    process.exit(1);
  }

  const backupsDir = join(repoRoot, 'backups');
  const latest = readdirSync(backupsDir)
    .filter((name) => name.startsWith('backup-') && name.endsWith('.json'))
    .map((name) => ({
      name,
      mtime: statSync(join(backupsDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)[0];

  if (!latest) {
    console.error('\n❌ Backup command succeeded but no backup file was found.\n');
    process.exit(1);
  }

  return `backups/${latest.name}`;
}

function printAdminSetupInstructions(): void {
  console.log('\n🔐 Admin access after reset');
  console.log('─────────────────────────────────────');
  console.log('\n1. Create an ADMIN user in Supabase SQL Editor');
  console.log('   (Project → SQL → New query). Example:\n');
  console.log(`   INSERT INTO users (id, email, password, role, "createdAt", "updatedAt")
   VALUES (
     gen_random_uuid(),
     'admin@example.com',
     '<bcrypt-hash>',
     'ADMIN',
     NOW(),
     NOW()
   );`);
  console.log('\n   Generate a bcrypt hash for your chosen password (cost 12):');
  console.log(
    '     pnpm exec tsx -e "import bcrypt from \'bcryptjs\'; console.log(await bcrypt.hash(\'YourPasswordHere\', 12))"',
  );
  console.log('\n   Alternative: register via the diner/owner apps, then promote:');
  console.log("     UPDATE users SET role = 'ADMIN' WHERE email = 'you@example.com';");
  console.log('\n2. Start the API and admin panel:');
  console.log('     pnpm --filter @restaurant/api dev');
  console.log('     pnpm --filter @restaurant/admin dev');
  console.log('\n3. Open http://localhost:5175 and sign in with your admin email + password.');
  console.log('   First login shows a QR code — scan it in an authenticator app,');
  console.log('   enter the 6-digit code, and TOTP setup completes.');
  console.log('\n4. Later logins use email + password + TOTP code (no QR).');
  console.log('\n💡 Optional sample data after manual testing setup: pnpm db:seed');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const repoRoot = resolve(__dirname, '..');
  const databaseUrl = useDirectDatabaseUrl();

  console.log('\n🧹 Maida Dev Data Reset');
  console.log('─────────────────────────────────────');

  assertDevTarget(databaseUrl);

  console.log('\n🎯 Target database (credentials masked):');
  console.log(`   ${maskDatabaseTarget(databaseUrl)}`);
  console.log(`   NODE_ENV : ${process.env.NODE_ENV ?? '(unset)'}`);

  const { prisma } = await import('@restaurant/db');

  await assertSchemaCurrent(prisma);

  const beforeCounts = await getTableCounts(prisma);
  printCounts(beforeCounts, '📊 Current data:');

  const totalRows = Object.values(beforeCounts).reduce((sum, n) => sum + n, 0);
  if (totalRows === 0) {
    console.log('\nℹ️  Database is already empty — nothing to wipe.');
    printAdminSetupInstructions();
    await prisma.$disconnect();
    return;
  }

  console.log('\n⚠️  WARNING: This will DELETE all application data listed above.');
  console.log('   Schema and migrations are kept. A backup runs first.');
  console.log('   Redis, env files, and Supabase project settings are not touched.\n');

  const rl = createInterface({ input, output });
  const answer = await rl.question(
    `   Type "${CONFIRM_PHRASE}" and press Enter to continue, or anything else to cancel: `,
  );
  rl.close();

  if (answer.trim() !== CONFIRM_PHRASE) {
    console.log('\n✋ Reset cancelled. No data was changed.\n');
    await prisma.$disconnect();
    process.exit(0);
  }

  const backupFile = runBackup(repoRoot);
  console.log(`\n   ✅ Backup saved: ${backupFile}`);

  const startMs = Date.now();

  console.log('\n🗑️  Wiping application data...');
  await wipeDatabase(prisma);

  const afterCounts = await getTableCounts(prisma);
  printCounts(afterCounts, '\n🔎 Post-reset counts:');

  const remaining = Object.values(afterCounts).reduce((sum, n) => sum + n, 0);
  await prisma.$disconnect();

  if (remaining !== 0) {
    console.error('\n❌ Reset incomplete — some rows remain. Check FK order or DB connectivity.');
    console.error(`   Restore from backup: pnpm db:restore --file=${backupFile}\n`);
    process.exit(1);
  }

  const durationMs = Date.now() - startMs;

  console.log('\n✅ Dev data reset complete!');
  console.log('─────────────────────────────────────');
  console.log(`   Duration : ${durationMs}ms`);
  console.log(`   Backup   : ${backupFile}`);
  console.log(`   Restore  : pnpm db:restore --file=${backupFile}`);
  printAdminSetupInstructions();
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Dev data reset failed:', err);
  printDatabaseConnectionHint(err);
  process.exit(1);
});
