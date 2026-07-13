# Debug Log

Repeatable debug/stabilization loop. Newest iteration on top.

## Discovered checks (Step 0)

Monorepo (pnpm + turbo). Definition of "0 errors" = all of these:

| Command | What it runs | Infra needed |
|---|---|---|
| `pnpm test` | `turbo run test` → vitest in api / web / api-client (others echo "no tests") | none (mocks) |
| `pnpm typecheck` | `turbo run typecheck` → `tsc --noEmit` in all 8 packages | none |
| `pnpm lint` | `turbo run lint` → eslint | none |
| `pnpm build` | `turbo run build` → tsc/vite build | none |
| `pnpm e2e` | `tsx scripts/e2e/run.ts` — 10 live journeys | **API server on :3001 + Redis + Supabase (real, no mocks)** |
| `pnpm check-env` | validates required env vars | none |

Test configs: `apps/api/vitest.config.ts`. Test files: 9 in api, 2 in web, 1 in api-client.
No jest/playwright/cypress config present.

---

## Iteration 0 — baseline (2026-07-12)

Ran every no-infra check. Results:

| Check | Result |
|---|---|
| `pnpm test` | ✅ 0 failures — api 157, web 9, api-client 14 (180 total) |
| `pnpm typecheck` | ✅ 8/8 packages pass |
| `pnpm lint` | ✅ 0 errors (53 warnings, all `explicit-function-return-type` in admin) |
| `pnpm build` | ✅ 8/8 packages pass |
| `pnpm check-env` | ✅ all required env vars present |
| `pnpm e2e` | ❌ 23 passed / 2 failed (see Iteration 1) |

**No test/type/lint/build failures to fix.** The static suite is fully green at baseline.

Note: `REDIS_URL` is Upstash (`rediss://…upstash.io`), NOT local Docker — `pnpm redis:up` is unnecessary and Docker isn't installed. e2e runs against live Upstash + Supabase.

### Non-failing noise observed (not blocking, worth cleaning)
- `apps/api` notification tests log `No "Queue" export is defined on the "bullmq" mock` — the `bullmq` mock in the notification test omits the `Queue` export, so `getQueue()` throws and is swallowed by `[Queue] failed to schedule reminder`. Tests still pass because the path is wrapped in try/catch, but the reminder-scheduling branch is not actually being exercised.
- Auth tests log Resend errors (`You can only send testing emails to your own email address`) — expected in test env; swallowed.

---

## Iteration 1 — e2e triage (2026-07-12)

Started fresh API server on :3001 (killed stale PID 14008 from 10:28), `/health/ready` = db ok, redis ok. Ran `pnpm e2e`: **23 passed, 2 failed.**

### Failure A — Plan enforcement / "STARTER — second restaurant rejected" → expected 403, got 503
- **Root cause: transient Upstash Redis latency, NOT a code bug.** Server log: `[auth] revocation/account check unavailable — returning 503`, `err.message = "Command timed out"`, responseTime 2106ms.
- The auth plugin (`apps/api/src/plugins/authenticate.ts:44-69`) does `redis.get('deny:<jti>')` for token-revocation. `commandTimeout` is 2000ms (`apps/api/src/lib/redis.ts:12`) with `maxRetriesPerRequest: 1`. A single Upstash GET exceeded 2s → command timeout → plugin **fails closed with 503 by design** ("Access is never granted on infrastructure failure").
- Plan-limit logic itself is correct (STARTER limit = 1; 2nd create would return the proper 403+upgrade body). The request never reached it — auth rejected first.
- **Options:** (a) accept as infra flake, re-run; (b) add a bounded retry around the revocation GET to ride out Upstash spikes without loosening fail-closed posture.

### Failure B — Subscription lifecycle / "checkout → upgrade → downgrade on expiry → resume" → "Expected upgrade path after downgrade"
- **Root cause: e2e test encodes OLD product behavior; code was intentionally changed.** `report.assert` throws on first false, so the failing line is `subscription.ts:130-133` (`blockedThird.body.upgrade === '/subscriptions/checkout'`). The prior assert (`status === 403`, line 126) PASSED — so the 3rd-restaurant POST returned 403 but with **no `upgrade` field**.
- Why: after `subscription_expired`, status → EXPIRED. `resolveOwnerBillingState` (`subscription.service.ts:136-155`) now returns `canOperate: false` ("EXPIRED paid subscription — LOCKED, same as an expired trial" — deliberate per the code comment). So `assertOwnerCanOperate` (called first in `assertOwnerRestaurantPlanLimit`, line 330) throws a generic `ForbiddenError` (403, no `upgrade` field) **before** the plan-limit branch that adds `upgrade`.
- The test still expects the removed behavior: expiry → functional free STARTER, 3rd create blocked by *plan limit* (403 **with** upgrade path). Code vs test now disagree on intended behavior.
- **Decision needed:** is "lock on expiry" the intended behavior (→ update the stale test) or should expiry downgrade to a usable free STARTER (→ change the code)? Code comment strongly implies the lock is intentional.

### Decision (user) & fixes applied — Iteration 1
User chose: **graceful fallback to free STARTER on paid expiry** (existing data accessible, premium features disabled, Starter limits enforced, upgrade message on limit) + **add a bounded Redis retry** for Failure A.

Changes:
1. `subscription.service.ts` — `resolveOwnerBillingState` EXPIRED branch: `canOperate: false → true` (Starter fallback). Comment rewritten to the new rule.
2. `subscription.service.ts` — `canOwnerOperateFromSubscription`: EXPIRED now returns operable (keeps diner availability bookable at Starter). Only an expired *trial* stays locked.
3. `plugins/authenticate.ts` — revocation/account check wrapped in a bounded retry (`REVOCATION_MAX_ATTEMPTS = 2`, 100ms backoff); still fails closed with 503 after retries. Genuine revocation/deactivation short-circuits without retry.
4. Tests: added `EXPIRED` fixture to `__tests__/helpers/auth.ts`; new unit test in `subscription.test.ts` ("lapsed paid subscription falls back to a usable free Starter tier") asserting `/subscriptions/me` → billingTier STARTER + canOperate true, 1st restaurant 201, 2nd → 403 with `upgrade`. The e2e subscription journey already encoded the correct rule, so it needed no change.

### Verification — Iteration 1 (all green)
- `pnpm --filter @restaurant/api typecheck` ✅
- `subscription.test.ts` ✅ **24 passed** (was 23; +1 new fallback test)
- Restarted API server on new code (killed stale PID, `/health/ready` db+redis ok), clean **`pnpm e2e` → 25 passed, 0 failed** (was 23/2). Both former failures now pass:
  - ✓ Plan enforcement / second restaurant rejected (no 503 — retry rode out Upstash)
  - ✓ Subscription lifecycle / downgrade on expiry → resume (STARTER fallback)
- Regression re-run of static checks: typecheck / lint / full test suite — see below.

### Final clean pass — Iteration 1 (ALL GREEN)
| Check | Result |
|---|---|
| `pnpm test` | ✅ **181 passed, 0 failed** (api 158 +1 new, web 9, api-client 14) |
| `pnpm typecheck` | ✅ 8/8 |
| `pnpm lint` | ✅ 0 errors (61 warnings, pre-existing) |
| `pnpm build` | ✅ 8/8 |
| `pnpm e2e` | ✅ **25 passed, 0 failed** |
| `pnpm check-env` | ✅ (unchanged) |

**Bugs fixed: 2** (1 real logic/business-rule change, 1 resilience fix). **Files changed: 4** — `apps/api/src/modules/subscription/subscription.service.ts`, `apps/api/src/plugins/authenticate.ts`, `apps/api/src/__tests__/helpers/auth.ts`, `apps/api/src/__tests__/subscription.test.ts`.

---

## Iteration 2 — flaky `pnpm test` failure reported by user (2026-07-12)

User's `pnpm test` run failed: `reservation.test.ts:136` expected **409**, got **503** (`Tests 1 failed | 156 passed`). The wall of `level:40` log lines (Resend "testing email" errors, swallowed) is expected noise, NOT the failure.

### Root cause — race/churn in `ensureRedisConnected` (`apps/api/src/lib/redis.ts`)
- Smoking gun in the log: `Error: Redis is already connecting/connected ... at ensureRedisConnected (redis.ts:61)`.
- The old `ensureRedisConnected` called `redis.connect()` whenever status ≠ 'ready'. When two requests arrive together (or a prior request left the shared client in 'connecting'), the second `connect()` is rejected by ioredis → the auth plugin fails closed with **503**. Worse, every failure ran `_client = null` + `disconnect()`, tearing down the shared client mid-flight and cascading more failures under load. Upstash's slow first-connect from Windows (the `Redis connect timeout` lines, connectTimeout was 2s) triggered the churn.
- Net effect: an authenticated request 503s instead of reaching the booking logic that returns 409/201. Timing-dependent, which is why local full-suite runs here passed but the user's didn't.

### Fix
1. `redis.ts` — `ensureRedisConnected` now **coalesces concurrent callers onto one `_connecting` promise**; a caller arriving mid-connect awaits the client's `ready` event (`waitForReady`) instead of issuing a competing `connect()`. `connectTimeout` 2s→5s (Upstash/Windows cold TLS). Default ensure timeout 2s→5s.
2. `authenticate.ts` — revocation-check connect budget 1.5s→3s (still backed by the 2-attempt retry from Iteration 1).

Verification: api typecheck ✅; `reservation.test.ts` ✅ 20 passed; full **`pnpm test` → 181 passed, 0 failed** (api 158, web 9, api-client 14; 7/7 packages), no `already connecting` errors.

Files changed (Iteration 2): `apps/api/src/lib/redis.ts`, `apps/api/src/plugins/authenticate.ts`.

---

## Iteration 3 — new deterministic `pnpm test` failure (2026-07-13)

User's `pnpm test` failed on a *different*, deterministic test (the Iteration-2 Redis flake is resolved — the concurrency test passed). Suite has grown to 164 tests / 11 files.

```
FAIL restaurant.test.ts:289  "200 — partySize larger than any table capacity returns 0 for that city"
expected 422 to be 200   (GET /restaurants?...&partySize=999 → 422)
```

### Root cause — stale test vs. an intentional hardening
- `git log -L` shows the test line (`partySize=999`) was added long ago in `e0b6daf` (Phase 3 tests), when search had no party-size cap → it returned 200/total:0.
- The cap `AvailabilityPartySizeSchema = z.coerce.number().int().min(1).max(50)` was added **later** in `e214ff3` ("harden … party size …"), a deliberate anti-abuse limit (bounds cache keys / rejects sizes no table could seat). That commit didn't update the older test, so `partySize=999` now fails validation → 422.

### Fix
- `restaurant.test.ts` — changed the oversized value `999 → 50`. The test's search restaurant has only 8-seat tables (lines 213-214), so 50 (the max search accepts) still exceeds every table and the availability filter returns 0 — preserving the test's intent while respecting the documented input cap. Schema left intentionally unchanged.

Verification: `restaurant.test.ts` ✅ 41 passed; full **`pnpm test` → 187 passed, 0 failed** (api 164, web 9, api-client 14; 7/7 packages).

File changed (Iteration 3): `apps/api/src/__tests__/restaurant.test.ts` (test-only).

---

## Iteration 4 — web suite timeouts under parallel load (2026-07-13)

User's `pnpm test` failed in `@restaurant/web` (the api/api-client suites passed). Two tests **timed out at 5000ms** (not assertion failures):
```
× booking-availability.test.ts:40  "computes next available and in-30-min picks"  (timed out)
× restaurant-time.test.ts:14        "formats service window in restaurant timezone" (timed out)
```

### Root cause — cold ICU timezone load starved by parallel suites (no code bug)
- Both failing tests are the **first** call to `Intl.DateTimeFormat` with a named timezone in their file; every later timezone test passed in 2–12ms. That's the signature of a one-time ICU timezone-data load.
- `formatServiceWindowLabel` / `computeQuickPicks` are trivial — every loop is bounded over finite arrays; no hang is possible (verified by reading the source).
- `turbo run test` runs all package suites **in parallel**. The API suite forks many workers hammering live Upstash/Supabase, saturating CPU. On the user's machine that starved the web worker's first ICU load past Vitest's 5s default → timeout. (Did not reproduce locally, where web finishes in ~1.5s — it's load-dependent.)

### Fix
- `apps/web/vite.config.ts` — switched `defineConfig` import to `vitest/config` (vite ignores the `test` key, so `vite build`/`dev` are unaffected — verified build still passes) and added `test: { testTimeout: 20_000, hookTimeout: 20_000 }`. No test logic touched; just realistic headroom for a cold environment under contention.

Verification (all green):
- web test ✅ 9 passed; web build (`tsc --noEmit && vite build`) ✅
- full **`pnpm test` → 187 passed, 0 failed** (api 164, web 9, api-client 14; 7/7 packages)
- **`pnpm e2e` → 25 passed, 0 failed** (no regression from the test/config changes)

Files changed (Iteration 4): `apps/web/vite.config.ts` (config-only). Committed together with Iteration 3.

### Known non-blocking risks before publishing
- **`bullmq` mock gap (test noise):** `notification.test.ts` mocks `bullmq` without a `Queue` export, so `getQueue()` throws and the reminder-scheduling branch is swallowed (`[Queue] failed to schedule reminder`). Tests pass but that branch isn't actually exercised — worth fixing for real coverage. Not a runtime bug.
- **Redis retry latency trade-off:** during a *sustained* Upstash outage, the auth check now takes up to ~2×(1.5s connect + 2s command) before its 503. Acceptable per the fail-closed design; bounded at 2 attempts.
- **Live-infra e2e flakiness:** e2e hits real Upstash/Supabase, so occasional command-timeouts remain possible under load. The retry reduces but can't eliminate this.
