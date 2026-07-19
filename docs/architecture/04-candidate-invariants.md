# 04 · Candidate Invariants

*Assumptions the system **relies on but does not explicitly enforce** in code. Each is an
observation with supporting evidence — **not** a bug report, recommendation, or task.
These are inputs for later triage (Prompt 3). Authority = code on `staging`, 2026-07-19.*

Legend for "Enforced?": **No** = nothing in code guarantees it; **Partial** = guarded on
some paths only; **External** = relied on but enforced outside app code (infra/process).

---

## A. Ownership & tenancy assumptions

| ID | Assumption | Enforced? | Evidence |
|---|---|---|---|
| CI-A1 | A `dinerId` attached to a staff reservation belongs to a real diner who consented / is a customer of that restaurant | **No** — only FK existence is enforced; any user UUID accepted | `reservation.schema.ts:73` (`z.string().uuid().optional()`); `reservation.service.ts:1350` passes it through; FK `reservations_dinerId_fkey` only checks existence (`schema.prisma:297`). (= carried M-1/P0-3b) |
| CI-A2 | Table combinations only reference **active** member tables | **No** — `loadBookableUnits` filters combos by `TableCombination.isActive` but does not exclude combos whose member `DiningTable.isActive=false` | `reservation-engine.ts:56-74`; deleting a table sets `isActive=false` (`restaurant.service.ts:848-851`) without touching combos. (= carried P2-7) |
| CI-A3 | App-layer `where` clauses are the sole tenant boundary; every query that returns tenant data carries an owner/diner filter | **No DB backstop** — RLS unused, `withUserContext` uncalled | `db/src/index.ts:20-22`; correctness rests on every service function (e.g. `assertRestaurantOwner`, `assertOwnerAccess`, `where:{dinerId}`). (= carried L-2) |
| CI-A4 | Subscription-per-user correctly gates all of an owner's restaurants jointly | **Enforced but structural** — assumes one owner = one billing entity; no `organization` layer, so a restaurant cannot change hands or be co-managed | `schema.prisma:385` `userId @unique`; `getEffectiveLimitsForOwner` keys on user id |

## B. Ordering & event assumptions

| ID | Assumption | Enforced? | Evidence |
|---|---|---|---|
| CI-B1 | Lemon Squeezy `attributes.updated_at` is monotonic per subscription and trustworthy for ordering | **Relied on** — the ordering guard compares it; a malformed/NaN timestamp falls back to `new Date()` (treated as newest) | `subscription.service.ts:316-336` (`hasValidTimestamp` fallback applies the event) |
| CI-B2 | Distinct LS events never share an identical `updated_at` in a way that must both apply | **Assumed** — equal timestamps are applied (only strictly-older dropped); exact dupes filtered upstream by Redis idem key | `subscription.service.ts:328-334`, `webhook.routes.ts:97-108` |
| CI-B3 | Pub/sub and queue publishes may be lost without corrupting state (best-effort, fire-after-commit) | **By design** — both swallow errors; a lost event = a missed email/WS update, never a lost booking | `queue.ts:89-91`, `pubsub.ts:46-48`; publish happens after tx commit |
| CI-B4 | Reminder delayed jobs fire in a world where the reservation may have changed | **Handled** — worker re-checks `status==='SCHEDULED'` at send time | `notification.worker.ts:100` |
| CI-B5 | Queue publish rate cap (60/min/restaurant) never drops an event that had no alternate delivery | **Not guaranteed** — over-cap events are dropped silently (WS pub/sub is a separate best-effort channel) | `queue.ts:71-77` |

## C. State-transition assumptions

| ID | Assumption | Enforced? | Evidence |
|---|---|---|---|
| CI-C1 | Reservation status transitions follow a legal lifecycle (SCHEDULED→SEATED→COMPLETED, etc.) | **Partial** — each mutation checks the current status guard (e.g. seat requires SCHEDULED), but there is no single state-machine definition; guards are duplicated per function | `reservation.service.ts:968` (seat), `:1091` (no-show), `:1157` (extend), `:1228` (free-early) |
| CI-C2 | A row's DB status eventually reconciles to COMPLETED after `endsAt` | **Partial** — reconcile job runs every 5min with 12h grace; between `endsAt` and reconcile the DB is stale and only `deriveDisplayStatus` papers over it | `maintenance.worker.ts:47-55,93`; `reservation-engine.ts:24` |
| CI-C3 | `releasedAt` is set whenever a hold should stop blocking (cancel/no-show/free-early/complete) | **Partial** — set in those service paths and by the reconcile job's SQL; a status change that forgets to release would leave a phantom hold | `reservation.service.ts:832-835` (`releaseHolds`), `maintenance.worker.ts:60-68` |
| CI-C4 | `startsAt`/`endsAt` on `reservation_tables` stay in lockstep with the parent reservation | **Partial** — extend/free-early update both; no DB trigger enforces equality | `reservation.service.ts:1173-1178,1246-1249` |

## D. Transactional assumptions

| ID | Assumption | Enforced? | Evidence |
|---|---|---|---|
| CI-D1 | Side effects after a booking tx (cache invalidate, publish) are allowed to fail independently without rolling back the booking | **By design** — they run after commit, best-effort | `reservation.service.ts:762-782` |
| CI-D2 | Audit-log writes are non-critical (best-effort `.catch(()=>{})`) except inside booking tx | **Mixed** — booking/quota audit is inside the tx (`createReservationWithHolds`), but auth/admin audits are `.catch(()=>{})` | `reservation.service.ts:448-462` (in-tx) vs `auth.service.ts:227-238` (best-effort) |
| CI-D3 | The advisory lock `hashtext(ownerId)` never collides across different owners in a way that serializes unrelated bookings | **Assumed** — `hashtext` is 32-bit; a collision would serialize two owners' bookings (correctness-safe, throughput cost only) | `reservation.service.ts:403` |
| CI-D4 | Interactive tx budget (`maxWait 15s / timeout 20s`) is enough under contention | **Assumed** — a fully-booked scan + insert must finish inside 20s | `reservation.service.ts:91` |

## E. Deployment & infrastructure assumptions

| ID | Assumption | Enforced? | Evidence |
|---|---|---|---|
| CI-E1 | Schema is migrated **before** new code deploys (API never migrates at boot) | **External** — enforced by the deploy workflow order, not by code | `deploy-prod.yml` migrate step precedes `railway up`; `railway.json` start does not migrate |
| CI-E2 | Prod `DATABASE_URL` carries `?pgbouncer=true` | **Partial** — `check-env` blocks it, but only if `check-env` is run (it is, in prod deploy) | `check-env.ts:73-81`, `deploy-prod.yml` pre-deploy check |
| CI-E3 | Upstash `maxmemory-policy = noeviction` so deny-list/rate/idempotency keys are not evicted | **Partial/External** — `check-env` probes it and warns/errors; relies on operator setting it | `check-env.ts:83+` |
| CI-E4 | Exactly **one** API instance runs, OR the single-instance state (SI-1..SI-9) is acceptable | **Assumed** — WS per-IP cap and pub/sub listener map are per-instance; nothing enforces instance count | `websocket.ts:11`, `pubsub.ts:5`; documented in `worker.ts` and MASTER_PLAN §12/P3-7 |
| CI-E5 | Cloudflare fronts the origin so `CF-Connecting-IP` is trustworthy | **Partial** — only when `CF_ORIGIN_SECRET` set (prod-mandated by check-env); otherwise header trusted verbatim | `cloudflare.ts:30-36`, `cloudflareOnly.ts:28` (= carried H-1) |
| CI-E6 | The notification worker is deployed (in-process or standalone) so queued jobs are drained | **Assumed** — if `RUN_WORKER_IN_PROCESS=false` and no standalone worker runs, emails/reminders/reconcile never process; nothing verifies a consumer exists | `env.ts:40`, `index.ts:355-362`, `worker.ts` |
| CI-E7 | Migrations run via `directUrl` (session pooler / direct 5432), runtime via pooled 6543 | **External** — Prisma config expresses it; correctness depends on both URLs being set correctly | `schema.prisma:9-10` |

## F. Repository conventions (implicit, unenforced)

| ID | Convention | Enforced? | Evidence |
|---|---|---|---|
| CI-F1 | Modules follow `*.routes.ts` (HTTP+zod) → `*.service.ts` (logic) → `lib/*`/db; lib never imports modules | **Convention only** — no lint rule; currently holds | verified grep ([02](02-dependency-graph.md §1)) |
| CI-F2 | Every route validates body/query with a zod schema and returns 422 `{error, details}` on failure | **Convention** — hand-repeated per route; not centralized (no schema-driven router) | e.g. `reservation.routes.ts:52-57`; admin routes return terse `{error:'Validation failed'}` (`admin.routes.ts:194`) — inconsistent shape |
| CI-F3 | Errors thrown as `AppError` subclasses, mapped centrally; Prisma errors via `mapPrismaError` | **Partial** — `handleRouteError`/`setErrorHandler` handle it, but routes individually choose `handleRouteError` vs inline `if (err instanceof AppError)` | `handle-route-error.ts`, vs `auth.routes.ts:85-91` inline |
| CI-F4 | `@@map` snake_case table names; camelCase columns quoted in raw SQL | **Convention** — raw SQL hard-codes quoted identifiers matching Prisma `@map`/`@@map`; a rename would desync raw queries | `reservation-engine.ts:101-108` (`"reservation_tables"`, `"tableId"`) |
| CI-F5 | Redis keys are colon-namespaced strings coined at call sites (no central registry) | **Convention** — see HC-1; collisions unenforced | [02](02-dependency-graph.md §6) HC-1 |
| CI-F6 | `NODE_ENV==='test'` disables several security behaviors (lockout, threat detector) | **Convention** — scattered `if (process.env.NODE_ENV === 'test') return` | `threat-detector.ts:17,38`, `auth.service.ts:38,54,64` |
| CI-F7 | Deprecated `@deprecated` aliases are kept indefinitely for back-compat | **Convention** — DC-5..DC-8 | [02](02-dependency-graph.md §7) |

## G. Engine / domain assumptions

| ID | Assumption | Enforced? | Evidence |
|---|---|---|---|
| CI-G1 | `turn_time_rules` bands do not overlap; first match by `minPartySize asc` is deterministic | **No** — overlapping bands allowed; silent first-match | `reservation-engine.ts:150-159`; no overlap check on create (`restaurant.service.ts:1013-1036`) |
| CI-G2 | Availability step is globally 15 min | **Hardcoded** — `AVAILABILITY_STEP_MINS=15`, not per-restaurant | `reservation-engine.ts:11` |
| CI-G3 | Best-fit = smallest `maxPartySize` is the desired allocation for every restaurant | **Hardcoded** — no per-table priority | `reservation-engine.ts:81-91` |
| CI-G4 | Party size ≤ 50 everywhere it matters | **Partial** — API caps at 50 (`reservation.schema.ts:6`), DB CHECK only `>= 1` (`schema.prisma` reservation check), web UI caps lower | `reservation.schema.ts:6`, migration `20260705000000` party_size check |
| CI-G5 | Fee snapshots taken at booking time remain the correct displayed fee | **By design** — snapshot columns; later config changes don't retroactively alter booked fees | `reservation.service.ts:682-689` |
| CI-G6 | DST spring-forward local times resolve deterministically (two-pass offset), not rejected | **By design** — `zonedTimeToUtc` iterates twice; nonexistent times shift rather than error | `timezone.ts:52-57` (= carried P2-6 note) |
| CI-G7 | An empty weekly schedule means "closed", never "always open" | **Enforced at API** (min 1 window) but the **engine fallback** treats zero ServicePeriod rows as legacy-window open — so DB rows bypassing the API could re-enable always-open | `restaurant.schema.ts:163-169` (guard) vs `service-schedule.ts:56-64` (fallback) |

## H. Auth / session assumptions

| ID | Assumption | Enforced? | Evidence |
|---|---|---|---|
| CI-H1 | An access token remains valid for its full 15min unless logged out — password reset does not revoke live access tokens | **Not revoked** — reset deletes refresh rows only; access jti not denylisted | `auth.service.ts:494-511` (= carried M-3) |
| CI-H2 | A rotated refresh token presented again is merely invalid (no family compromise response) | **No reuse detection** — failed lookup → 401, no family revoke | `auth.service.ts:295-316` (= carried L-5) |
| CI-H3 | Admin TOTP codes are single-use within their window | **No** — `window:1`, no used-code cache; brief replay possible | `admin.service.ts:26,85` (= carried M-2/L-4) |
| CI-H4 | The refresh cookie (`__Host-refresh`) is the only durable credential and is always sent over HTTPS | **Enforced by cookie attrs** — `Secure` always true even in dev | `cookies.ts:5-11` |
| CI-H5 | Redis deny-list is authoritative for revocation; its unavailability must never grant access | **Enforced** — fail-closed 503 (INV-5) | `authenticate.ts:90-98` |

---

## Cross-reference index

- Confirmed/enforced invariants (the guaranteed ones): [01 §11](01-system-map.md) INV-1..INV-18.
- Single-instance assumptions in dependency terms: [02 §9](02-dependency-graph.md) SI-1..SI-9.
- Prior-review identifiers still open: [03 §E](03-ground-truth-reconciliation.md) (P0-3b/M-1, H-1, H-2, M-2, M-3, M-4, L-2, L-3, L-5, L-6, P2-3, P2-5, P2-7, P2-12, P2-13, P3-7, P3-8).
