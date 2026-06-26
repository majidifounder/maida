/**
 * Concurrent booking load test.
 *
 * Proves that SELECT FOR UPDATE prevents double-booking under real parallel HTTP load.
 * Runs against a live API server (default http://localhost:3001).
 *
 * Usage:
 *   pnpm --filter @restaurant/api dev   ← terminal 1
 *   pnpm load-test                      ← terminal 2
 *
 * Environment:
 *   API_URL  — override base URL (default http://localhost:3001)
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch } from 'undici';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const BASE = process.env.API_URL ?? 'http://localhost:3001';
const SLOT_CAPACITY = 5;
const CONCURRENT = 20;
const PARTY_SIZE = 1;
const EXPECTED_WINS = SLOT_CAPACITY;
const EXPECTED_LOSSES = CONCURRENT - SLOT_CAPACITY;

const LOAD_TEST_HEADERS = { 'X-Load-Test': '1' };

async function post<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...LOAD_TEST_HEADERS,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function get<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.json() as Promise<T>;
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

const cleanupUserIds: string[] = [];
const cleanupBookingIds: string[] = [];
let cleanupSlotId = '';
let cleanupRestId = '';

async function main() {
  console.log('🚀 Concurrent booking load test');
  console.log(`   Target:      ${BASE}`);
  console.log(`   Slot cap:    ${SLOT_CAPACITY}`);
  console.log(`   Concurrent:  ${CONCURRENT}`);
  console.log(`   Expected wins: ${EXPECTED_WINS}`);

  section('Setup: owner + restaurant + slot');

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
  cleanupUserIds.push(ownerLogin.body.user.id);
  console.log(`  Owner registered: ${ownerEmail}`);

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
  console.log(`  Restaurant: ${cleanupRestId}`);

  const slotDate = new Date();
  slotDate.setDate(slotDate.getDate() + 7);
  slotDate.setUTCHours(12, 0, 0, 0);
  const slotDateStr = slotDate.toISOString();

  const slotsRes = await post<{ slots: Array<{ id: string }> }>(
    `/restaurants/${cleanupRestId}/slots`,
    { slots: [{ startsAt: slotDateStr, capacity: SLOT_CAPACITY }] },
    ownerToken,
  );
  if (slotsRes.status !== 201) {
    fail(`Create slot failed with status ${slotsRes.status}`);
    return;
  }
  cleanupSlotId = slotsRes.body.slots[0]!.id;
  console.log(`  Slot: ${cleanupSlotId} (capacity ${SLOT_CAPACITY})`);

  section(`Setup: ${CONCURRENT} diner accounts`);

  const dinerTokens: string[] = [];
  const dinerIds: string[] = [];

  await Promise.all(
    Array.from({ length: CONCURRENT }, async (_, i) => {
      const email = uniqueEmail(`diner-${i}`);
      await post('/auth/register', {
        email,
        password: 'LoadTest1!',
        role: 'diner',
      });
      const login = await post<{ accessToken: string; user: { id: string } }>(
        '/auth/login',
        { email, password: 'LoadTest1!' },
      );
      if (login.status !== 200) {
        throw new Error(`Diner ${i} login failed: ${login.status}`);
      }
      dinerTokens[i] = login.body.accessToken;
      dinerIds[i] = login.body.user.id;
    }),
  );
  cleanupUserIds.push(...dinerIds);
  console.log(`  ${CONCURRENT} diners ready`);

  section('Concurrent booking fire');
  console.log(`  Firing ${CONCURRENT} simultaneous POST /bookings...`);

  const start = Date.now();
  const results = await Promise.all(
    dinerTokens.map((token) =>
      post<{ booking?: { id: string } }>(
        '/bookings',
        {
          restaurantId: cleanupRestId,
          slotId: cleanupSlotId,
          partySize: PARTY_SIZE,
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
    if (r.body.booking?.id) cleanupBookingIds.push(r.body.booking.id);
  });

  console.log(`  Completed in ${elapsed}ms`);
  console.log(`  201 (success): ${wins.length}`);
  console.log(`  409 (conflict): ${losses.length}`);
  if (other.length) {
    console.log(`  Other statuses: ${other.map((r) => r.status).join(', ')}`);
  }

  section('Assertions');

  wins.length === EXPECTED_WINS
    ? pass(`Exactly ${EXPECTED_WINS} requests won (SELECT FOR UPDATE held)`)
    : fail(`Expected ${EXPECTED_WINS} wins, got ${wins.length} — possible double-booking!`);

  losses.length === EXPECTED_LOSSES
    ? pass(`Exactly ${EXPECTED_LOSSES} requests correctly rejected with 409`)
    : fail(`Expected ${EXPECTED_LOSSES} rejections, got ${losses.length}`);

  other.length === 0
    ? pass('No unexpected status codes')
    : fail(`${other.length} requests returned unexpected status codes`);

  const dateStr = slotDate.toISOString().slice(0, 10);
  const slotRes = await get<{ slots: Array<{ id: string; available: number }> }>(
    `/restaurants/${cleanupRestId}/slots?date=${dateStr}`,
  );
  const slot = slotRes.slots.find((s) => s.id === cleanupSlotId);

  if (!slot) {
    fail('Could not find test slot in GET /slots response');
  } else {
    slot.available === 0
      ? pass(`Slot.available = 0 — all ${SLOT_CAPACITY} seats accounted for`)
      : fail(`Slot.available = ${slot.available} — expected 0 (seats leaked!)`);
  }

  section('Cleanup (using Prisma directly)');

  const { prisma } = await import('@restaurant/db');

  await prisma.booking.deleteMany({
    where: { id: { in: cleanupBookingIds } },
  });
  await prisma.timeSlot.deleteMany({
    where: { id: cleanupSlotId },
  });
  await prisma.restaurant.deleteMany({
    where: { id: cleanupRestId },
  });
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: cleanupUserIds } },
  });
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: cleanupUserIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: cleanupUserIds } },
  });
  await prisma.$disconnect();
  console.log('  Test data deleted');

  section('Result');
  if (process.exitCode === 1) {
    console.error(
      '\n❌ LOAD TEST FAILED — do not ship until SELECT FOR UPDATE is confirmed working\n',
    );
  } else {
    console.log(
      `\n✅ LOAD TEST PASSED — ${CONCURRENT} concurrent requests, ${EXPECTED_WINS} correct wins, ${elapsed}ms total\n`,
    );
  }
}

main().catch((err) => {
  console.error('Load test crashed:', err);
  process.exit(1);
});
