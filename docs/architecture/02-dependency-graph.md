# 02 · Dependency Graph

*Built with Graphify (available and used): AST extraction over all code + LLM semantic
extraction over the docs/CI corpus. Export: `graphify-out/graph.json` (1981 nodes / 3893
edges / 159 communities after the 2026-07-19 living-layer incremental update; original
full build same day was 1853/3694/131), `graphify-out/graph.html`,
`graphify-out/GRAPH_REPORT.md` (graph health: OK — no dangling/collapsed edges). The
update added the guard suite + living specs and pruned the six retired documents.
Findings below were confirmed against source, not taken from the graph alone.
Regeneration protocol: [/AGENTS.md](../../AGENTS.md) §7.*

---

## 1. Layering model (API backend)

Intended layers, highest to lowest. Verified import directions with grep.

```
routes (modules/*/*.routes.ts)            HTTP + zod validation + error mapping
  → services (modules/*/*.service.ts)     business logic, transactions
      → lib/* + services/email.service    engine, cache, redis, jwt, queue, pubsub, email
          → @restaurant/db (prisma)       data access
          → @restaurant/types             shared types
external: env.ts, errors/*, plugins/*     cross-cutting
```

**Downward-only rule holds**: `apps/api/src/lib/*` and `apps/api/src/services/*` contain
**zero** imports from `modules/*` (verified: `grep -rn "modules/" apps/api/src/lib apps/api/src/services` → no matches). The dependency direction never inverts across the lib↔module boundary.

`@restaurant/db` imported by 30 files in `apps/api/src` — it is the shared data god-module
(expected; see god-nodes below).

---

## 2. Module dependency graph (backend)

Node = source file/symbol group; edge = import/call. Key edges:

```
index.ts ──registers──▶ {webhookRoutes, cloudflareOnlyPlugin, authenticatePlugin,
                          wsPlugin, authRoutes, restaurantRoutes, reservationRoutes,
                          subscriptionRoutes, feedbackRoutes, adminRoutes,
                          registerLocalLogoRoutes}
authenticatePlugin ──▶ lib/jwt, lib/redis, @restaurant/db, @restaurant/types
wsPlugin ──▶ lib/jwt, lib/redis, lib/pubsub, lib/cloudflare, @restaurant/db

auth.routes ──▶ auth.service ──▶ lib/{redis,jwt,logger}, services/email.service, errors, env
restaurant.routes ──▶ restaurant.service ──▶ lib/{reservation-engine, service-schedule,
                                             availability-cache, image-validation, r2-storage},
                                             modules/subscription/subscription.service  ◀── cross-module
reservation.routes ──▶ reservation.service ──▶ lib/{reservation-engine, service-schedule,
                                               timezone, queue, pubsub, availability-cache,
                                               notify-once, plan}, services/email.service,
                                               modules/subscription/subscription.service  ◀── cross-module
subscription.routes ──▶ subscription.service ──▶ lib/{lemon-squeezy, plan}, @restaurant/db, @restaurant/types
webhook.routes ──▶ lib/lemon-squeezy, subscription.service, lib/redis
admin.routes ──▶ admin.service ──▶ lib/{redis, jwt}, @restaurant/db
feedback.routes ──▶ feedback.service ──▶ @restaurant/db

reservation-engine ──▶ timezone, service-schedule, @restaurant/db
service-schedule ──▶ timezone, @restaurant/db
workers/notification.worker ──▶ lib/queue, services/email.service, lib/alert, @restaurant/db
workers/maintenance.worker ──▶ lib/queue, lib/alert, @restaurant/db
worker.ts (S4) ──▶ workers/{notification,maintenance}, lib/{store-warmup, alert, logger}, @restaurant/db
```

---

## 3. Cross-module dependencies (the only inter-domain edges)

Exactly **two** modules are depended on by others, both pointing at **subscription**:

| From | To | Symbols | Anchor |
|---|---|---|---|
| `reservation.service` | `subscription.service` | `assertOwnerCanOperate`, `getEffectiveLimitsForOwner` | `reservation.service.ts:11-14` |
| `restaurant.service` | `subscription.service` | `assertOwnerCanOperate`, `canOwnerOperateFromSubscription`, `getEffectiveLimitsForOwner` | `restaurant.service.ts:6-10` |
| `restaurant.routes` | `subscription.service` | `assertOwnerRestaurantPlanLimit` | `restaurant.routes.ts:17` |

`subscription.service` imports **no** other module (only `lib/*`, `@restaurant/db`,
`@restaurant/types`). Direction: everything → subscription; subscription → nothing.
**No module import cycles.** (Verified by inspecting every `modules/*` import list.)

`subscription.service` also **re-exports** `plan.ts` symbols (`PLAN_LIMITS`, `TRIAL_LIMITS`,
`getPlanLimits`, `PLAN_COMPARISON`, `TRIAL_DAYS`) and `billingTierLabel` — it is the domain
facade over `lib/plan.ts` (`subscription.service.ts:32-38,488`).

---

## 4. Detected cycles

- **No ES-module import cycles** in `apps/api/src` across modules or lib (each `lib/*` imports only lower or sibling utilities; `reservation-engine`↔`service-schedule` is one-directional: engine→schedule, schedule does not import engine — `service-schedule.ts` imports only `timezone` + db).
- Graphify surfaced only **INFERRED "indirect_call"** edges from API route functions to the SPA `request()` in `packages/api-client/src/client.ts` (`GRAPH_REPORT.md` Surprising Connections). These are **false-coupling artifacts** of same-named HTTP verbs across the client/server boundary, **not** real import edges — the API never imports `@restaurant/api-client` (verified: no such import in `apps/api`). Recorded so future readers do not mistake them for a cycle.

---

## 5. Cross-layer reach-ins & boundary observations

| Obs | Description | Anchor |
|---|---|---|
| B-1 | Routes read `request.emailVerified` (set by `authenticatePlugin`) directly for the verify-gate — a plugin→route data channel via request decoration | `plugins/authenticate.ts:9-13,107`; consumed `reservation.routes.ts:45`, `restaurant.routes.ts:90` |
| B-2 | `restaurant.routes` calls `assertOwnerRestaurantPlanLimit` (a subscription-service function) directly, i.e. a route reaching into another module's service without going through its own service | `restaurant.routes.ts:17,105` |
| B-3 | `reservation.service` reaches into `lib/plan.startOfCurrentMonth` directly (bypassing subscription facade) for the quota window | `reservation.service.ts:10,257` |
| B-4 | Test harness reaches past production composition: `buildTestServer` registers routes without `index.ts` middleware (no rate-limit/threat/onSend/WS) — behavioral gap between test and prod surfaces | `__tests__/helpers/server.ts:17-50` |
| B-5 | `index.ts` (composition root) imports from every module + many libs — expected god-node, but couples boot to all subsystems | `index.ts:16-35` |

No inappropriate downward reach-in was found (lib never imports modules; db never imports app).

---

## 6. Hidden coupling (non-import, runtime)

| HC | Coupling | Anchor |
|---|---|---|
| HC-1 | **Redis key namespace** is shared, uncoordinated string prefixes across ≥9 concerns: `deny:`, `login:fail:`/`login:locked:`, `threat:*`/`ban:`, `email_verify:`, `pwd_reset:`, `admin:totp:setup:`, `queue:rate:`, `notify:`, `restaurant:{id}:availability:*`/`:availver`, `ls-event:`. A collision or eviction couples unrelated subsystems. | `authenticate.ts:66`, `auth.service.ts:44,75,157,447`, `threat-detector.ts:5-10`, `admin.service.ts:67`, `queue.ts:66`, `notify-once.ts:20`, `availability-cache.ts:7-57`, `webhook.routes.ts:97` |
| HC-2 | `QUEUE_NAME` couples producer (`queue.ts`) and both workers; tests override to `booking_events_test` to avoid draining prod jobs | `env.ts:16`, `vitest.config.ts` (`QUEUE_NAME='booking_events_test'`) |
| HC-3 | Availability cache **key shape** must match between writer (`availability-cache.ts:12` `availabilityCacheKey`) and every reader (detail + search); a format drift silently misses | `availability-cache.ts:12`, read in `restaurant.service.ts:285,492` |
| HC-4 | Fee **snapshot** columns couple restaurant config at booking time to reservation display forever (`customFeeSnapshot`, `extraHourFeeSnapshot`, `feeCurrency`) | `schema.prisma:311-313`, written `reservation.service.ts:682-689` |
| HC-5 | `deriveDisplayStatus` (display) vs reconcile job (DB truth) both encode the same "past reservation is COMPLETED" rule — two sources that must agree | `reservation-engine.ts:24`, `maintenance.worker.ts:47-55` |
| HC-6 | Client/server share plan limits by **duplication**: `lib/plan.ts` (server) and `apps/dashboard/src/lib/plan-limits.ts` (client copy) | `lib/plan.ts:5`, dashboard copy (carried P2-13) |
| HC-7 | Hand-written `packages/types` must mirror Prisma enums/zod shapes; drift is possible (not generated) | `packages/types/src/index.ts` |

---

## 7. Dead / orphaned code candidates

| DC | Item | Anchor | Status |
|---|---|---|---|
| DC-1 | `packages/ui` — placeholder only, `echo 'not implemented yet'` scripts | `packages/ui/src/index.ts:1`, `packages/ui/package.json` | No source; imported by nothing |
| DC-2 | `packages/config` — no `package.json`, only `tsconfig.base.json` | `packages/config/` | Not a resolvable workspace package |
| DC-3 | `withUserContext` (RLS transaction helper) | `packages/db/src/index.ts:22` | Exported, **zero callers** in app/scripts (grep) |
| DC-4 | `clearNotificationMarkers` | `lib/notify-once.ts:54` | Exported, no in-app caller (grep) |
| DC-5 | Deprecated aliases: `publishBookingEvent`/`BookingEventType`/`BookingEventPayload` | `queue.ts:138-142` | Retained; no in-repo callers |
| DC-6 | `bookingChannel` alias | `pubsub.ts:35` | Retained; no in-repo callers |
| DC-7 | `sendBookingCreated`/`sendBookingConfirmed`/`sendBookingCancelled*` + `BookingEmailData` | `email.service.ts:24-25,288-306` | Retained; no in-repo callers |
| DC-8 | `listBookings` alias | `admin.service.ts:421` | Retained; `/admin/bookings` route (`admin.routes.ts:341`) still serves it |
| DC-9 | `rls_self_hosted_optional.sql`, `supabase_enable_extensions.sql` | `packages/db/sql/` | Not applied on Supabase (comment in `db/src/index.ts:20`) |

*(DC-5..DC-8 are intentionally-kept `@deprecated` shims, not accidental dead code — flagged for later triage, not removal here.)*

---

## 8. Unexpected dependency directions

| UD | Observation | Anchor |
|---|---|---|
| UD-1 | The **web/diner SPA** consumes `serviceWindows[]`, `bookable`, `offersCustomReservations` sent by the server — but PLATFORM_MASTER_PLAN §2.3 claims the diner UI ignores them. Server payload is present; client-consumption status is a frontend question, not evidenced in backend. Direction note only. | `restaurant.service.ts:410-416,505-511` |
| UD-2 | `admin` module reissues tokens via the **shared** `signAccessToken`/`signRefreshToken` and stores refresh rows through the same `refresh_tokens` table as user auth — admin auth is not a separate credential store | `admin.service.ts:144-159` |
| UD-3 | `webhook.routes` (billing edge) depends on `lib/redis` directly for idempotency, not through subscription.service | `webhook.routes.ts:2,102` |

No layering inversion (lib→module) exists.

---

## 9. Single-instance assumptions (each an anchor)

These are correctness-relevant if the API is ever run as >1 instance. All are in-process
state or in-process schedulers.

| SI | Assumption | Anchor | Mitigation present? |
|---|---|---|---|
| SI-1 | Per-IP WS connection counter is an **in-process Map** | `plugins/websocket.ts:11` `wsConnectionsByIp` | None — per-instance cap only |
| SI-2 | Pub/sub listener registry is an **in-process Map** + one shared subscriber connection | `lib/pubsub.ts:5-7` | Each instance subscribes independently; fan-out still works via Redis, but the Map is local |
| SI-3 | Prisma client is a **module-level singleton** (globalThis in non-prod) | `packages/db/src/index.ts:6-18` | Intended; pooling via PgBouncer |
| SI-4 | Redis client + `_connecting` promise are **module-level singletons** | `lib/redis.ts:5-7` | Coalescing is per-instance |
| SI-5 | BullMQ **queue** handle is a module singleton | `lib/queue.ts:38` | Fine multi-instance (Redis-backed) |
| SI-6 | Notification/maintenance **workers run in-process by default** (`RUN_WORKER_IN_PROCESS=true`) | `env.ts:40-43`, `index.ts:355-358` | Separable via `worker.ts` (S4); both tolerate multiple workers per `worker.ts:13-15` |
| SI-7 | Maintenance **job schedulers** upserted by every booting instance | `maintenance.worker.ts:118-124` | Idempotent by scheduler id → converges |
| SI-8 | Lazy dummy bcrypt hash cached module-level | `auth.service.ts:29-35` `_dummyHash` | Per-instance; harmless |
| SI-9 | In-memory rate limiter used in dev/test (Redis only in prod) | `index.ts:171` | Per-instance in non-prod by design |

**God nodes** (most-connected, from `GRAPH_REPORT.md`): `api` (client facade, 41),
`getRedisClient()` (27), `ApiError` (26), `assertOwnerCanOperate()` (24),
`buildServer()` (23), `restaurantRoutes()` (21), `assertRestaurantOwner()` (21) — the
Redis client and the operability/ownership assertions are the true backend hubs.

---

## 10. Graph provenance

- Extraction: `graphify` (uv tool). AST for `.ts`/`.js`/config; semantic subagent for
  22 changed doc/CI files. `.sql` files skipped (no `tree_sitter_sql`) — migrations were
  read manually instead (see [01](01-system-map.md §10-11)).
- One extraction warning: node `upstash_redis` missing `source_file` (a semantic concept
  node with no file anchor) — excluded from anchored claims here.
- Regenerate: `/graphify . --update` (incremental) or see the graphify skill.
