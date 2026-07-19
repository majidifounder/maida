# Findings Backlog

*The **single tracked backlog** of every still-open finding, migrated from the retired
review documents (PLATFORM_REVIEW, SECURITY_REVIEW — see [RETIRED.md](RETIRED.md)) and
from the architecture reviews (01–07). **Original identifiers are preserved**; aliases
join IDs that describe the same issue. Resolved-at-migration items are *not* listed —
[03-ground-truth-reconciliation.md](03-ground-truth-reconciliation.md) §B is the
historical record of what was already fixed and where.*

*Workflow: fixing an item = its own change (never in passing) → un-skip its guard test if
one exists ([INVARIANTS.md](INVARIANTS.md) §skipped) → mark the row Closed with the commit
→ update the owning spec. New findings get a `NEW-` id here.*

## A. Defects (behavior is wrong today)

| ID | Finding | Anchor | Guard | Notes |
|---|---|---|---|---|
| **NEW-H1** | `zonedTimeToUtc` double-subtracts the zone offset (`utcMs -= offset` applied twice cumulatively): Paris noon→10:00Z (should be 11:00Z), NY noon→22:00Z (should be 17:00Z). All wall-clock→UTC math (service windows, closures, day bounds) shifted by one extra offset for **non-UTC restaurants**; UTC restaurants (test default) unaffected — which is why the suite never caught it | `apps/api/src/lib/timezone.ts:52-57` | skipped ×4 in `guards/timezone.guard.test.ts` | Discovered 2026-07-19 while writing guards (empirically verified). Fix must assess existing stored rows + frontend display together; see [spec/reservation.md](spec/reservation.md) INV-2 caveat |
| P2-12 | Disallowed CORS origin → 500 (`cb(new Error(...))`) instead of a clean 4xx | `apps/api/src/index.ts:144` | GT-3 (blocked on SYS-3) | From PLATFORM_REVIEW (retired) |
| **NEW-L1** | Non-owned-resource status code is inconsistent across modules: restaurant module → 404 (`assertRestaurantOwner`), reservation module → 403 (`assertOwnerAccess`). Both oracle-free (same code for nonexistent), but clients/logs see two contracts for one semantic | `restaurant.service.ts:39-48` vs `reservation.service.ts:362-368` | `guards/reservation.guard.test.ts` pins current 403 | Discovered 2026-07-19 by the tenant-isolation guard; unify (likely on 404) as a deliberate change |

## B. Security hardening (open, by severity)

| ID (aliases) | Finding | Anchor | Guard |
|---|---|---|---|
| H-1 (P1-4, CI-E5) | Client-controllable source IP: `CF-Connecting-IP` trusted verbatim unless `CF_ORIGIN_SECRET` set; `trustProxy:true` unconditional | `lib/cloudflare.ts:24-38`, `index.ts:83` | — |
| H-2 (P2-9) | WS token in query string; query strings not redacted in logs | `plugins/websocket.ts:36`, `lib/logger.ts:5-19` | — |
| M-1 (P0-3b, CI-A1) | Staff reservation `dinerId` accepts any user UUID (FK-existence only) | `reservation.schema.ts:73` | skipped in `guards/reservation.guard.test.ts` |
| M-2 (CI-H3) | Admin TOTP: first-login self-enroll window; `window:1` with no used-code cache (brief replay); setup route unthrottled | `admin.service.ts:26,61-101,120` | GT-5 (blocked on SYS-3) |
| M-3 (CI-H1) | Password reset deletes refresh rows but does not deny-list live access tokens (≤15 min exposure) | `auth.service.ts:494-511` | skipped in `guards/auth.guard.test.ts` |
| M-4 | Rate-limit/lockout/threat controls fail **open** on Redis failure (`skipOnError:true`) — *accepted by design*; revisit at scale | `index.ts:170`, `threat-detector.ts:31` | — |
| L-2 (CI-A3, DC-3) | No DB-level tenancy backstop: RLS unused, `withUserContext` has zero callers | `packages/db/src/index.ts:20-22` | — (pair with SYS-7) |
| L-3 | CORS allows requests with no Origin header | `index.ts:141` | GT-3 |
| L-5 (CI-H2) | No refresh-token reuse-family detection | `auth.service.ts:295-316` | skipped in `guards/auth.guard.test.ts` |
| L-6 | `/health` exposes `environment`; prod error handler returns `err.message` for statusCode-bearing errors | `index.ts:69,285,311-315` | — |
| L-7 | `.env` git-history exposure never audited | `.gitignore` | — (one-time audit) |

## C. Product / robustness (open)

| ID (aliases) | Finding | Anchor |
|---|---|---|
| P2-3 | No booking idempotency key (double-submit → double booking at different times) | `reservation.routes.ts:23` |
| P2-5 | `bcryptjs` on the event loop (login latency under load) — *accepted for now* | `apps/api/package.json` |
| P2-6 | Diner SPA date handling uses browser-UTC (frontend scope; interacts with NEW-H1) | `apps/web` |
| P2-7 (CI-A2) | Combinations bookable with **inactive** member tables (combo-level filter only) | `reservation-engine.ts:56-74` |
| P2-13 (HC-6) | Plan limits duplicated client-side (drift risk) | `apps/dashboard/src/lib/plan-limits.ts` |
| P1-11-residual | Restaurant/table/combination count limits are check-then-act (no advisory lock, unlike INV-8) | `restaurant.service.ts:107,126,150` |
| CI-G1 | Overlapping turn-time bands accepted at create; silent first-match at read | `restaurant.service.ts:1013-1036`, `reservation-engine.ts:150-159` |
| CI-C2 | DB status stale between `endsAt` and reconcile (+12 h grace); papered over by display layer | `maintenance.worker.ts:47-55` |
| CI-E6 | Nothing verifies a queue consumer exists (emails/reminders strand silently if workers off) | `env.ts:40`, `worker.ts` |
| CI-B5 | Queue rate cap (60/min/restaurant) drops events silently (no alternate durable delivery) | `queue.ts:71-77` |
| CI-B1/B2 | Webhook ordering trusts LS `updated_at` monotonicity; malformed timestamp treated as newest | `subscription.service.ts:316-336` |
| P3-8 (DC-1..9) | Dead/orphaned code residue (placeholder packages, unused exports, deprecated aliases) | [02 §7](02-dependency-graph.md) |
| UD-1 | Whether the diner SPA consumes `serviceWindows[]`/`bookable` is unverified (backend sends them) | `restaurant.service.ts:410-416` |

## D. Systemic architecture (from [05](05-systemic-review.md); roadmap = its §8 waves)

| ID | Finding | Wave |
|---|---|---|
| SYS-1 (P3-7, SI-1..9, CI-E4) | Implicit single-instance API; correctness-bearing in-process state | 2 |
| SYS-2 (HC-1, CI-F5, CI-E3) | Unpartitioned shared Redis keyspace, no registry/eviction classes → *partially mitigated:* prefix registry now documented in [spec/platform.md](spec/platform.md) §4 + protocol rule; runtime isolation still open | 0 |
| SYS-3 (D-13, B-4) | Test composition ≠ prod composition (no rate-limit/CORS/headers/admin in tests) — blocks GT-3..6, GT-9 | 0 |
| SYS-4 (PIPE-9..11) | Forward-only migrations + fire-and-forget deploy, no rollback | 1 |
| SYS-5 (PIPE-6..8) | Staging validates less than prod; smoke-test claim false | 1 |
| SYS-6 (CI-F1..F7, HC-5..7) | Convention-only enforcement → *partially mitigated:* layering now CI-enforced (drift guard check 3); state-machine + generated limits still open | 2 |
| SYS-7 (CI-A4) | Owner=tenant=billing, no org indirection; RLS inactive | 3 |

## E. Pipeline (from [06](06-pipeline-review.md); closure order = its §6)

PIPE-1/2 (dev fidelity, worker presence) · PIPE-3 (audit gate is a no-op) · PIPE-4 (=SYS-3)
· PIPE-5 (no migrate-diff/reversibility check) · PIPE-6..8 (staging: no check-env, no smoke
test, cancellable between migrate & deploy) · PIPE-9..11 (prod: no rollback, unverified
deploy, no runbook) · PIPE-12 (no secret rotation/scanning) · PIPE-13 (SPAs deploy before
API health is known).

## F. Testing (from [07](07-testing-review.md) + this pass; registry = [INVARIANTS.md](INVARIANTS.md))

| ID | Gap | Status |
|---|---|---|
| GT-1 | INV-8 quota race guard (needs at-limit fixture) | TODO (`it.todo` in `guards/reservation.guard.test.ts`) |
| GT-2 | INV-4 refresh race | **Closed** — `guards/auth.guard.test.ts` |
| GT-3..GT-6, GT-9 | CORS / rate-limit+lockout / admin+TOTP / headers / reconcile guards | Blocked on SYS-3 |
| GT-7 | INV-6 idempotency replay | **Closed** — `guards/webhook.guard.test.ts` |
| GT-8 | Email tz rendering + DST booking correctness | Open (DST value assertions blocked by NEW-H1) |
| GT-10 | Combo w/ inactive member table (pins P2-7) | Open |
| GT-11 | Cross-tenant `tableIds`/`dinerId` | **Half closed** — tableIds guarded; dinerId = skipped M-1 guard |
| GT-12 | Turn-band overlap semantics pin (CI-G1) | Open |
| GT-13 | INV-11 plain-ONLINE outside-window rejection | Open (new) |
| GT-14 | INV-13 abuse guards (horizon/overlap/active-cap) | Open (new) |
| GT-15 | INV-16 real `notifyOnce` dedup (currently mocked) | Open (new) |
| GT-16 | INV-18 scheduler convergence | Open (new) |
| GT-17 | INV-5 fail-closed 503 via Redis fault injection | Open (new) |
| ISO-1..3 | Cross-fork DB reads / manual-id cleanup / shared Redis in tests | Open |
| ISO-4 | `availability-cache.test.ts` Redis probe (`beforeAll` ping, `:40-46`) silently turns every INV-9 assertion into a passing no-op when it fails — observed skipping in a run where the webhook guard reached the same Redis fine; a green file is not proof INV-9 was exercised | Open (new 2026-07-19) |
| BLND-1..4 | PgBouncer semantics / multi-instance / eviction of security keys / deploy health | Open (BLND-2,4 gated on SYS-1/SYS-4) |
