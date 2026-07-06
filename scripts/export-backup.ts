#!/usr/bin/env tsx
/**
 * Tablz — Database Export
 *
 * Usage:
 *   pnpm db:export
 *
 * Output:
 *   backups/backup-2026-06-28T14-30-00.json
 *
 * What is exported:
 *   ✅ users (including hashed passwords — needed for full restore)
 *   ✅ restaurants
 *   ✅ dining_tables, table_combinations, table_combination_members
 *   ✅ turn_time_rules, reservations, reservation_tables
 *   ✅ subscriptions
 *   ✅ audit_logs (last 90 days — keeps file size manageable)
 *   ⛔ refresh_tokens (ephemeral — users just log in again after restore)
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function timestampedFilename(): string {
  // Colons replaced with dashes so it's a valid filename on all OS (Windows included)
  const now = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  return `backup-${now}.json`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { prisma } = await import('@restaurant/db');

  console.log('\n📦 Tablz Database Export');
  console.log('─────────────────────────────────────');

  const startMs = Date.now();

  // ── Read all tables in parallel ──────────────────────────────────────────
  console.log('\n🔍 Reading database...');

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
    auditLogs,
  ] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
    }),

    prisma.restaurant.findMany({
      orderBy: { createdAt: 'asc' },
    }),

    prisma.diningTable.findMany({
      orderBy: { createdAt: 'asc' },
    }),

    prisma.tableCombination.findMany({
      orderBy: { createdAt: 'asc' },
    }),

    prisma.tableCombinationMember.findMany({
      orderBy: { id: 'asc' },
    }),

    prisma.turnTimeRule.findMany({
      orderBy: { createdAt: 'asc' },
    }),

    prisma.reservation.findMany({
      orderBy: { createdAt: 'asc' },
    }),

    prisma.reservationTable.findMany({
      orderBy: { startsAt: 'asc' },
    }),

    prisma.subscription.findMany({
      orderBy: { createdAt: 'asc' },
    }),

    prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        createdAt: {
          gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  const counts = {
    users: users.length,
    restaurants: restaurants.length,
    diningTables: diningTables.length,
    tableCombinations: tableCombinations.length,
    tableCombinationMembers: tableCombinationMembers.length,
    turnTimeRules: turnTimeRules.length,
    reservations: reservations.length,
    reservationTables: reservationTables.length,
    subscriptions: subscriptions.length,
    auditLogs: auditLogs.length,
  };

  // Print count summary
  console.log('\n   Table           Records');
  console.log('   ─────────────────────────');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`   ${table.padEnd(16)} ${String(count).padStart(6)}`);
  }

  // ── Build backup object ───────────────────────────────────────────────────
  const exportedAt = new Date().toISOString();

  const data = {
    users,
    restaurants,
    diningTables,
    tableCombinations,
    tableCombinationMembers,
    turnTimeRules,
    reservations,
    reservationTables,
    subscriptions,
    auditLogs,
  };

  const dataJson = JSON.stringify(data);
  const checksum = createHash('sha256').update(dataJson).digest('hex');

  const backup = {
    meta: {
      version: '2.0',
      platform: 'tablz',
      exportedAt,
      counts,
      checksum,
      note: 'Restore with: pnpm db:restore --file=<this-filename>',
    },
    data,
  };

  // ── Write to file ─────────────────────────────────────────────────────────
  const filename = timestampedFilename();
  const backupsDir = join(process.cwd(), 'backups');
  const filePath = join(backupsDir, filename);

  mkdirSync(backupsDir, { recursive: true });

  const jsonOutput = JSON.stringify(backup, null, 2);
  writeFileSync(filePath, jsonOutput, 'utf8');

  const durationMs = Date.now() - startMs;
  const sizeBytes = Buffer.byteLength(jsonOutput, 'utf8');

  console.log('\n✅ Export complete!');
  console.log('─────────────────────────────────────');
  console.log(`   File      : backups/${filename}`);
  console.log(`   Size      : ${formatSize(sizeBytes)}`);
  console.log(`   Duration  : ${durationMs}ms`);
  console.log(`   Checksum  : ${checksum.slice(0, 16)}...`);
  console.log('\n💡 Save this file somewhere safe (external drive, Google Drive, email to yourself).');
  console.log('   To restore: pnpm db:restore --file=backups/' + filename + '\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Export failed:', err);
    process.exit(1);
  });
