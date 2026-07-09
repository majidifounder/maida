import './preload-env.js';
import { fetch } from 'undici';
import { Reporter } from './lib/report.js';
import { createContext } from './lib/context.js';
import { cleanupE2eData } from './lib/cleanup.js';
import { runDinerJourney } from './journeys/diner.js';
import { runOwnerJourney } from './journeys/owner.js';
import { runPlanEnforcementJourney } from './journeys/plan-enforcement.js';
import { runAdminJourney } from './journeys/admin.js';
import { runSubscriptionJourney } from './journeys/subscription.js';
import { runWebSocketJourney } from './journeys/websocket.js';
import { runConcurrencyJourney } from './journeys/concurrency.js';
import { runTimezoneJourney } from './journeys/timezone.js';
import { runSecurityJourney } from './journeys/security.js';
import { runRegressionJourney } from './journeys/regression.js';

const BASE = process.env.API_URL ?? 'http://localhost:3001';

async function assertApiReachable(): Promise<void> {
  const healthUrl = `${BASE}/health`;
  const readyUrl = `${BASE}/health/ready`;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
      if (res.status === 200) break;
      throw new Error(`API health returned ${res.status}`);
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error('\n❌ API server not reachable at', BASE);
        console.error('   Start it first: pnpm --filter @restaurant/api dev');
        console.error('   If port 3001 is stuck: scripts/stop-project-node.ps1\n');
        throw err;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  try {
    const ready = await fetch(readyUrl, { signal: AbortSignal.timeout(10_000) });
    const body = (await ready.json().catch(() => null)) as {
      status?: string;
      checks?: { database?: string; redis?: string };
    } | null;
    if (ready.status !== 200 || body?.checks?.redis !== 'ok') {
      console.error('\n❌ Redis is not healthy — E2E needs a working REDIS_URL');
      console.error(`   /health/ready → ${ready.status} ${JSON.stringify(body?.checks ?? body)}`);
      console.error('   Fix options:');
      console.error('   1) Start local Redis:  pnpm redis:up');
      console.error('      then set REDIS_URL=redis://:devredispass@127.0.0.1:6379 in .env');
      console.error('   2) Or fix Upstash REDIS_URL in the Upstash console (rediss://…)\n');
      throw new Error('Redis not ready for e2e');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Redis not ready for e2e') throw err;
    console.error('\n❌ /health/ready failed — Redis/DB check timed out');
    console.error('   Most common cause: unreachable REDIS_URL (Upstash)');
    console.error('   Try: pnpm redis:up  and point REDIS_URL at local Redis\n');
    throw err;
  }
}

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════');
  console.log('  Maida Platform — Full E2E Suite (Phase 12 · Task 2)');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Target: ${BASE}`);
  console.log(`  Stores: Supabase + Upstash (real — no mocks)\n`);

  await assertApiReachable();

  const report = new Reporter();
  const ctx = createContext(BASE, report);

  try {
    await runRegressionJourney(ctx);
    await runDinerJourney(ctx);
    await runOwnerJourney(ctx);
    await runPlanEnforcementJourney(ctx);
    await runAdminJourney(ctx);
    await runSubscriptionJourney(ctx);
    await runWebSocketJourney(ctx);
    await runConcurrencyJourney(ctx);
    await runTimezoneJourney(ctx);
    await runSecurityJourney(ctx);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Stopping e2e early')) {
      console.error(`\n${err.message}\n`);
    } else {
      throw err;
    }
  } finally {
    console.log('\n── Cleanup ──');
    try {
      await cleanupE2eData(ctx);
      console.log('  Test data removed');
    } catch (err) {
      console.error('  Cleanup error:', err);
      process.exitCode = 1;
    }
  }

  const ok = report.printSummary();
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\nE2E suite crashed:', err);
  process.exit(1);
});
