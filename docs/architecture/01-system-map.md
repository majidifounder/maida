# 01 · System Map

*Source-anchored. Authority = code on branch `staging`, 2026-07-19. Anchors are
`path:line`/`path:symbol`/migration/env-key/test-name.*

---

## 1. Subsystem inventory

| # | Subsystem | Root | Runtime | Entry anchor |
|---|---|---|---|---|
| S1 | API server | `apps/api` | Long-lived Node/Fastify 5 | `apps/api/src/index.ts:79` `buildServer`; `:321` `start`; `:373` `void start()` |
| S2 | Notification worker | `apps/api/src/workers/notification.worker.ts` | BullMQ Worker | `startNotificationWorker` (`:127`) |
| S3 | Maintenance worker | `apps/api/src/workers/maintenance.worker.ts` | BullMQ Worker + job scheduler | `startMaintenanceWorker` (`:105`) |
| S4 | Standalone worker process | `apps/api/src/worker.ts` | Node process (S2+S3 only) | `start` (`:17`) |
| S5 | Reservation engine (lib) | `apps/api/src/lib/reservation-engine.ts`, `service-schedule.ts`, `service-hours.ts`, `timezone.ts` | In-process pure/DB logic | — |
| S6 | Auth subsystem | `apps/api/src/modules/auth/*`, `plugins/authenticate.ts`, `lib/jwt.ts`, `lib/cookies.ts` | In-process | `authRoutes` (`auth.routes.ts:21`) |
| S7 | Restaurant/config subsystem | `apps/api/src/modules/restaurant/*` | In-process | `restaurantRoutes` (`restaurant.routes.ts:21`) |
| S8 | Reservation subsystem | `apps/api/src/modules/reservation/*` | In-process | `reservationRoutes` (`reservation.routes.ts:16`) |
| S9 | Subscription/billing subsystem | `apps/api/src/modules/subscription/*`, `lib/lemon-squeezy.ts`, `lib/plan.ts` | In-process + external LS API | `subscriptionRoutes` (`subscription.routes.ts:25`), `webhookRoutes` (`webhook.routes.ts:34`) |
| S10 | Admin subsystem | `apps/api/src/modules/admin/*` | In-process + TOTP | `adminRoutes` (`admin.routes.ts:29`) |
| S11 | Feedback subsystem | `apps/api/src/modules/feedback/*` | In-process | `feedbackRoutes` (`feedback.routes.ts:7`) |
| S12 | Email service | `apps/api/src/services/email.service.ts` | Resend SDK | `sendEmail` (`:107`) |
| S13 | WebSocket live feed | `apps/api/src/plugins/websocket.ts` | In-process WS + Redis sub | `wsPlugin` (`:14`) |
| S14 | Object storage (logos) | `apps/api/src/lib/r2-storage.ts`, `lib/local-logo-routes.ts` | R2 (S3 SDK) or local disk | `uploadRestaurantLogo` (`:69`) |
| S15 | Data package | `packages/db` | Prisma 5 client singleton | `packages/db/src/index.ts:6` `prisma` |
| S16 | Shared types | `packages/types/src/index.ts` | Hand-written TS | — |
| S17 | Shared API client | `packages/api-client/src/{client,session,ws}.ts` | Browser fetch/WS wrapper | `api` (`client.ts:123`) |
| S18 | Diner SPA | `apps/web` | React 18 + Vite | `apps/web/src/main.tsx` |
| S19 | Owner SPA | `apps/dashboard` | React 18 + Vite | `apps/dashboard/src/main.tsx` |
| S20 | Admin SPA | `apps/admin` | React 18 + Vite | `apps/admin/src/main.tsx` |
| S21 | Operational scripts | `scripts/*` | tsx CLIs | `check-env.ts`, `db-migrate.ts`, `e2e/run.ts`, `load-test.ts`, backup/restore, `dev-data-reset.ts`, `promote-admin.ts` |
| S22 | Empty placeholders | `packages/ui`, `packages/config` | none | `packages/ui/src/index.ts:1` (comment only); `packages/config` has only `tsconfig.base.json` |

**Undocumented-vs-code note:** `packages/ui` has a `package.json` + `turbo.json` with
`echo 'not implemented yet'` build/dev scripts (`packages/ui/package.json`); `packages/config`
has **no** `package.json` (not a workspace member despite `pnpm-workspace.yaml:packages/*`).

---

## 2. Request lifecycle — global middleware chain (S1)

Ordering is load-bearing; registration order in `apps/api/src/index.ts:buildServer`:

1. **Raw-HTTP `/health`** — `serverFactory` answers `GET /health` before Fastify routing so it can never hang on Redis/hooks (`index.ts:88-97`, `sendLiveness` `:65`).
2. `helmet` strict CSP + HSTS preload (`:111-136`).
3. `cors` — allowlist from `CORS_ORIGIN`; `!origin` is allowed; disallowed origin → `cb(new Error(...))` (`:138-149`).
4. `cookie` (`:151`).
5. `rateLimit` — global 100/min, `keyGenerator: getRealIp`, allowlist = load-test|health|webhook, `skipOnError:true`, Redis backing **only** when `NODE_ENV==='production'` (`:155-172`).
6. `sensible` (`:174`), `multipart` fileSize `MAX_LOGO_BYTES` / 1 file (`:175-177`).
7. `onRequest` — blocked-UA regex list → 403 (`:37-45`, `:180-185`).
8. `onRequest` — extended IP ban check `isExtendedBanned` → 429 (skips health) (`:187-198`).
9. `onResponse` — threat-signal recorder on 401/403/404 (`:201-207`).
10. `onSend` — **async, returns payload** (contract-critical; a prior sync version hung every response, `index.ts:210-224`, cross-ref VALIDATION-2026-07-11 #1) — adds Permissions-Policy, removes X-Powered-By, adds X-Request-Id.
11. `preHandler` — method-override header block → 400 (`:227-238`).
12. Route plugins registered in order: `webhookRoutes`, `cloudflareOnlyPlugin`, `authenticatePlugin`, `registerLocalLogoRoutes`, `wsPlugin`, `authRoutes`, `restaurantRoutes`, `reservationRoutes`, `subscriptionRoutes`, `feedbackRoutes`, `adminRoutes` (`:240-250`).
13. `/.well-known/security.txt` (`:253`), `/health/ready` DB+Redis (`:260`), `setErrorHandler` (`:290`).

**Per-route auth**: `preHandler:[fastify.authenticate, fastify.requireRole(role)]` decorators from `authenticatePlugin` (`plugins/authenticate.ts:23,113`).

---

## 3. Request lifecycle by subsystem

### S6 Auth (`modules/auth`)
- **register** `POST /auth/register` → rate-limit 3/h/IP keyed `register:{getRealIp}` (`auth.routes.ts:26-31`) → `RegisterSchema` (`auth.schema.ts:3`) → optional Turnstile if `CLOUDFLARE_TURNSTILE_SECRET_KEY` set (`:42-75`) → `registerUser` (`auth.service.ts:81`): unique-email check → bcrypt(`env.BCRYPT_ROUNDS`) → `prisma.user.create` (owner also creates `subscription{TRIALING, STARTER, trialStartedAt:now}`) → audit `USER_REGISTERED` → best-effort `issueEmailVerification` (Redis `email_verify:{token}` 24h + Resend). Response 201 `{user}`. **No auto-login server-side.**
- **login** `POST /auth/login` → rate-limit 5/15min/IP (`:99-112`) → `loginUser` (`auth.service.ts:203`): lockout check (Redis, skipped in test) → **constant-time bcrypt** vs dummy hash when user absent (`:217-219`) → audit → `issueTokenPair` → set `__Host-refresh` cookie + return access token in **body** (`auth.routes.ts:131-142`). **Login meta uses `request.ip`, not `getRealIp`** (`:123`).
- **refresh** `POST /auth/refresh` → cookie-or-body token → `refreshTokens` (`auth.service.ts:271`): `verifyRefreshToken` → transaction: find hash → check revoked/expired/account → **race-safe rotation** `deleteMany({id})` + `count===0`→401 (`:311-316`) → issue new pair. Failure clears cookie (`auth.routes.ts:187`).
- **logout** `POST /auth/logout` (authenticated) → deny-list access jti in Redis for remaining TTL + revoke refresh row + audit (`auth.service.ts:344`).
- **forgot/reset** — enumeration-safe (`forgotPassword` sleeps + excludes admins, `:433-438`); reset token Redis `pwd_reset:{token}` 1h single-use; reset deletes **all** refresh tokens in a tx (`:494-511`).
- **verify-email** `POST /auth/verify-email` — token uuid → `updateMany where emailVerifiedAt:null` (`:174`).
- **me** `GET /auth/me` — returns `emailVerified` (`auth.routes.ts:299`).

### S7 Restaurant/config (`modules/restaurant`)
- Public reads: `GET /restaurants` (search), `GET /restaurants/:id`, `GET /restaurants/:id/availability` (no auth).
- Owner writes gated `[authenticate, requireRole('owner')]` (`restaurant.routes.ts:82`). `POST /restaurants` additionally checks `request.emailVerified===false`→403 (`:90-96`) then `assertOwnerRestaurantPlanLimit` then `createRestaurant`.
- Availability read path: `getAvailability` (`restaurant.service.ts:460`) → restaurant + joined subscription (1 query) → live operability math → cache read (`readAvailabilityEntry`) → miss: schedule + duration + `computeAvailabilityTimes` → cache write.
- Config mutations (`updateReservationConfig` `:668`, tables/combinations/turn-rules/schedule/closures) call `bumpAvailabilityVersion(restaurantId)` after commit (e.g. `:733`, `:803`, `:926`, `:1166`, `:1188`, `:1213`).

### S8 Reservation (`modules/reservation`)
- Diner create `POST /reservations` → rate-limit 12/min (`reservation.routes.ts:27`) → **email-verified gate** `request.emailVerified===false`→403 (`:45`) → `CreateReservationSchema` cross-field refinements (`reservation.schema.ts:13`) → `createReservation` (`reservation.service.ts:737`).
- Booking core `createWithAllocation` (`:470`) → `createReservationWithHolds` (`:392`): `prisma.$transaction` (`TX_OPTIONS maxWait 15s/timeout 20s` `:91`) writes reservation + one hold per table + audit; **quota enforced under `pg_advisory_xact_lock(hashtext(ownerId))`** (`:403`). On exclusion violation → `findNextAvailableStart` → 409 with `suggestedNextAvailableAt` (`:715-733`).
- Owner lifecycle: seat/cancel/no-show/extend/free-early/walk-in/staff/override, all `[authenticate, requireRole('owner')]` + `assertOwnerAccess` (`:362`, ownership-only, not operability-gated — `:358-361`).
- Every mutation → `invalidateAvailabilityCache` (start + end date if crossing midnight, `:93-114`) → `publishReservationEvent` (BullMQ) → `publishToRestaurantChannel` (Redis pub/sub).

### S9 Subscription/billing (`modules/subscription`)
- `webhookRoutes` registers a **buffer content-type parser** scoped to the plugin (`webhook.routes.ts:35-46`, sets `req.rawBody`).
- `POST /webhooks/lemon-squeezy`: HMAC verify `verifyLemonSqueezySignature` (`lemon-squeezy.ts:6`) → type/event filter → Redis `SET NX` idempotency key `ls-event:{event}:{subId}:{updated_at}` 7d (`webhook.routes.ts:97-108`) → `upsertSubscriptionFromWebhook` (`subscription.service.ts:304`) → **ordering guard**: drop event when `eventUpdatedAt < stored lsUpdatedAt` (`:328-334`). On handler throw, deletes idem key so LS retries (`:127-130`).
- Checkout/cancel/resume call `lsRequest`/`createCheckoutUrl` against `api.lemonsqueezy.com` (`lemon-squeezy.ts:59,83`).

### S10 Admin (`modules/admin`)
- `POST /admin/auth/login` rate-limit 5/15min (`admin.routes.ts:39`) → `adminLogin` (`admin.service.ts:28`): bcrypt(dummy const) → role must be ADMIN → if no `totpSecret`, returns QR + `pendingToken` (Redis `admin:totp:setup:{token}` 10min, `:67-78`); else verify TOTP `window:1` (`:26,85`). `adminTotpSetup` (`:107`) binds the secret. `issueAdminTokens` (`:144`) — refresh omitted from body, cookie only (`admin.routes.ts:104,159`).
- All read routes `[authenticate, requireRole('admin')]` (`admin.routes.ts:173`).

### S13 WebSocket (`plugins/websocket.ts`)
- `GET /ws?token&restaurantId` → per-IP cap 5 (in-process `wsConnectionsByIp` Map, `:11-12`) → `verifyAccessToken` → role must be `owner` → deny-list check → ownership `prisma.restaurant.findFirst` → `setTimeout` closes socket at token `exp` (M2, `:92-103`) → `subscribeToRestaurantChannel` (Redis) → forwards raw JSON.

---

## 4. Trust boundaries

| Boundary | Enforcement anchor | Notes |
|---|---|---|
| Public internet → API | Cloudflare (assumed) → `cloudflareOnlyPlugin` | No-op unless `NODE_ENV==='production'` **AND** `CF_ORIGIN_SECRET` set (`plugins/cloudflareOnly.ts:28`). `/webhooks/*` exempt (`:33-35`). Constant-time secret compare (`:6-11`). |
| Client IP identity | `getRealIp` (`lib/cloudflare.ts:24`) | Trusts `CF-Connecting-IP` **verbatim** unless `CF_ORIGIN_SECRET` set, then requires matching `x-cf-origin-secret` (`:30-36`). `trustProxy:true` (`index.ts:83`). Carried finding H-1/P1-4. |
| Unauthenticated → authenticated | `authenticatePlugin` (`plugins/authenticate.ts`) | Bearer verify → Redis deny-list + DB account check; **503 (not 401) on infra failure** (`:90-98`), bounded retry 2× (`:19-20,63-88`). |
| Role separation | `requireRole(role)` exact string match (`plugins/authenticate.ts:113-123`) | diner/owner/admin. |
| Tenant (owner) isolation | `assertRestaurantOwner` (`restaurant.service.ts:39`), `assertOwnerAccess` (`reservation.service.ts:362`) | Non-owned → 404 (`restaurant.service.ts:46-48`), no existence oracle. |
| Diner isolation | `where:{dinerId}` filters (`reservation.service.ts:794,819,843`) | App-layer only. |
| Admin bootstrap | Out-of-band (`scripts/promote-admin.ts`, `apps/api/scripts/admin-totp-setup.ts`) | Interactive self-enroll possible pre-`totpSecret` (carried M-2). |
| Webhook authenticity | HMAC-SHA256 `timingSafeEqual` (`lemon-squeezy.ts:6-17`) | `user_id` from signed `custom_data` only (`webhook.routes.ts:89`). |
| DB tenancy backstop | **None active** — `withUserContext` defined but unused (`packages/db/src/index.ts:22`); RLS only in `packages/db/sql/rls_self_hosted_optional.sql` | Carried L-2. |

---

## 5. Data-flow boundaries & PII

- **Secrets**: env-only, validated at boot (`apps/api/src/env.ts:3-63`, `process.exit(1)` on parse failure). JWT PEM `\n` normalization (`:67-68`).
- **PII in logs**: pino redaction paths cover auth headers, cookies, passwords, TOTP, refresh tokens (`lib/logger.ts:5-19`). **Query-string not redacted** → WS `?token=` leaks (carried H-2/P2-9).
- **PII in email**: owner-controlled `restaurantName`/address escaped via `htmlEscape` before diner HTML (`email.service.ts:63-70,130`); ICS via `icsEscape` (`:52`).
- **Client token storage**: access token in-memory only (`packages/api-client/src/session.ts:53`); refresh only in `__Host-refresh` HttpOnly cookie (`lib/cookies.ts:3-11`).

---

## 6. Tenancy & business-domain boundaries

- **Tenant unit = owner (`User` with role OWNER)**. Subscription is **per-user** (`schema.prisma:385` `userId @unique`), gating all of an owner's restaurants jointly (`getEffectiveLimitsForOwner` `subscription.service.ts:196`). No `organization` entity.
- **Domain modules** map 1:1 to directories under `apps/api/src/modules/`. Cross-module dependency is **one-directional**: reservation→subscription, restaurant→subscription (see [02](02-dependency-graph.md §cross-module)).
- **Quota domain**: monthly reservation count is **per-owner across all their restaurants**, `status notIn [CANCELLED, NO_SHOW]`, by `createdAt >= startOfCurrentMonth()` (`reservation.service.ts:193,253-259`, `lib/plan.ts:112`).

---

## 7. Deployment topology (from config, not narrative)

| Component | Host | Anchor |
|---|---|---|
| API | Railway (NIXPACKS) | `railway.json` — build `pnpm install --frozen-lockfile && prisma generate && turbo build --filter=@restaurant/api...`; start `pnpm --filter @restaurant/api start`; healthcheck `/health` |
| 3 SPAs | Vercel | `.github/workflows/deploy-{staging,prod}.yml` (vercel pull/build/deploy per app) |
| Postgres | Supabase (pooled 6543 runtime, direct 5432 migrations) | `schema.prisma:6-11` `url`/`directUrl`; `.env.example` |
| Redis | Upstash | `.env.example`; `lib/redis.ts` (family:4, fail-fast timeouts) |
| Email | Resend | `services/email.service.ts:5` |
| Billing | Lemon Squeezy | `lib/lemon-squeezy.ts` |
| Object storage | Cloudflare R2 (prod) / local disk (dev) | `lib/r2-storage.ts:9-26` |
| Edge | Cloudflare (DNS/TLS/WAF/Turnstile) | `LAUNCH_CHECKLIST_V2.md` topology + `cloudflareOnly` plugin |
| Local dev/test | Docker (`postgres:16-alpine` + `redis:7-alpine`) | `docker-compose.yml`; init `scripts/docker/init-databases.sql` |

**Branch model**: `main`=prod (manual `workflow_dispatch` w/ typed `DEPLOY`), `staging`=auto-deploy on push, promotion guarded by `branch-policy.yml` (head must be `staging`). CI on all branches + PRs into main/staging (`ci.yml`).

**Infrastructure assumptions baked in code:**
- Migrations run **out-of-band** before deploy; API never migrates at boot (deploy workflows run `prisma migrate deploy`; `railway.json` start does not). Anchor: `deploy-prod.yml` "Run PRODUCTION database migrations" step.
- Prod `DATABASE_URL` must carry `?pgbouncer=true` — enforced by `check-env` (`scripts/check-env.ts:73-81`).
- Upstash `maxmemory-policy` must be `noeviction` — probed by `check-env` (`scripts/check-env.ts:83+`).

---

## 8. Asynchronous flows & side-effect topology

```
POST /reservations (S8)
  └─ tx commit (reservation + holds + audit)          [DB, synchronous]
  └─ invalidateAvailabilityCache                       [Redis, best-effort]
  └─ publishReservationEvent → BullMQ 'booking_events' [Redis; rate-cap 60/min/restaurant, queue.ts:55]
  │     └─ notification.worker processNotificationJob   [S2, concurrency 5]
  │           └─ fetchEmailData → Resend (notifyOnce dedup, notify-once.ts:14)
  │           └─ reservation.created also schedules 'reservation.reminder' delayed job (queue.ts:106)
  └─ publishToRestaurantChannel → Redis pub/sub         [pubsub.ts:39]
        └─ wsPlugin subscriber → owner dashboard WS     [S13]
```

- **Maintenance schedulers** (S3, BullMQ repeatable, `maintenance.worker.ts:92-96`): `reconcile-reservations` `*/5 * * * *` (force-COMPLETE past rows after `RECONCILE_GRACE_HOURS=12`, release holds), `purge-expired-refresh-tokens` `20 4 * * *`, `prune-audit-logs` `40 4 * * *` (`AUDIT_LOG_RETENTION_DAYS`, default 365, min 30, `env.ts:49`).
- **Fail-open vs fail-closed** side effects: cache read/write, pubsub publish, queue publish, `notifyOnce`, threat detector — all **fail-open** (swallow errors). Auth revocation check — **fail-closed 503** (`authenticate.ts:90-98`). Rate limit — **fail-open** `skipOnError:true` (`index.ts:170`). (Carried M-4.)

---

## 9. External integrations

| Integration | Client | Auth | Failure mode |
|---|---|---|---|
| Lemon Squeezy REST | `fetch` in `lib/lemon-squeezy.ts:59,83` | `Bearer LEMON_SQUEEZY_API_KEY` | throws → 502 on checkout (`subscription.routes.ts:74`) |
| Lemon Squeezy webhook (inbound) | `webhook.routes.ts` | HMAC-SHA256 | 401 on bad sig; 200 on unhandled event |
| Resend | `Resend` SDK (`email.service.ts:5`) | `RESEND_API_KEY` | throws in worker → BullMQ retry → alert after retries (`notification.worker.ts:150`) |
| Cloudflare Turnstile | `fetch` (`lib/cloudflare.ts:49`) | `CLOUDFLARE_TURNSTILE_SECRET_KEY` | unreachable → 503 (`auth.routes.ts:61`) |
| Cloudflare R2 (S3) | `@aws-sdk/client-s3` (`r2-storage.ts:44`) | R2 keys | not configured → local disk in non-prod, else throws (`:96`) |
| Alert webhook (outbound) | `fetch` (`lib/alert.ts:48`) | none | best-effort, never throws (`:60`) |

---

## 10. Data model

Full schema `packages/db/prisma/schema.prisma`. Tables (`@@map`):

`users`, `refresh_tokens`, `restaurants`, `service_periods`, `restaurant_closures`,
`dining_tables`, `table_combinations`, `table_combination_members`, `turn_time_rules`,
`reservations`, `reservation_tables`, `audit_logs`, `subscriptions`, `product_feedback`.

Enums: `Role`, `CuisineType`, `Plan`, `SubscriptionStatus`, `SeatingMode`,
`ReservationStatus`, `ReservationType`, `ReservationSource` (`schema.prisma:16-79`).

Extensions: `pgcrypto, pg_trgm, citext, btree_gist` (`schema.prisma:11`).

Key columns:
- `users.email` `@db.Citext @unique` (`:85`); `deletedAt` doubles as **ban** flag (admin ban sets it — `admin.service.ts:290`).
- `reservations.startsAt/endsAt` `@db.Timestamptz(3)` (`:300-301`); `dinerId` nullable (`:296`).
- `reservation_tables` — `releasedAt` nullable; unique `(reservationId, tableId)` (`:357`); the GiST target.
- `subscriptions.lsUpdatedAt @db.Timestamptz` (`:404`) — ordering guard column.
- `restaurants.openMinutes/closeMinutes` (`:153-154`) — **legacy** coarse span; engine reads `service_periods`, falls back to these only when zero period rows (`service-schedule.ts:56-64`).

**Migration history quirks:** first two migrations built a retired **slot-counter** model
(`time_slots`, `bookings`, enum `BookingStatus`) dropped in
`20260705000000_reservation_engine`. Exclusion constraint was `tsrange` there, rebuilt as
`tstzrange` in `20260705120000_reservation_timestamptz_timezone`. Email verification
backfill grandfathers existing users (`20260710120000_email_verification` `UPDATE users SET emailVerifiedAt = now()`).

---

## 11. Load-bearing invariants (each with anchor)

| ID | Invariant | Enforcement anchor | Evidence |
|---|---|---|---|
| INV-1 | No two unreleased holds on the same table overlap in time | `reservation_tables_no_overlap` GiST `EXCLUDE (tableId WITH =, tstzrange(startsAt,endsAt,'[)') WITH &&) WHERE releasedAt IS NULL` | migration `20260705120000_reservation_timestamptz_timezone`; caught as SQLSTATE 23P01 by `isExclusionViolation` (`reservation-engine.ts:345`) |
| INV-2 | Timestamps stored/queried as timestamptz; local-day math via Intl two-pass offset | `@db.Timestamptz(3)` (`schema.prisma:300`); `zonedTimeToUtc` two-pass (`timezone.ts:52-57`); raw SQL uses `tstzrange(...::timestamptz)` (`reservation-engine.ts:106`) | — |
| INV-3 | Access-token type confusion rejected | `verifyAccessToken` rejects `type==='refresh'` / non-role (`lib/jwt.ts:57`); `verifyRefreshToken` rejects non-`refresh` (`:73`) | RS256 pinned `algorithms:['RS256']` (`:48,70`) |
| INV-4 | Refresh-token rotation is race-safe (single use) | `deleteMany({id})` + `count===0`→401 inside tx (`auth.service.ts:311-316`) | resolves prior P0-7 |
| INV-5 | Auth never granted on infra failure | deny-list+account check → 503 after bounded retry, never 401 (`authenticate.ts:56-98`) | fail-closed by design |
| INV-6 | Webhook events idempotent | Redis `SET NX ls-event:{event}:{subId}:{updated_at}` 7d (`webhook.routes.ts:97-108`) | key deleted on handler throw to allow retry (`:128`) |
| INV-7 | Webhook events not applied out of order | drop when `eventUpdatedAt < stored lsUpdatedAt` in tx (`subscription.service.ts:328-334`) | column `lsUpdatedAt` (`schema.prisma:404`) |
| INV-8 | Monthly reservation quota exact under concurrency | `pg_advisory_xact_lock(hashtext(ownerId))` then count-then-insert in same tx (`reservation.service.ts:403-416`) | resolves prior P1-11 for reservations |
| INV-9 | Config change invalidates availability across all dates in O(1) | version INCR `restaurant:{id}:availver`; readers treat version mismatch as miss (`availability-cache.ts:64,96`) | bump called after every config mutation (`restaurant.service.ts` bumpAvailabilityVersion calls) |
| INV-10 | Operability computed identically on DB and pure paths | single classifier `isOwnerOperableByStatus` (exhaustive switch, `never` guard) used by both `resolveOwnerBillingState` and `canOwnerOperateFromSubscription` (`subscription.service.ts:86,144,224`) | — |
| INV-11 | Booking window enforced server-side (not just UI) | `findContainingWindow` gate for ONLINE/STAFF in `createWithAllocation` (`reservation.service.ts:649-673`) | resolves prior P0-5 API-side gap |
| INV-12 | Provided `tableIds` must belong to the restaurant (active) | `assertTablesBelongToRestaurant` (`reservation.service.ts:312-323`) called when `params.tableIds?.length` (`:503`); override path validates separately (`:1401-1411`) | resolves prior P0-3 for the create path |
| INV-13 | Diner abuse guards on online bookings | horizon `MAX_ADVANCE_DAYS=365`, overlap block, `MAX_ACTIVE_RESERVATIONS_PER_DINER=20` (`reservation.service.ts:39-42,270-309`) | applied only when `source==='ONLINE' && dinerId` (`:678`) |
| INV-14 | Email time rendered in restaurant timezone | `fmtTime(iso, restaurantTimezone)` with `timeZone` + `timeZoneName` (`email.service.ts:35-46`); worker passes `restaurant.timezone` (`notification.worker.ts:53`) | resolves prior P0-4 |
| INV-15 | Logo bytes validated by magic bytes, size-capped, path-traversal-guarded | `detectAllowedImage` (`image-validation.ts:30`), `MAX_LOGO_BYTES=2MB` (`:14`), `openLocalLogoFile` resolve-prefix check (`r2-storage.ts:109-114`) | local route disabled in prod (`r2-storage.ts:20`) |
| INV-16 | Emails sent at most once per (reservation,event,recipient) | `notifyOnce` Redis `SET NX notify:{key}` 24h, fail-**open** (`notify-once.ts:14-51`) | delete-on-failure allows retry (`:44`) |
| INV-17 | Reminder job idempotent per reservation, re-checks status at send | deterministic `jobId: reminder:{id}` (`queue.ts:127`); worker only sends if `status==='SCHEDULED'` (`notification.worker.ts:100`) | — |
| INV-18 | Maintenance schedulers converge under multiple workers | `upsertJobScheduler` idempotent by id (`maintenance.worker.ts:119`); `notifyOnce` tolerates concurrent workers | documented in `worker.ts:13-15` |

---

## 12. Undocumented-in-prose architecture discoveries (anchored)

| ID | Discovery | Anchor |
|---|---|---|
| D-1 | Availability cache is **versioned full-response** (whole payload cached, version-checked), not just a slot list | `availability-cache.ts:82-101` `AvailabilityCacheEntry{v,...}`, `parseEntry` version check |
| D-2 | Search availability is a **5-gate cache-first pipeline** with bounded concurrency (`SEARCH_COMPUTE_CONCURRENCY=6`, candidate cap `SEARCH_AVAILABILITY_CANDIDATES=100`) | `restaurant.service.ts:186-353` `findAvailableRestaurantIds`, `mapWithConcurrency` |
| D-3 | `/health` answered at raw `http.Server` layer, bypassing Fastify | `index.ts:88-97` `serverFactory` |
| D-4 | Redis client is **fail-fast singleton with connection coalescing** (`_connecting` promise, `waitForReady`) | `lib/redis.ts:99-129` |
| D-5 | Separate one-shot ping client (`pingRedis`) never leaves a stuck connecting client | `lib/redis.ts:132-147` |
| D-6 | Dedicated subscriber Redis client for pub/sub, one global connection + in-process listener map | `lib/pubsub.ts:5-28`, `lib/redis.ts:149` `createSubscriberClient` |
| D-7 | `deriveDisplayStatus` rewrites SCHEDULED/SEATED→COMPLETED **in responses only**; DB truth kept via `rawStatus` | `reservation-engine.ts:24`, `reservation.service.ts:116-128` |
| D-8 | `until-close` end = min(service close, cap, next reservation start) with `wasCapped` flag | `reservation-engine.ts:488-570` `resolveCustomReservationWindow` |
| D-9 | Overnight service windows encoded as `closeMinute <= openMinute` (wrap to next local day) | `service-schedule.ts:159-165`; DB CHECK allows `closeMinute` 1..1440 (`20260709000000` migration) |
| D-10 | Legacy open/close columns synthesized into 7 uniform ServicePeriods when none exist | `service-schedule.ts:56-64`, backfill in `20260709000000_service_schedule_and_ls_updated_at` |
| D-11 | Queue publish is per-restaurant rate-capped 60/min (drops events over cap) | `queue.ts:55-77` |
| D-12 | `withUserContext` (RLS hook) exported but **unused** anywhere in app code | `packages/db/src/index.ts:22`; grep shows only self-reference |
| D-13 | Test server (`buildTestServer`) omits index.ts middleware (no rate-limit/threat/WS/onSend) | `apps/api/src/__tests__/helpers/server.ts:17-50` |
| D-14 | `getRealIp` and login route disagree: login uses `request.ip`, other routes `getRealIp` | `auth.routes.ts:123` vs `reservation.routes.ts:31` |
| D-15 | Deprecated aliases retained: `publishBookingEvent`, `bookingChannel`, `sendBooking*`, `listBookings`, `/admin/bookings` | `queue.ts:138`, `pubsub.ts:35`, `email.service.ts:288-306`, `admin.service.ts:421`, `admin.routes.ts:341` |
