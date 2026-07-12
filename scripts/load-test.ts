/**
 * Concurrent booking load test — the pre-launch capacity + correctness gate.
 *
 * Proves that the PostgreSQL GiST exclusion constraint on reservation_tables
 * makes double-booking impossible under real parallel HTTP load, and reports
 * booking latency so the booking path can be validated against the production
 * connection pooler (point DATABASE_URL at Supabase :6543?pgbouncer=true in
 * .env before running — this is the classic Prisma+PgBouncer stress case).
 *
 * Design: N diners race to book the SAME instant on a restaurant with ONE
 * table. Exactly one must win (201); the rest must lose cleanly (409). The
 * database is then checked directly for exactly one unreleased hold.
 *
 * Usage:
 *   pnpm --filter @restaurant/api dev        ← terminal 1 (or point at staging)
 *   pnpm load-test                           ← terminal 2
 *
 * Environment:
 *   API_URL             — base URL (default http://localhost:3001)
 *   LOAD_TEST_CONCURRENT — racers on the single table (default 30)
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch } from 'undici';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const BASE = process.env.API_URL ?? 'http://localhost:3001';
const CONCURRENT = Number(process.env.LOAD_TEST_CONCURRENT ?? 30);
const PARTY_SIZE = 2;
// A single table → the exclusion constraint permits exactly one booking at the
// shared instant, so exactly one racer wins.
const EXPECTED_WINS = 1;
const EXPECTED_LOSSES = CONCURRENT - 1;

const LOAD_TEST_HEADERS = { 'X-Load-Test': '1' };

async function post<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: T; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...LOAD_TEST_HEADERS,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body: parsed, ms: Date.now() - t0 };
}

function uniqueEmail(prefix: string) {
  return `load-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@load-test.local`;
}

function pass(msg: string) {
  console.log(`  ✅ ${msg}`);
}
function fail(msg: string) {
  console.error(`  ❌ ${msg}`);
  process.exitCode = 1;
}
function section(title: string) {
  console.log(`\n── ${title} ──`);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

const cleanupUserIds: string[] = [];
const cleanupReservationIds: string[] = [];
let cleanupRestId = '';

async function main() {
  const { prisma } = await import('@restaurant/db');

  console.log('🚀 Concurrent booking load test (GiST exclusion under load)');
  console.log(`   Target:      ${BASE}`);
  console.log(`   Concurrent:  ${CONCURRENT} racers on 1 table, 1 instant`);
  console.log(`   Expected:    ${EXPECTED_WINS} win / ${EXPECTED_LOSSES} conflict`);

  section('Setup: owner + restaurant + one table');

  const ownerEmail = uniqueEmail('owner');
  await post('/auth/register', {
    email: ownerEmail,
    password: 'LoadTest1!',
    role: 'owner',
  });
  const ownerLogin = await post<{ accessToken: string; user: { id: string } }>(
    '/auth/login',
    { email: ownerEmail, password: 'LoadTest1!' },
  );
  if (ownerLogin.status !== 200) {
    fail(`Owner login failed with status ${ownerLogin.status}`);
    return;
  }
  const ownerToken = ownerLogin.body.accessToken;
  const ownerId = ownerLogin.body.user.id;
  cleanupUserIds.push(ownerId);

  // R7b: verify the owner (restaurant creation is gated) and ensure an
  // operable paid subscription — directly, so the test needs no email flow.
  await prisma.user.update({
    where: { id: ownerId },
    data: { emailVerifiedAt: new Date() },
  });
  await prisma.subscription.upsert({
    where: { userId: ownerId },
    create: { userId: ownerId, plan: 'PRO', status: 'ACTIVE' },
    update: { plan: 'PRO', status: 'ACTIVE' },
  });
  console.log(`  Owner ready: ${ownerEmail}`);

  const rest = await post<{ restaurant: { id: string } }>(
    '/restaurants',
    {
      name: 'Load Test Restaurant',
      description: 'Created by the concurrent booking load test — safe to delete',
      cuisine: 'FRENCH',
      address: '1 Load Test Ave',
      city: 'TestCity',
    },
    ownerToken,
  );
  if (rest.status !== 201) {
    fail(`Create restaurant failed with status ${rest.status}`);
    return;
  }
  cleanupRestId = rest.body.restaurant.id;

  const table = await post<{ table: { id: string } }>(
    `/restaurants/${cleanupRestId}/tables`,
    { name: 'T1', minPartySize: 1, maxPartySize: 8 },
    ownerToken,
  );
  if (table.status !== 201) {
    fail(`Create table failed with status ${table.status}`);
    return;
  }
  const tableId = table.body.table.id;
  console.log(`  Restaurant ${cleanupRestId}, table ${tableId}`);

  // The shared instant every racer targets — inside the default 11:00–23:00
  // service window, a week out so it is always in the future.
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 7);
  startsAt.setUTCHours(12, 0, 0, 0);
  const startsAtStr = startsAt.toISOString();

  section(`Setup: ${CONCURRENT} verified diner accounts`);

  const dinerTokens: string[] = [];
  const dinerIds: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENT }, async (_, i) => {
      const email = uniqueEmail(`diner-${i}`);
      await post('/auth/register', { email, password: 'LoadTest1!', role: 'diner' });
      const login = await post<{ accessToken: string; user: { id: string } }>(
        '/auth/login',
        { email, password: 'LoadTest1!' },
      );
      if (login.status !== 200) throw new Error(`Diner ${i} login failed: ${login.status}`);
      dinerTokens[i] = login.body.accessToken;
      dinerIds[i] = login.body.user.id;
    }),
  );
  cleanupUserIds.push(...dinerIds);
  // R7b: verify all diners in one statement so they may book.
  await prisma.user.updateMany({
    where: { id: { in: dinerIds } },
    data: { emailVerifiedAt: new Date() },
  });
  console.log(`  ${CONCURRENT} diners ready and verified`);

  section('Concurrent booking fire');
  console.log(`  Firing ${CONCURRENT} simultaneous POST /reservations…`);

  const start = Date.now();
  const results = await Promise.all(
    dinerTokens.map((token) =>
      post<{ reservation?: { id: string } }>(
        '/reservations',
        {
          restaurantId: cleanupRestId,
          partySize: PARTY_SIZE,
          startsAt: startsAtStr,
          reservationType: 'STANDARD',
        },
        token,
      ),
    ),
  );
  const elapsed = Date.now() - start;

  const wins = results.filter((r) => r.status === 201);
  const losses = results.filter((r) => r.status === 409);
  const other = results.filter((r) => r.status !== 201 && r.status !== 409);
  wins.forEach((r) => {
    if (r.body.reservation?.id) cleanupReservationIds.push(r.body.reservation.id);
  });

  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`  Wall time: ${elapsed}ms for ${CONCURRENT} requests`);
  console.log(
    `  Latency  p50 ${percentile(latencies, 50)}ms · p95 ${percentile(latencies, 95)}ms · max ${latencies[latencies.length - 1]}ms`,
  );
  console.log(`  201 win: ${wins.length} · 409 conflict: ${losses.length}`);
  if (other.length) {
    console.log(`  ⚠️  Other statuses: ${other.map((r) => r.status).join(', ')}`);
  }

  section('Assertions');

  wins.length === EXPECTED_WINS
    ? pass(`Exactly ${EXPECTED_WINS} request won — exclusion constraint held`)
    : fail(`Expected ${EXPECTED_WINS} win, got ${wins.length} — DOUBLE-BOOKING!`);

  losses.length === EXPECTED_LOSSES
    ? pass(`Exactly ${EXPECTED_LOSSES} requests rejected with 409`)
    : fail(`Expected ${EXPECTED_LOSSES} conflicts, got ${losses.length}`);

  other.length === 0
    ? pass('No unexpected status codes (no 500s / pool exhaustion / prepared-stmt errors)')
    : fail(`${other.length} requests returned unexpected status codes`);

  // The ground truth: the database itself must hold exactly one unreleased row
  // for this table at this instant, regardless of what the HTTP layer reported.
  const holds = await prisma.reservationTable.count({
    where: { tableId, startsAt, releasedAt: null },
  });
  holds === 1
    ? pass('Database holds exactly 1 unreleased reservation_tables row')
    : fail(`Database holds ${holds} rows — expected exactly 1`);

  section('Cleanup');
  await prisma.reservation.deleteMany({ where: { restaurantId: cleanupRestId } });
  await prisma.diningTable.deleteMany({ where: { restaurantId: cleanupRestId } });
  await prisma.servicePeriod.deleteMany({ where: { restaurantId: cleanupRestId } });
  await prisma.restaurant.deleteMany({ where: { id: cleanupRestId } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: cleanupUserIds } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  await prisma.$disconnect();
  console.log('  Test data deleted');

  section('Result');
  if (process.exitCode === 1) {
    console.error('\n❌ LOAD TEST FAILED — do not ship until this passes\n');
  } else {
    console.log(
      `\n✅ LOAD TEST PASSED — ${CONCURRENT} concurrent, 1 win, exclusion held, ${elapsed}ms\n`,
    );
  }
}

main().catch((err) => {
  console.error('Load test crashed:', err);
  process.exit(1);
});
