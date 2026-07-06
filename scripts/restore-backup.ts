#!/usr/bin/env tsx
/**
 * Tablz — Database Restore
 *
 * Usage:
 *   pnpm db:restore --file=backups/backup-2026-06-28T14-30-00.json
 *
 * What happens:
 *   1. Reads and validates the backup file (checksum check)
 *   2. Shows a full summary of what will be restored
 *   3. Asks you to type "RESTORE" to confirm — can't accidentally run this
 *   4. Wipes all tables in FK-safe order
 *   5. Re-inserts all data in dependency order
 *   6. Verifies record counts match the backup
 *
 * ⚠️  This DELETES all current data. Run it only when you need to recover.
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { prisma as PrismaInstance } from '@restaurant/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BackupMeta {
  version: string;
  platform: string;
  exportedAt: string;
  counts: Record<string, number>;
  checksum: string;
  note?: string;
}

interface BackupDataV2 {
  users: Record<string, unknown>[];
  restaurants: Record<string, unknown>[];
  diningTables: Record<string, unknown>[];
  tableCombinations: Record<string, unknown>[];
  tableCombinationMembers: Record<string, unknown>[];
  turnTimeRules: Record<string, unknown>[];
  reservations: Record<string, unknown>[];
  reservationTables: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
  auditLogs: Record<string, unknown>[];
}

interface BackupFile {
  meta: BackupMeta;
  data: BackupDataV2;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(): { file: string } {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [key, ...rest] = a.slice(2).split('=');
        return [key, rest.join('=')];
      }),
  );

  if (!args['file']) {
    console.error('\n❌ Usage: pnpm db:restore --file=backups/<filename>.json\n');
    process.exit(1);
  }

  return { file: args['file'] };
}

function loadAndValidate(filePath: string): BackupFile {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    console.error(`\n❌ Cannot read file: ${filePath}`);
    console.error('   Make sure the file exists and the path is correct.\n');
    process.exit(1);
  }

  let backup: BackupFile;
  try {
    backup = JSON.parse(raw) as BackupFile;
  } catch {
    console.error('\n❌ File is not valid JSON — it may be corrupted.\n');
    process.exit(1);
  }

  if (!backup.meta || !backup.data) {
    console.error('\n❌ File does not look like a Tablz backup (missing meta or data).\n');
    process.exit(1);
  }

  if (backup.meta.platform !== 'tablz') {
    console.error('\n❌ This is not a Tablz backup file.\n');
    process.exit(1);
  }

  if (backup.meta.version === '1.0') {
    console.error('\n❌ This backup uses the retired slot/booking schema (v1.0).');
    console.error('   Export a fresh v2.0 backup after the Phase 12 migration.\n');
    process.exit(1);
  }

  const actualChecksum = createHash('sha256')
    .update(JSON.stringify(backup.data))
    .digest('hex');

  if (actualChecksum !== backup.meta.checksum) {
    console.error('\n❌ INTEGRITY CHECK FAILED');
    console.error('   The backup file has been corrupted or modified.');
    console.error(`   Expected : ${backup.meta.checksum}`);
    console.error(`   Got      : ${actualChecksum}`);
    console.error('   Do NOT restore from this file — use a different backup.\n');
    process.exit(1);
  }

  return backup;
}

// ─── Restore ──────────────────────────────────────────────────────────────────

type PrismaClient = typeof PrismaInstance;

async function wipeDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
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

async function insertInBatches<T extends Record<string, unknown>>(
  label: string,
  records: T[],
  insertFn: (batch: T[]) => Promise<unknown>,
  batchSize = 200,
): Promise<void> {
  if (records.length === 0) {
    console.log(`   ✅ ${label.padEnd(24)} 0 (nothing to restore)`);
    return;
  }

  let inserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await insertFn(batch);
    inserted += batch.length;
  }

  console.log(`   ✅ ${label.padEnd(24)} ${inserted}`);
}

async function restoreData(prisma: PrismaClient, data: BackupDataV2): Promise<void> {
  await insertInBatches('users', data.users ?? [], (batch) =>
    prisma.user.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('restaurants', data.restaurants ?? [], (batch) =>
    prisma.restaurant.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('diningTables', data.diningTables ?? [], (batch) =>
    prisma.diningTable.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('tableCombinations', data.tableCombinations ?? [], (batch) =>
    prisma.tableCombination.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('tableCombinationMembers', data.tableCombinationMembers ?? [], (batch) =>
    prisma.tableCombinationMember.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('turnTimeRules', data.turnTimeRules ?? [], (batch) =>
    prisma.turnTimeRule.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('reservations', data.reservations ?? [], (batch) =>
    prisma.reservation.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('reservationTables', data.reservationTables ?? [], (batch) =>
    prisma.reservationTable.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('subscriptions', data.subscriptions ?? [], (batch) =>
    prisma.subscription.createMany({ data: batch as never[], skipDuplicates: true }),
  );

  await insertInBatches('auditLogs', data.auditLogs ?? [], (batch) =>
    prisma.auditLog.createMany({ data: batch as never[], skipDuplicates: true }),
  );
}

async function verifyRestore(
  prisma: PrismaClient,
  expected: Record<string, number>,
): Promise<boolean> {
  const actual = {
    users: await prisma.user.count(),
    restaurants: await prisma.restaurant.count(),
    diningTables: await prisma.diningTable.count(),
    tableCombinations: await prisma.tableCombination.count(),
    tableCombinationMembers: await prisma.tableCombinationMember.count(),
    turnTimeRules: await prisma.turnTimeRule.count(),
    reservations: await prisma.reservation.count(),
    reservationTables: await prisma.reservationTable.count(),
    subscriptions: await prisma.subscription.count(),
    auditLogs: await prisma.auditLog.count(),
  };

  let allMatch = true;
  console.log('\n   Verification:');
  for (const [table, expectedCount] of Object.entries(expected)) {
    const actualCount = actual[table as keyof typeof actual] ?? 0;
    const match = actualCount === expectedCount;
    if (!match) allMatch = false;
    const icon = match ? '✅' : '❌';
    console.log(
      `   ${icon} ${table.padEnd(24)} expected ${String(expectedCount).padStart(5)} — got ${String(actualCount).padStart(5)}`,
    );
  }

  return allMatch;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { file } = parseArgs();

  console.log('\n🔄 Tablz Database Restore');
  console.log('─────────────────────────────────────');

  console.log('\n🔍 Loading and validating backup file...');
  const backup = loadAndValidate(file);
  console.log('   ✅ Integrity check passed — file is valid and unmodified');

  const exported = new Date(backup.meta.exportedAt);
  const ageHours = Math.round((Date.now() - exported.getTime()) / 1000 / 60 / 60);

  console.log('\n📋 Backup summary:');
  console.log(`   Exported   : ${exported.toLocaleString()}`);
  console.log(`   Age        : ${ageHours < 24 ? `${ageHours} hours ago` : `${Math.round(ageHours / 24)} days ago`}`);
  console.log(`   Version    : ${backup.meta.version}`);
  console.log('\n   Records that will be restored:');
  console.log('   ─────────────────────────────');
  for (const [table, count] of Object.entries(backup.meta.counts)) {
    console.log(`   ${table.padEnd(24)} ${String(count).padStart(6)}`);
  }

  if (ageHours > 48) {
    console.log(`\n⚠️  This backup is ${Math.round(ageHours / 24)} days old.`);
    console.log('   Data created after the export date will be lost.');
  }

  console.log('\n⚠️  WARNING: This will DELETE all current data in the database.');
  console.log('   All active user sessions will be cleared (users log in again).');
  console.log('   This cannot be undone.\n');

  const rl = createInterface({ input, output });

  const answer = await rl.question(
    '   Type "RESTORE" and press Enter to confirm, or anything else to cancel: ',
  );
  rl.close();

  if (answer.trim() !== 'RESTORE') {
    console.log('\n✋ Restore cancelled. No data was changed.\n');
    process.exit(0);
  }

  const { prisma } = await import('@restaurant/db');
  const startMs = Date.now();

  console.log('\n🗑️  Wiping current data...');
  await wipeDatabase(prisma);
  console.log('   ✅ All tables cleared');

  console.log('\n📥 Restoring data...');
  await restoreData(prisma, backup.data);

  console.log('\n🔎 Verifying restore...');
  const success = await verifyRestore(prisma, backup.meta.counts);

  const durationMs = Date.now() - startMs;

  await prisma.$disconnect();

  if (success) {
    console.log('\n✅ Restore complete!');
    console.log('─────────────────────────────────────');
    console.log(`   Duration   : ${durationMs}ms`);
    console.log(`   Restored from: ${backup.meta.exportedAt}`);
    console.log('\n   Next steps:');
    console.log('   • Users will need to log in again (sessions were cleared)');
    console.log('   • Redis caches rebuild automatically within minutes');
    console.log('   • Run GET /health to confirm the API is healthy\n');
  } else {
    console.error('\n❌ Restore completed but count verification FAILED.');
    console.error('   Some records may not have been restored correctly.');
    console.error('   Check the mismatched tables above and investigate.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ Restore failed:', err);
  process.exit(1);
});
