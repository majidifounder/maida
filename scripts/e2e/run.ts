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
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.status !== 200) {
      throw new Error(`API health returned ${res.status}`);
    }
  } catch (err) {
    console.error('\n❌ API server not reachable at', BASE);
    console.error('   Start it first: pnpm --filter @restaurant/api dev\n');
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
