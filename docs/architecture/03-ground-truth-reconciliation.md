# 03 · Ground-Truth Reconciliation

*Every material documentation claim, classified against current code (branch `staging`,
2026-07-19). Legend: **Confirmed** · **Contradicted** · **Partially True** · **Unverifiable**.
Executable/source evidence is authoritative. Prior review identifiers (P0-x, P1-x, H-x, M-x,
L-x, R-x, VALIDATION #n, DEBUG iterations) are **preserved and carried forward**, not
re-derived.*

## Documents inventoried (read as claims, not fact)

| Doc | Date | Role |
|---|---|---|
| `PROJECT_CONTEXT.md` | ~2026-07-08 | Cross-session log (Cursor-maintained) |
| `PLATFORM_REVIEW.md` | 2026-07-09 | File-level system doc + P0–P3 audit |
| `SECURITY_REVIEW.md` | 2026-07-09 | Adversarial security review (H/M/L findings) |
| `PLATFORM_MASTER_PLAN.md` | 2026-07-10 (+07-11 log) | Strategy + R1–R21 + §2.3 working-tree status |
| `docs/ARCHITECTURE-AVAILABILITY.md` | 2026-07-10/11 | Availability & search design |
| `docs/R4-SERVICE-UX.md` | 2026-07-10 | Dashboard UX charter |
| `docs/VALIDATION-2026-07-11.md` | 2026-07-11 | Validation run (#1–#11 fixes) |
| `DEBUG_LOG.md` | 2026-07-12/13 | Stabilization iterations 0–4 |
| `LAUNCH_CHECKLIST.md` | — | **Superseded** (self-declared) |
| `LAUNCH_CHECKLIST_V2.md` | ~2026-07-18 | Live deploy guide |
| `maida-brand-guidelines.md` | 2026-07-10 | Brand (out of technical scope) |

---

## A. Cross-document contradictions — resolved

| # | Contradiction | Resolution (authority = code) | Anchor |
|---|---|---|---|
| X-1 | **Local dev/test infra**: PROJECT_CONTEXT §0/§1 says local dev uses hosted Supabase+Upstash ("Docker not available", "preferred going forward"); LAUNCH_CHECKLIST_V2 §2.1 + docker-compose say local dev/test run against **Docker only** | **Docker is current.** `docker-compose.yml` defines `postgres:16-alpine`+`redis:7-alpine`; `vitest.config.ts` loads `.env.test` and hard-gates `TEST_DATABASE==='true'`; CI uses service containers. PROJECT_CONTEXT is stale on this point. | `docker-compose.yml`, `apps/api/vitest.config.ts:23-38`, `.github/workflows/ci.yml` services |
| X-2 | **EXPIRED subscription policy**: PLATFORM_REVIEW P1-5 & MASTER_PLAN §11 call the free-Starter fallback a bug/"reject"; DEBUG_LOG Iteration 1 records the user **decided** graceful Starter fallback is intended | **Starter fallback is intended (current code).** `EXPIRED → canOperate:true`, Starter limits. Prior "reject" recommendations are superseded by the recorded decision. | `subscription.service.ts:100-107,172-194`, `DEBUG_LOG.md` Iteration 1 decision |
| X-3 | **CI can run tests**: PLATFORM_REVIEW §9/P2-10 says CI has no DATABASE_URL and tests "cannot pass"; VALIDATION #4 says both deploy workflows were fixed to provision ephemeral Postgres/Redis | **CI now provisions stores (current).** `ci.yml`, `deploy-staging.yml`, `deploy-prod.yml` all define `services: postgres/redis`, migrate, and run `pnpm test` with `TEST_DATABASE=true`. PLATFORM_REVIEW predates the fix. | `.github/workflows/ci.yml`, `deploy-staging.yml`, `deploy-prod.yml` |
| X-4 | **Weekly schedule / closed days**: PLATFORM_REVIEW P0-5 says the model has one window for all 7 days, no closed days, no overnight; MASTER_PLAN §2.3 says Phase 17 shipped `service_periods`/`restaurant_closures` | **Phase 17 shipped (current).** Tables + engine + server-side window check exist. PLATFORM_REVIEW P0-5 predates Phase 17. | migration `20260709000000_service_schedule_and_ls_updated_at`, `service-schedule.ts`, `reservation.service.ts:649-673` |
| X-5 | **`lsUpdatedAt` webhook ordering**: MASTER_PLAN §2.3 "half-done: column migrated but no code reads/writes it"; §Execution-log R1 "wired… test-covered" | **Wired (current).** Read+written in the upsert transaction; older events dropped. §2.3 predates the R1 execution-log entry. | `subscription.service.ts:320-360`, `schema.prisma:404` |
| X-6 | **Frontend 15-min session death**: MASTER_PLAN §2.3 "❌ Untouched — still the worst live bug"; Execution-log R2 "The 15-minute session death is fixed" | **Session refresh shipped (current) in shared client.** Single-flight refresh, proactive timer, focus recovery, 401→refresh→retry. §2.3 table predates R2. (Per-SPA WS-4001 reconnect not verified here — backend only.) | `packages/api-client/src/session.ts`, `client.ts:111-118` |
| X-7 | **Admin plan override sets status**: PLATFORM_REVIEW P1-7 & MASTER_PLAN say override only writes `plan`, not `status`; MASTER_PLAN R1 says fixed | **Fixed (current).** Upsert sets `status:'ACTIVE'` on comp. | `admin.service.ts:347-351` |
| X-8 | **`load-test.ts` targets retired model**: VALIDATION #10 says it was dead code, then rewritten; PLATFORM_REVIEW §9 says it references SELECT-FOR-UPDATE | **Rewritten (current).** Header comment describes the exclusion-constraint race test. | `scripts/load-test.ts` (header), `docs/ARCHITECTURE-AVAILABILITY.md §6` |
| X-9 | **Search availability caching**: PLATFORM_REVIEW P1-2 says search runs uncached ~100×3 queries; ARCHITECTURE-AVAILABILITY §4 says a 5-gate cache-first pipeline shipped | **Cache-first pipeline shipped (current).** 5 gates, bounded concurrency 6, cap 100. P1-2 predates R15. | `restaurant.service.ts:186-353` |
| X-10 | **`@fastify/websocket` version**: PROJECT_CONTEXT §3-log says `@fastify/websocket@^10` for Fastify 4; actual dep is `^11` and Fastify `^5.3.3` | **Fastify 5 + `@fastify/websocket@^11` (current).** PROJECT_CONTEXT log line is stale. | `apps/api/package.json` |
| X-11 | **Trial limits**: PLATFORM_REVIEW §6 table shows TRIAL = 25 res/mo, 5 tables (stricter than Starter); MASTER_PLAN/plan.ts say trial = full PRO | **Trial = full PRO (current).** `TRIAL_LIMITS = PLAN_LIMITS.PRO`. PLATFORM_REVIEW table predates the change. | `lib/plan.ts:42` |
| X-12 | **Auth on infra failure returns 401**: PLATFORM_REVIEW P0-2 & §4 say Redis error → 401; MASTER_PLAN §2.3 "Auth returns 503… ✅ Done" | **503 (current).** Fail-closed with bounded retry. P0-2/§4 predate the change. | `authenticate.ts:90-98` |
| X-13 | **Walk-in ghost email to `guest@walk-in.local`**: PLATFORM_REVIEW P2-2; MASTER_PLAN §2.3 "walk-in ghost emails removed ✅" | **Removed (current).** Diner email skipped when `dinerEmail` null; `dinerEmail` is `diner?.email ?? null`. | `notification.worker.ts:50`, `email.service.ts:119-121,172` |

---

## B. Claim reconciliation by document

### B.1 PROJECT_CONTEXT.md

| Claim | Class | Anchor / evidence |
|---|---|---|
| Monorepo pnpm+Turbo, Fastify API + 3 React SPAs + shared packages | Confirmed | `pnpm-workspace.yaml`, `apps/*`, `packages/*` |
| GiST EXCLUSION on `reservation_tables` prevents overlaps (23P01) | Confirmed (INV-1) | migration `20260705120000` |
| `user_id` always from verified JWT, never body | Confirmed | routes read `request.user!.sub` throughout; body never supplies user id |
| Auth = RS256 access (15min) + refresh (7d) | Confirmed | `jwt.ts:6-7`; TTLs `ACCESS…=15*60`, `REFRESH…=7*24*60*60` |
| "Services communicate over **mTLS**; gateway never touches DB" | Contradicted | Single Fastify process talks to Postgres directly (`@restaurant/db`); no gateway, no mTLS, no service mesh. Aspirational/inaccurate. |
| "Optimistic locking" for reservations | Contradicted | Concurrency is the **GiST exclusion constraint**, not optimistic locking (no version columns). `reservation-engine.ts:isExclusionViolation` |
| Local dev DB = Supabase; Redis = Upstash ("Docker unavailable") | Contradicted (see X-1) | Docker-only now (`docker-compose.yml`) |
| Availability cache "invalidated synchronously after every reservation state change" | Partially True | Reservation mutations invalidate per-date (`invalidateAvailabilityCache`); **config** mutations use version bump, not per-date delete (`availability-cache.ts:64`). Broader than "synchronous delete". |
| Phase status table (Phases 1–16 all ✅) | Partially True | Feature presence largely Confirmed, but §8/§log lines contain stale specifics (X-10, X-11, and `123 Vitest tests` / `169 tests` counts — DEBUG_LOG Iteration 3 shows 187). |
| API surface table (§5) | Confirmed (spot-checked) | Every listed route exists (e.g. `/reservations/:id/free-early` `reservation.routes.ts:258`, `/admin/bookings` `admin.routes.ts:341`) |
| Env-var table (§7) lists `SUPABASE_URL/ANON/SERVICE_ROLE_KEY` as vars | Contradicted | Not in `env.ts` schema (`env.ts:3-50`); not read anywhere. `.env.example` also omits them. Stale. |
| "123/169 tests" (various log lines) | Contradicted | Current static suite is larger; DEBUG_LOG Iteration 3 = **187** (`DEBUG_LOG.md:128`); static count of `it()` in api = 170 across 11 files (this review). |

### B.2 PLATFORM_REVIEW.md (Part 1 doc + Part 2 audit)

Part 1 file-level claims — **Confirmed** where re-verified: token model (§4), engine
mechanics (§5), Redis's many concerns (§7), plan tiers structure (§6), admin auth (§4).

Part 2 audit findings — status **as of today** (carry identifiers forward):

| ID | Original finding | Current status | Anchor |
|---|---|---|---|
| P0-1 | SPA session dies at 15min (no refresh/retry) | **Resolved** (backend+client) | `packages/api-client/session.ts`, `client.ts:111` |
| P0-2 | Redis outage → 401 logs everyone out | **Resolved** → 503 fail-closed + retry | `authenticate.ts:90-98` |
| P0-3 | Cross-tenant `tableIds` via walk-in | **Resolved** for create path via `assertTablesBelongToRestaurant` | `reservation.service.ts:312-323,503` |
| P0-3b | Staff `dinerId` accepts any UUID | **Open (Partially)** — still `z.string().uuid().optional()`, no role/relationship check | `reservation.schema.ts:73`, `reservation.service.ts:1350` (carried M-1) |
| P0-4 | Email shows server-tz time | **Resolved** — restaurant-tz + label | `email.service.ts:35-46` |
| P0-5 | No weekly schedule / server window check | **Resolved** (Phase 17) | migration `20260709000000`, `reservation.service.ts:649-673` |
| P0-6 | Reservation abuse / quota burn | **Mostly resolved** — horizon/overlap/active-cap + CANCELLED/NO_SHOW excluded from quota + email-verify gate; per-diner-per-restaurant window not separately capped | `reservation.service.ts:39-42,193,270-309`, `reservation.routes.ts:45` |
| P0-7 | Concurrent refresh → 500/logout | **Resolved** — race-safe rotation | `auth.service.ts:311-316` |
| P1-1 | Suggestion scan = thousands of queries | **Resolved** — 1 occupancy query/day, in-memory walk, 14-day cap | `reservation-engine.ts:203-265,372-397` |
| P1-2 | Search fan-out uncached | **Resolved** — 5-gate cache-first | `restaurant.service.ts:186-353` |
| P1-3 | Owner list 20-oldest, browser-tz, no walk-in UI | **Backend-enabled** (date filter, limit 100, rawStatus); UI status is frontend-scope | `reservation.schema.ts:54-63`, `reservation.service.ts:920-928` |
| P1-4 | IP spoofable; per-IP limits | **Partially open** — `getRealIp` requires `x-cf-origin-secret` **only when** `CF_ORIGIN_SECRET` set; `check-env` mandates it in prod | `cloudflare.ts:30-36`, `check-env.ts:61-67` (carried H-1) |
| P1-5 | Trial expiry strands reservations; churned-paid free | **Changed by decision** — lifecycle mgmt ungated (`assertOwnerAccess` ownership-only), EXPIRED=Starter fallback intended (X-2) | `reservation.service.ts:358-368`, `subscription.service.ts:172-194` |
| P1-6 | No monitoring/alerting; worker in API process | **Partially resolved** — `reportCriticalError` + `ALERT_WEBHOOK_URL`; worker separable via `RUN_WORKER_IN_PROCESS`; external Sentry/uptime still absent in code | `lib/alert.ts`, `env.ts:40`, `worker.ts` |
| P1-7 | Webhook ordering + admin status | **Resolved** — `lsUpdatedAt` guard + admin status | `subscription.service.ts:328-334,347-351` |
| P1-8 | Malformed IDs → 500 | **Partially resolved** — `mapPrismaError` maps P2023→400, P2002→409, etc.; no explicit UUID param schema on routes | `lib/handle-route-error.ts:16-44`; routes still `params as {id}` |
| P1-9 | Client/server disagree on custom reservations | **Resolved (server side)** — authoritative `offersCustomReservations` (plan ∧ `maxExtraHours>0`) | `restaurant.service.ts:411-413` |
| P1-10 | PgBouncer prepared-statement risk | **Guarded** — `check-env` blocks 6543 without `pgbouncer=true` | `check-env.ts:73-81` |
| P1-11 | Check-then-act quota races | **Resolved for reservations** (advisory lock, INV-8); restaurant/table/combination limits still check-then-act | `reservation.service.ts:403`; `restaurant.service.ts:107,126,150` (still count-then-create) |
| P2-1 | Status filters lie after `endsAt` | **Resolved** — reconcile job (5min) writes COMPLETED | `maintenance.worker.ts:47-55,93` |
| P2-2 | Walk-in ghost emails | **Resolved** (X-13) | `notification.worker.ts:50` |
| P2-3 | No booking idempotency key | **Open** — no idempotency-key header; overlap guard partially covers | `reservation.routes.ts:23` (carried) |
| P2-4 | Unbounded refresh_tokens/audit_logs/holds | **Resolved** — purge + prune + hold-release jobs | `maintenance.worker.ts:73-96` |
| P2-5 | Bcryptjs on event loop | **Open (accepted)** — still `bcryptjs` | `apps/api/package.json` |
| P2-6 | Booking scan uses browser-UTC dates | **Open (frontend)** — backend not authoritative here | web SPA (out of backend scope) |
| P2-7 | Combinations can include inactive tables | **Open** — `loadBookableUnits` filters combos by `isActive:true` at combination level but not by member-table active state | `reservation-engine.ts:55-74` (carried) |
| P2-8 | Adjacent-day cache invalidation miss | **Resolved** — invalidates start+end date | `reservation.service.ts:107-113` |
| P2-9 | WS token in query string / WS URL from `window.location` | **Partially open** — token still `?token=`; WS URL now derives from `getApiBaseUrl` | `websocket.ts:36`, `packages/api-client/ws.ts:8-20` (carried H-2) |
| P2-10 | CI can't run tests | **Resolved** (X-3) | `ci.yml` services |
| P2-11 | Register→login double rate-limit | **Resolved (server)** — register no longer auto-logins server-side (returns 201 `{user}` only) | `auth.routes.ts:84`; party-size cap 50 vs UI 20 remains (`reservation.schema.ts:6`) |
| P2-12 | CORS disallowed origin → 500 | **Open** — `cb(new Error('Not allowed by CORS'))` still | `index.ts:144` (carried) |
| P2-13 | Plan data duplicated client-side | **Open** — `apps/dashboard/src/lib/plan-limits.ts` still exists | (carried, HC-6) |
| P3-1 | No reminder emails | **Resolved** — day-of reminder (24h/2h) + ICS | `queue.ts:106-136`, `email.service.ts:255` |
| P3-4 | Emails lack .ics/address | **Resolved** — ICS attachment + address in reminder | `email.service.ts:81-105,262` |
| P3-7 | In-process maps / single-instance | **Open (documented)** — SI-1..SI-9 in [02](02-dependency-graph.md §9) |
| P3-8 | Dead-code residue | **Open** — DC-1..DC-9 in [02](02-dependency-graph.md §7) |

### B.3 SECURITY_REVIEW.md (carry H/M/L identifiers)

| ID | Finding | Current status | Anchor |
|---|---|---|---|
| H-1 | Client-controlled source IP | **Partially mitigated** — `getRealIp` gated by `x-cf-origin-secret` when secret set; `check-env` mandates secret in prod; `trustProxy:true` still unconditional | `cloudflare.ts:24-38`, `index.ts:83`, `check-env.ts:61` |
| H-2 | WS token in URL, logged | **Open** — token still in query; pino redaction does not cover query string | `websocket.ts:36`, `logger.ts:5-19` |
| M-1 | Owner can attach `dinerId` to any user | **Open** | `reservation.schema.ts:73` |
| M-2 | Admin 2FA self-enroll + TOTP replay | **Open** — self-enroll path present; `window:1` no used-code cache; TOTP setup route unthrottled | `admin.service.ts:61-101,120` (`admin.routes.ts:120` no rate-limit block) |
| M-3 | Password reset doesn't denylist access tokens | **Open** — reset deletes refresh tokens only | `auth.service.ts:494-511` |
| M-4 | Rate-limit/abuse controls fail open | **Open (by design)** — `skipOnError:true`; lockout/threat swallow Redis errors | `index.ts:170`, `threat-detector.ts:31`, `auth.service.ts:48` |
| M-5 | Unauth availability-search amplification | **Mitigated** — cache-first + concurrency-bounded (P1-2 fix); no dedicated per-search rate limit | `restaurant.service.ts:186-353` |
| L-1 | Email HTML injection | **Resolved** — `htmlEscape` on owner-controlled fields | `email.service.ts:63-70,130` |
| L-2 | No DB-level tenant isolation (RLS unused) | **Open** — `withUserContext` unused, RLS not applied | `db/src/index.ts:20-22` |
| L-3 | CORS allows no-Origin | **Open** — `if (!origin || …) cb(null,true)` | `index.ts:141` |
| L-5 | No refresh-token family reuse detection | **Open** — rotated token fails lookup, no family revoke | `auth.service.ts:295-316` |
| L-6 | `/health` exposes `environment`; prod error leaks message | **Open** — health returns `environment` (`index.ts:69,285`); prod error handler returns `err.message` for statusCode-bearing errors (`:311-315`) |
| L-7 | `.env` in working tree | Unverifiable here (not in git per `.gitignore`; history not audited) | `.gitignore` tracks only `*.env.example` |
| "Solid" section (double-booking, SQL param, JWT, cookies, ownership, webhook HMAC, file upload) | Confirmed | corresponding anchors in [01](01-system-map.md §11) |

### B.4 docs/ARCHITECTURE-AVAILABILITY.md

| Claim | Class | Anchor |
|---|---|---|
| Engine + exclusion constraint is the only source of truth; caches advisory | Confirmed | `reservation-engine.ts`, migration `20260705120000` |
| Full-response versioned cache, TTL 300s, per-date index set | Confirmed | `availability-cache.ts:4,26-42,82-101` |
| Two invalidation channels (per-date delete; version INCR) | Confirmed | `availability-cache.ts:64,175-194` |
| Billing never cached (live joined-row math) | Confirmed | `restaurant.service.ts:487-490,494` |
| 5-gate search pipeline, warm ≈ 3 queries + 1 MGET, concurrency 6, cap 100 | Confirmed | `restaurant.service.ts:186-353` |
| Empty weekly schedule rejected (min 1 window) | Confirmed | `restaurant.schema.ts:163-169` |
| Load test rewritten against engine (§6) | Confirmed | `scripts/load-test.ts` header |
| "Warm search cost 3 DB queries" vs MASTER_PLAN "~5 DB queries" | Partially True (self-inconsistent across docs) | Code: candidates(1) + final findMany + count in one `$transaction` (`restaurant.service.ts:386`) ⇒ effectively 2 statements + 1 MGET on full warm; "3" is the closer figure. Both are order-of-magnitude correct. |

### B.5 docs/VALIDATION-2026-07-11.md — findings #1–#11

All eleven fixes **Confirmed present** in code:

| # | Fix | Anchor |
|---|---|---|
| #1 | onSend async returns payload | `index.ts:215-224` |
| #2 | P2025 graceful skip in worker | `notification.worker.ts:70-81` |
| #3 | `QUEUE_NAME=booking_events_test` in tests | `vitest.config.ts` |
| #4 | Deploy workflows run real suite | `deploy-staging.yml`, `deploy-prod.yml` |
| #5 | Migration step before deploy | `deploy-*.yml` migrate steps |
| #6 | `check-env` promise-chained | `check-env.ts` (no top-level await) |
| #7 | Redis test mock completed | (test-file; behavior confirmed by suite passing) |
| #8 | Package `turbo.json` empty outputs | `packages/ui/turbo.json` |
| #9 | `/webhooks/*` exempt from IP limit | `index.ts:60-63,160-163` |
| #10 | load-test rewritten | `scripts/load-test.ts` |
| #11 | `cloudflareOnly` constant-time compare | `cloudflareOnly.ts:6-11` |

VALIDATION §3 (e2e failures were harness artifacts, not defects) — **Unverifiable from
source** (depends on live-run state); the two named root causes (concurrent suites;
hot-reload) are plausible and self-consistent with `cleanupE2eData` design.

### B.6 DEBUG_LOG.md (iterations 0–4)

| Claim | Class | Anchor |
|---|---|---|
| Redis coalescing fix (`ensureRedisConnected` one `_connecting` promise) | Confirmed | `redis.ts:99-129` |
| Bounded revocation retry (2×, 100ms) | Confirmed | `authenticate.ts:19-20,63-88` |
| Starter fallback on EXPIRED | Confirmed | `subscription.service.ts:172-194` |
| Party-size search cap 50 (test changed 999→50) | Confirmed | `restaurant.schema.ts:25` |
| web vitest timeouts 20s | Confirmed | `apps/web/vite.config.ts` |
| "187 passed" final | Unverifiable statically (not run here); static `it()` count api=170 + web 9 + api-client suite ≈ consistent order | `DEBUG_LOG.md:128` |
| `bullmq` mock lacks `Queue` export (test noise) | Plausible/Unverifiable here | noted as known non-blocking |

### B.7 LAUNCH_CHECKLIST.md vs LAUNCH_CHECKLIST_V2.md

- **X-14**: V1 self-declares superseded by V2 (`LAUNCH_CHECKLIST.md` top banner). V1's local-infra and deploy-flow sections are **Contradicted** by V2 + code (Docker-only; Railway 1-project/2-env; `staging→main` promotion). V2 is authoritative for deploy intent.
- V2 architecture table (Railway 1 project/2 env, Vercel 3 projects, Docker local) — **Confirmed against config**: `railway.json` (single service `api`), deploy workflows (per-app Vercel), `docker-compose.yml`. Vendor-side counts (project existence) are **Unverifiable from source**.
- V2 "PHASE 0 · three deploy defects" — the described fixes are **present**: root-context `railway up --service api` (`deploy-*.yml`), root `railway.json` with `prisma generate`, admin deploy step in prod only (`deploy-prod.yml`). So the checklist's Phase-0 "to fix" items are already **done in code**.

---

## C. Within-document contradictions — resolved

| # | Doc | Internal conflict | Resolution |
|---|---|---|---|
| W-1 | PLATFORM_MASTER_PLAN | Execution-log (top) says R1/R2/R15 done; §2.3 table says the same items ❌/half-done | The §2.3 table is a **frozen pre-commit snapshot** (states "uncommitted Phase 17 working tree"); the execution log is the later same-day update. **Execution log + code win** (X-5, X-6, X-9). |
| W-2 | PROJECT_CONTEXT | §1 "local dev uses Supabase+Upstash… preferred going forward" vs §0 "Redis (Upstash or local Docker for dev)" | Both stale relative to Docker-only; the "preferred going forward" line is the more wrong one (X-1). |
| W-3 | PLATFORM_REVIEW | §6 marks EXPIRED fallback `[inferred intentional but contradicts trial — worth confirming]`, P1-5 calls it a bug to fix | Confirmation happened later (DEBUG_LOG Iteration 1): intended. The inline "worth confirming" is now resolved. |
| W-4 | PROJECT_CONTEXT | test-count lines vary (123 / 146 / 169) across the log | All are historical snapshots; none is current. Latest recorded elsewhere is 187 (DEBUG_LOG). Treat all counts as non-authoritative. |
| W-5 | PLATFORM_REVIEW §9.2 vs P0-5 | §9.2 says Phase-17 window enforcement is server-side ✅ while P0-5 (same doc) says API never checks the window | §9.2 reflects post-Phase-17; P0-5 is the pre-Phase-17 audit entry. Code confirms server-side check exists (X-4). |

---

## D. Unverifiable claims (require live infra or vendor state)

| Claim | Why unverifiable | Doc |
|---|---|---|
| Test/e2e pass counts (156/181/187/25) | Requires running the suite against live/Docker stack | VALIDATION, DEBUG_LOG |
| e2e failures were harness artifacts | Depends on runtime state at the time | VALIDATION §3 |
| Vendor resource existence (Railway project, Vercel projects, Supabase/Upstash instances, LS store) | External to repo | LAUNCH_CHECKLIST_V2 |
| Upstash eviction policy is `noeviction` | Runtime probe only (`check-env` checks it live) | check-env |
| Whether `.env` ever entered git history | Requires full history audit | SECURITY_REVIEW L-7 |
| Whether the diner SPA actually consumes `serviceWindows[]`/`bookable` | Frontend runtime (backend sends them) | MASTER_PLAN §2.3, UD-1 |

---

## E. Net reconciliation summary

- The **strategy/audit docs (PLATFORM_REVIEW, SECURITY_REVIEW, older MASTER_PLAN §2.3)
  describe a pre-Phase-17 / pre-stabilization codebase.** A large fraction of their P0/P1
  findings are **resolved in current code** (X-2..X-13, most of B.2/B.3). Their forward
  value is the **still-open** items, carried above with original IDs: P0-3b/M-1, P1-4/H-1,
  H-2, M-2, M-3, M-4, L-2, L-3, L-5, L-6, P2-3, P2-5, P2-7, P2-12, P2-13, P3-7, P3-8.
- The **design docs (ARCHITECTURE-AVAILABILITY, R4-SERVICE-UX) and VALIDATION/DEBUG_LOG
  match current code** almost entirely.
- **PROJECT_CONTEXT is the least reliable**: it carries genuinely inaccurate architecture
  claims (mTLS, optimistic locking, `SUPABASE_*` env vars) and stale infra/test-count
  lines. Prefer this architecture area over it.
