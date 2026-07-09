/**
 * Prisma connection for one-off maintenance scripts (export, restore, dev reset).
 * Uses explicit URLs with retries — Supabase free-tier projects pause when idle and
 * the first connection attempt often fails until the project wakes up.
 */

import { PrismaClient } from '@prisma/client';

const PLATFORM_BACKUP_IDS = ['maida', 'tablz'] as const;

export type BackupPlatformId = (typeof PLATFORM_BACKUP_IDS)[number];

export function isBackupPlatformId(value: string): value is BackupPlatformId {
  return (PLATFORM_BACKUP_IDS as readonly string[]).includes(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collect unique database URLs to try (direct/session first, then pooled). */
export function databaseUrlCandidates(): string[] {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  const pooled = process.env.DATABASE_URL?.trim();
  const urls: string[] = [];
  if (direct) urls.push(direct);
  if (pooled && pooled !== direct) urls.push(pooled);
  if (urls.length === 0 && pooled) urls.push(pooled);
  return urls;
}

/** @deprecated Prefer connectScriptPrisma — kept for scripts that set env before import */
export function useDirectDatabaseUrl(): string {
  const urls = databaseUrlCandidates();
  if (urls.length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env in the repo root (see .env.example).',
    );
  }
  process.env.DATABASE_URL = urls[0]!;
  return urls[0]!;
}

export function maskDatabaseTarget(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname;
    const port = parsed.port || (parsed.protocol === 'postgresql:' ? '5432' : '');
    const user = parsed.username ? `${parsed.username.slice(0, 4)}…` : '(no user)';
    return `${parsed.protocol}//${user}@${host}${port ? `:${port}` : ''}/${parsed.pathname.replace(/^\//, '') || 'postgres'}`;
  } catch {
    return '(invalid DATABASE_URL)';
  }
}

export function isReachabilityError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Can't reach database server") ||
    message.includes('Connection timed out') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND')
  );
}

/**
 * Connect with retries and URL fallback. Returns a dedicated client (not the API singleton).
 */
export async function connectScriptPrisma(): Promise<{
  prisma: PrismaClient;
  databaseUrl: string;
}> {
  const candidates = databaseUrlCandidates();
  if (candidates.length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Add DATABASE_URL and DIRECT_DATABASE_URL to .env (see .env.example).',
    );
  }

  let lastError: unknown;

  for (const url of candidates) {
    console.log(`\n🔗 Database: ${maskDatabaseTarget(url)}`);

    for (let attempt = 1; attempt <= 4; attempt++) {
      const prisma = new PrismaClient({
        datasources: { db: { url } },
        errorFormat: 'minimal',
      });

      try {
        await prisma.$queryRaw`SELECT 1`;
        if (attempt > 1) {
          console.log(`   ✅ Connected on attempt ${attempt}`);
        }
        return { prisma, databaseUrl: url };
      } catch (err) {
        lastError = err;
        await prisma.$disconnect().catch(() => {});

        if (!isReachabilityError(err)) throw err;

        if (attempt < 4) {
          const waitSec = attempt * 2;
          console.log(
            `   ⏳ Attempt ${attempt}/4 failed — retrying in ${waitSec}s (Supabase may be waking up)...`,
          );
          await sleep(waitSec * 1000);
        }
      }
    }
  }

  throw lastError;
}

export async function importScriptPrisma() {
  const { prisma } = await connectScriptPrisma();
  return { prisma };
}

export function printDatabaseConnectionHint(err: unknown): void {
  if (!isReachabilityError(err)) return;

  console.error('\n💡 This is a network/Supabase issue — not Lemon Squeezy or missing API keys.');
  console.error('   db:export only needs DATABASE_URL + DIRECT_DATABASE_URL in .env.');
  console.error('\n   Common fixes:');
  console.error('   • Open https://supabase.com/dashboard — if the project shows Paused, click Restore');
  console.error('   • Wait 30–60 seconds after restoring, then run pnpm db:export again');
  console.error('   • DIRECT_DATABASE_URL → session pooler port 5432 (you already have this)');
  console.error('   • DATABASE_URL → transaction pooler port 6543 (API runtime)');
  console.error('   • Disable VPN / try another network if it keeps failing');
  console.error('   • Confirm the DB password in .env matches Supabase (URL-encode special chars)\n');
}
