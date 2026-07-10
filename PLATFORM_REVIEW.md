# Maida Platform — Full Codebase Review

*Generated 2026-07-09 from source code only. No existing documentation (PROJECT_CONTEXT.md, README, LAUNCH_CHECKLIST.md, SECURITY_REVIEW.md) was read or relied upon — everything below is derived from schemas, migrations, routes, services, frontend components, tests, and configs. Where intent had to be inferred, it is marked **[inferred]**.*

---

# PART 1 — SYSTEM DOCUMENTATION

This part is written so that a coding assistant with **no other context** can safely modify the system.

## 1. What this is

A multi-tenant **restaurant reservation SaaS** (brand name "Maida" — **[inferred]** from `security.txt` contact `security@maida.app` and UI copy "Maida does not collect this fee"). Restaurant **owners** subscribe to a paid plan, configure their restaurant (tables, hours, timezone, turn times), and manage reservations. **Diners** search restaurants and book tables for free. A third, internal **admin** role oversees users, plans, and audit logs.

The platform's core differentiator is its reservation engine: availability is computed by **real time-interval overlap against discrete physical tables**, and double-booking is made impossible at the database layer by a PostgreSQL GiST exclusion constraint — not by application-level locking.

Money: Maida charges owners subscription fees via **Lemon Squeezy**. It never processes diner payments; "custom reservation fees" are informational amounts displayed to the diner and collected by the restaurant itself.

## 2. Monorepo layout

pnpm workspace + Turborepo. Node ≥ 20. TypeScript everywhere.

```
apps/
  api/        Fastify 5 backend (the only server) — port 3001
  web/        React 18 + Vite SPA for DINERS — dev port 5173
  dashboard/  React SPA for OWNERS — dev port 5174
  admin/      React SPA for ADMINS — dev port 5175
packages/
  db/         Prisma 5 schema, migrations, seed; exports the PrismaClient singleton
  types/      Hand-written shared TS types (NOT generated from Prisma/zod — drift is possible)
  ui/         Empty placeholder (no source)
  config/     Empty placeholder (no package.json)
scripts/      Operational scripts: db-migrate, check-env, load-test, e2e runner,
              backup export/restore, promote-admin, dev-data-reset
```

Key libraries: Fastify 5 (+helmet, cors, rate-limit, cookie, multipart, websocket, sensible), Prisma 5 + PostgreSQL (Supabase-hosted **[inferred]** from `.env.example` and warmup messages), ioredis (Upstash in prod **[inferred]**), BullMQ, Resend (email), `jsonwebtoken` RS256, bcryptjs, otplib (admin TOTP), Zod validation, TanStack Query + react-router in all SPAs, Tailwind.

**Infrastructure assumption baked into the code:** one API process behind Cloudflare, PostgreSQL on Supabase (pooled URL on 6543 for runtime, direct/session URL for migrations), Redis on Upstash, static SPA hosting with an `/api` reverse-proxy path (all three SPAs default `VITE_API_URL` to `/api` and the vite dev servers proxy `/api → localhost:3001`, rewriting the prefix away).

## 3. Data model (Prisma schema + raw SQL migrations)

All IDs are Postgres `gen_random_uuid()` UUIDs. Soft deletes via `deletedAt` on `users` and `restaurants`.

### users
`email` is `citext` (case-insensitive unique). `password` is a bcrypt hash. `role ∈ {DINER, OWNER, ADMIN}`. `totpSecret` nullable — set once an admin completes TOTP enrollment. `deletedAt` doubles as the **ban** flag (admin ban = set `deletedAt`).

### refresh_tokens
Server-side session store for refresh-token rotation: `jti` (unique), `tokenHash` (SHA-256 of the raw JWT — raw token never stored), `expiresAt`, `revokedAt`. Partial index on active tokens. There is **no cleanup job** despite an index comment saying "for cleanup jobs".

### restaurants
Profile fields (`name`, unique `slug` = slugified name + 8 random hex chars, `cuisine` enum, `description`, `address`, `city`, `phone`, `imageUrl`) plus the **reservation-engine configuration**:

- `timezone` — IANA string, default `UTC`. All service-window math converts through this.
- `seatingMode` — `LOCKED` (only individual tables bookable) or `FLEXIBLE` (owner-predefined table combinations are additionally bookable).
- `defaultDurationMins` (default 90) — fallback turn time.
- `openMinutes` / `closeMinutes` — **one single daily service window**, minutes from local midnight (defaults 660/1380 = 11:00–23:00). `0/1440` is the "open 24 hours" sentinel (`lib/service-hours.ts`). DB CHECK: `close > open`, both within a day. **There is no per-weekday schedule, no closed days, no split lunch/dinner windows, and no overnight (close < open) support.**
- `customFee`, `extraHourFee` (Decimal, informational), `feeCurrency` (default USD), `maxExtraHours` (default 2) — cap on hours a CUSTOM reservation may exceed the standard turn.

### dining_tables
Atomic bookable unit: `name` (unique per restaurant), `minPartySize`/`maxPartySize` (DB CHECK max ≥ min ≥ 1), `isActive`. "Delete" from the API is a soft deactivate (`isActive=false`).

### table_combinations + table_combination_members
Owner-predefined merges of ≥2 tables (FLEXIBLE mode only, plan-gated). A combination is bookable as one unit; reserving it creates a hold on **every member table**. Combinations are never computed dynamically.

### turn_time_rules
`(minPartySize, maxPartySize) → durationMins` bands. First matching rule (ordered by `minPartySize asc`) wins; fallback is the restaurant `defaultDurationMins`. Overlapping bands are not prevented.

### reservations
`restaurantId`, nullable `dinerId` (null = walk-in/staff guest without account), `partySize` (DB CHECK ≥ 1 only; API caps at 50), `startsAt`/`endsAt` as `timestamptz(3)`,
`status ∈ {SCHEDULED, SEATED, COMPLETED, CANCELLED, NO_SHOW}`,
`reservationType ∈ {STANDARD, CUSTOM}`, `source ∈ {ONLINE, WALK_IN, STAFF}`,
`guestName`, `notes`, fee **snapshots** (copied from restaurant at booking time), `untilClose` flag, `isOverride` flag, lifecycle timestamps (`seatedAt`, `completedAt`, `cancelledAt` + `cancelReason`, `noShowAt`).

### reservation_tables — the double-booking guarantee
One row per physical table a reservation occupies, carrying its own `startsAt`/`endsAt` copy and a `releasedAt` (set on cancel/no-show/free-early to free the interval). Protected by:

```sql
EXCLUDE USING gist ("tableId" WITH =, tstzrange("startsAt","endsAt",'[)') WITH &&)
WHERE ("releasedAt" IS NULL)
```

No two unreleased holds on the same table may overlap in time — enforced by Postgres regardless of code path or concurrency. Back-to-back reservations are legal (`[)` half-open ranges). Application code catches SQLSTATE `23P01` (`isExclusionViolation()` in `lib/reservation-engine.ts`, which matches on error message text and Prisma `P2010` meta) and converts it to HTTP 409 with a `suggestedNextAvailableAt`.

### audit_logs
Append-only: `actorId`, `action` (string like `reservation.created`, `LOGIN_FAILED`), `entityType/entityId`, `metadata` JSON, `ipAddress`, `userAgent`. Written best-effort (`.catch(() => {})`) in most flows. No retention policy.

### subscriptions
One per user (`userId` unique). `plan ∈ {STARTER, PRO, PREMIUM}`, `status ∈ {TRIALING, ACTIVE, PAUSED, PAST_DUE, CANCELLED, EXPIRED}`, Lemon Squeezy IDs, `currentPeriodEnd`, `renewsAt`, `cancelAtPeriodEnd`, `trialStartedAt`.

### product_feedback
Free-text feedback from any authenticated diner/owner; admin-only reading.

### Migration history quirks
The first two migrations built a **retired slot-counter model** (`time_slots`, `bookings`) which migration `20260705000000_reservation_engine` drops entirely. Check constraints and partial indexes referencing those tables are gone with them. `20260705120000` converted reservation timestamps to `timestamptz` and rebuilt the exclusion constraint as `tstzrange`. Prisma uses `directUrl` for migrations (bypasses PgBouncer). RLS exists only as an optional self-hosted SQL file (`packages/db/sql/rls_self_hosted_optional.sql`) — **RLS is NOT active**; all authorization is app-layer.

## 4. Authentication & authorization

### Token model
- **Access token**: RS256 JWT, 15 min TTL, claims `{sub, role ('diner'|'owner'|'admin'), jti, iat, exp}`. Sent as `Authorization: Bearer`. Held **in memory only** in the SPAs (module-level variable, `lib/access-token.ts`) — never persisted.
- **Refresh token**: RS256 JWT, 7 days, `type:'refresh'`. Delivered as an HttpOnly `__Host-refresh` cookie (`Secure`, `SameSite=Strict`, `Path=/`) and (for the web/dashboard login response body) also returned in JSON. A SHA-256 hash is stored in `refresh_tokens`.
- **Rotation**: `POST /auth/refresh` verifies the JWT, looks up the hash, **deletes** the old row, and issues a new pair inside one Prisma transaction. Reuse of a rotated token fails (row gone) but there is **no token-family reuse detection** and the concurrent-refresh race is unhandled (see Finding P0-7).
- **Revocation**: logout puts `deny:{jti}` in Redis for the access token's remaining TTL and marks the refresh row revoked. `authenticate` checks the deny list on **every request** (Redis round-trip) plus a Prisma `user.findUnique` to enforce ban/soft-delete.

### The `authenticate` / `requireRole` plugin (`plugins/authenticate.ts`)
Any thrown error inside the try block (including **Redis connection failure**) returns 401 "Invalid or expired token". `requireRole(role)` does an exact string match on the JWT role claim.

### Login hardening (`modules/auth`)
- Constant-time-ish login: bcrypt always runs against a dummy hash when the user doesn't exist.
- Account lockout in Redis: 10 failures / 15 min → 30 min lock (silently reported as invalid credentials). Disabled when `NODE_ENV==='test'`.
- Route rate limits (keyed by `getRealIp` = `CF-Connecting-IP` header else socket IP): login 5/15min/IP, register 3/h/IP, forgot-password 3/h/IP, reset-password 10/h/IP.
- Registration optionally requires a **Cloudflare Turnstile** token — enforced only when `CLOUDFLARE_TURNSTILE_SECRET_KEY` is set.
- Password policy: 8–72 chars, ≥1 uppercase, ≥1 digit. Registration `role` may be `diner` or `owner` (owner registration also creates a `TRIALING` subscription with `trialStartedAt = now`).
- Password reset: UUID token in Redis (`pwd_reset:{token}`, 1h TTL), single-use, deletes all refresh tokens on success. Reset URL base depends on role (owner → DASHBOARD_URL, diner → WEB_URL); admins are excluded from the flow.
- There is **no email verification** at signup and no change-email/change-password (while logged in) endpoint.

### Admin auth (`modules/admin`)
Separate `POST /admin/auth/login` (5/15min/IP): password check → if no `totpSecret`, returns a QR data-URL + `pendingToken` (Redis, 10 min) for enrollment via `POST /admin/auth/totp/setup`; else requires a 6-digit TOTP (±1 step window). Admin creation itself happens **outside the API** (`scripts/promote-admin.ts` + `apps/api/scripts/admin-totp-setup.ts` **[inferred from filenames]**). Admin refresh flows through the shared `/auth/refresh`.

### Edge protections (`apps/api/src/index.ts`)
- `trustProxy: true`; request timeout 30 s; body limit 100 KB (multipart logo limit 2 MB, 1 file).
- Helmet with strict CSP, HSTS preload; extra headers (Permissions-Policy etc.) in an `onSend` hook; method-override headers rejected.
- Scanner user-agent blocklist (sqlmap, nikto, …).
- **Threat detector** (`lib/threat-detector.ts`): counts 401/404/403 responses per IP in Redis; thresholds (10 auth failures/5 min, 30 404s/min, 15 403s/5 min) trigger a 1-hour IP ban checked in an `onRequest` hook. Skipped in tests; fails open if Redis is down.
- Global rate limit 100/min/IP — in-memory in dev/test, Redis-backed in production (`skipOnError: true`, health routes and `X-Load-Test: 1` [non-prod only] exempt).
- `cloudflareOnlyPlugin`: in production, when `CF_ORIGIN_SECRET` is set, rejects requests missing the `x-cf-origin-secret` header (injected by a Cloudflare Transform Rule) — except `/webhooks/*`. **Optional** — if unset, the origin accepts direct traffic and `CF-Connecting-IP` becomes spoofable.
- `/health` is answered at the raw `http.Server` layer (serverFactory) so it can never hang on Redis/hooks; `/health/ready` checks DB (`SELECT 1`) and Redis ping, returns 503 "degraded" if either fails.
- Startup: `warmupStores()` retries DB up to 6 times (Supabase wake-up), Redis best-effort; then listens and starts the in-process notification worker. SIGTERM/SIGINT → stop worker, close server.

## 5. The reservation engine (the heart of the system)

Files: `lib/reservation-engine.ts`, `lib/timezone.ts`, `lib/service-hours.ts`, `modules/reservation/reservation.service.ts`, `modules/restaurant/restaurant.service.ts` (availability), `lib/availability-cache.ts`.

### Bookable units
`loadBookableUnits(restaurantId, seatingMode)` returns active tables as units `{tableIds:[id], min, max}` and — in FLEXIBLE mode — active combinations as units spanning several tableIds. `sortUnitsBestFit` filters units whose `[min,max]` party range contains the party size and sorts by smallest `maxPartySize` then smallest `minPartySize` (best fit = smallest table that fits). Availability of a unit = none of its tables has an unreleased hold overlapping `[startsAt, endsAt)`.

### Durations
`resolveDurationMins` = first matching turn-time rule else `defaultDurationMins`. For CUSTOM reservations the hard cap is `standardDuration + maxExtraHours*60` minutes.

### Timezone math (`lib/timezone.ts`)
Pure `Intl.DateTimeFormat`-based (no date library): `zonedTimeToUtc(dateStr, minutesFromMidnight, tz)` converts a restaurant-local wall-clock moment to a UTC instant (two-pass offset iteration handles DST; nonexistent spring-forward times resolve deterministically but shifted). `serviceWindowBounds(date, open, close, tz)` gives the UTC window; the 24h sentinel maps to the full local day.

### Availability listing (`GET /restaurants/:id/availability?date&partySize`)
`computeAvailabilityTimes`: loads units + **one** occupancy query for the whole day + duration, then walks the service window in **fixed 15-minute steps** entirely in memory, skipping past-time slots, emitting `{startsAt, endsAt, durationMins}` for each step where some unit fits. Results are cached in Redis for **300 s** per `(restaurant, date, partySize)`, with an index set per date used for invalidation. Every reservation mutation invalidates the cache **for the reservation's start date only** (in restaurant-local terms). Cache read/write failures are swallowed.

### Booking flows (all in `reservation.service.ts`)
All creation funnels through `createWithAllocation` → `createReservationWithHolds` (a Prisma interactive transaction, `maxWait 15s / timeout 20s`, creating the reservation + one `reservation_tables` row per table + optional audit log). The exclusion constraint is the only concurrency control — on 23P01 the service computes `findNextAvailableStart` and throws 409 with the suggestion.

1. **Diner online** `POST /reservations` (role diner): plan-limit check on the owner, `startsAt` must be in the future (only for ONLINE), STANDARD duration derived from turn-time rules; CUSTOM requires Pro/Premium on the owner and either `durationMins` (≤ cap) or `untilClose`. Table auto-assigned best-fit. Fee snapshots copied for CUSTOM. **No validation that `startsAt` falls inside the service window, no minimum notice, no maximum advance horizon** — the UI only offers valid slots, but the API accepts any future instant.
2. **Until-close**: probes a 15-min hold at `startsAt`, then extends the end to `min(serviceClose, standardDuration+maxExtraHours, next reservation start on those tables)`; `wasCapped` is returned when a following reservation shortened it.
3. **Walk-in** `POST /restaurants/:id/reservations/walk-in` (owner): `startsAt = now`, status SEATED immediately, optional explicit `tableIds` (**not validated to belong to the restaurant — see Finding P0-3**), optional duration.
4. **Staff booking** `POST .../reservations/staff` (owner): future booking for a named guest, optional `dinerId` (any UUID accepted), STANDARD or CUSTOM.
5. **Override** `POST .../reservations/override` (owner): explicit tables + explicit `startsAt/endsAt` + mandatory reason; tables ARE validated to belong to the restaurant; still subject to the exclusion constraint (409 on conflict); `isOverride=true`.

### Lifecycle transitions (owner-only, per restaurant)
- `seat` (SCHEDULED→SEATED), `no-show` (SCHEDULED→NO_SHOW, releases holds), `cancel` (any non-cancelled → CANCELLED, releases holds; diners may cancel their own except NO_SHOW), `extend` (+15..240 min, updates reservation and each hold inside a tx, 409 on conflict), `free-early` (→COMPLETED now, truncates `endsAt` and releases holds).
- **Nothing ever transitions rows to COMPLETED automatically.** `deriveDisplayStatus` rewrites SCHEDULED/SEATED to "COMPLETED" **in API responses only** once `endsAt` passes; the DB keeps the stale status forever (affects status filters and any DB-level analytics).
- Every mutation publishes (a) a BullMQ job on queue `booking_events` (email worker) and (b) a Redis pub/sub message on `reservation:restaurant:{id}` (dashboard WebSocket). Both are best-effort with per-restaurant publish rate cap 60/min.

### Availability search (`GET /restaurants?date&partySize&…`)
When both `date` and `partySize` are present, the service loads up to **100** matching restaurants and runs `computeAvailabilityTimes` for each (uncached), filtering to those with ≥1 slot. Restaurants beyond the first 100 are never considered. Text search uses `ILIKE '%q%'` on name/city (trigram GIN indexes exist from the early migration).

## 6. Plans, trial, and billing

### Tiers (`lib/plan.ts` — duplicated verbatim client-side in `apps/dashboard/src/lib/plan-limits.ts`)

| Limit | TRIAL | STARTER €29 | PRO €79 | PREMIUM €199 |
|---|---|---|---|---|
| restaurants | 1 | 1 | 5 | ∞ |
| reservations/month (per **owner**, all restaurants, `status != CANCELLED`, by `createdAt` in current UTC month) | 25 | 200 | 1 000 | ∞ |
| tables/restaurant (active) | 5 | 10 | 30 | ∞ |
| combinations/restaurant | 0 | 0 | 5 | ∞ |
| turn-time rules/restaurant | 1 | 1 | 5 | ∞ |
| flexible seating | – | – | ✓ | ✓ |
| custom reservations & fees | – | – | ✓ | ✓ |

### Billing state machine (`subscription.service.ts`)
`resolveOwnerBillingState`:
- `TRIALING` → tier TRIAL; `canOperate` = trial (14 days from `trialStartedAt`, fallback `createdAt`) not expired. **Expired trial blocks everything** gated by `assertOwnerCanOperate` — including diner bookings at that restaurant, the owner's own reservation list, seat/cancel actions, and config updates.
- `ACTIVE | PAST_DUE | PAUSED | CANCELLED` → paid tier with full plan limits, `canOperate: true`.
- `EXPIRED` (churned paid) → **permanently falls back to free STARTER limits with `canOperate: true`** — a churned owner keeps operating on Starter limits without paying. **[inferred to be intentional from code structure, but it contradicts the trial behavior — worth confirming.]**

Gating call sites: restaurant create (route + service), reservation create (all sources), custom-reservation booking, flexible seating switch, combination/table/turn-rule creation, config update, restaurant update/delete, table update/delete.

### Lemon Squeezy integration
- Checkout: `POST /subscriptions/checkout {plan}` → LS API creates a hosted checkout with `custom.user_id`; response 502 on LS failure.
- Webhook `POST /webhooks/lemon-squeezy`: HMAC-SHA256 signature over the **raw body** (custom content-type parser scoped to the webhook plugin), timing-safe compare; idempotency via Redis `SET NX` keyed by `(event, subscription id, updated_at)` (7-day TTL, deleted on processing failure so LS retries work); upserts the subscription: status mapped from LS status (`unpaid→PAST_DUE`, unknown→PAST_DUE), plan mapped from variant ID env vars, `EXPIRED` forces plan back to STARTER. **Events are applied in arrival order — no `updated_at` comparison against stored state, so late out-of-order deliveries can regress status.**
- Cancel/resume: `POST /subscriptions/cancel|resume` PATCH the LS subscription then set `cancelAtPeriodEnd` locally.
- Admin override `PATCH /admin/users/:id/plan` upserts only the `plan` column — it does **not** touch `status`, so upgrading a TRIALING owner leaves them on TRIAL limits until a webhook or trial logic changes status.

## 7. Async infrastructure

**Redis** (single Upstash URL) serves seven concerns: rate limiting (prod), access-token deny list, login lockout counters, threat-detector counters/bans, availability cache, password-reset + admin-TOTP-pending tokens, webhook idempotency, notification dedup, BullMQ, and pub/sub. Client options are aggressive fail-fast: 2 s connect/command timeouts, no offline queue, no retries, no reconnection (`retryStrategy: () => null`) — a dropped connection is only re-established because `getRedisClient()` discards clients in `end/close` state on next call.

**BullMQ**: queue `booking_events`, jobs = reservation events; default 3 attempts, exponential backoff. The **notification worker runs in-process** with the API (concurrency 5). It re-fetches the reservation and sends emails via Resend:
- created → diner confirmation + owner alert
- seated → diner
- cancelled → by-diner (both parties) or by-owner (diner only)
- extended / freed_early / no_show → **no email handler** (warn log only).

Emails are deduped by `notifyOnce` (Redis SET NX per `{reservationId}:{event}:{recipient}`, 24 h TTL; fails **open** — Redis down ⇒ possible duplicates; send failure deletes the marker so retries can resend). **Email timestamps are formatted with `toLocaleString('en-US')` without a timeZone — i.e., in the server's timezone** (see Finding P0-4). Walk-in reservations have no diner, so the "diner" email goes to the placeholder `guest@walk-in.local`.

**Pub/sub → WebSocket**: `GET /ws?token=<accessJWT>&restaurantId=...` (owners only; per-IP cap 5 connections, in-process map). Verifies JWT + deny list + restaurant ownership, subscribes to the restaurant channel, forwards raw JSON. A timer closes the socket at access-token expiry (code 4001). The dashboard client auto-reconnects after 3 s **only for close codes < 4000**, so an expiry close is terminal until page reload.

## 8. Frontend apps

Shared patterns across all three SPAs:
- `lib/api.ts`: thin `fetch` wrapper; `BASE = VITE_API_URL ?? '/api'`; attaches Bearer token from the in-memory holder; `credentials: 'include'` (refresh cookie); throws `ApiError(status, message)`.
- `AuthContext`: on mount, calls `POST /auth/refresh` once (module-level promise guard) → stores access token in memory → `GET /auth/me` → role check (dashboard requires owner, admin requires admin). **There is no proactive re-refresh and no 401-retry interceptor** — the 15-minute access token silently dies for an open tab (see Finding P0-1). Only the admin app reacts to 401s (clears session via a window event).
- Vite dev proxy rewrites `/api/*` and patches `Set-Cookie` paths.

### apps/web (diner)
Routes: restaurant list/search, restaurant detail with `ReservationBookingFlow`, my-reservations, auth pages (register supports Turnstile via `@marsidev/react-turnstile`).
`ReservationBookingFlow` steps: party size → time → (optional duration if custom offered) → confirm.
- On entering the time step, it fires **7 parallel availability requests** (today + 6 days, dates computed in **browser UTC**, not restaurant timezone) and derives quick picks (next available / in 30 min / tonight / tomorrow same time) plus a specific-date picker.
- "Custom duration" UI is shown iff the restaurant has `customFee` or `extraHourFee` set (`restaurantOffersCustomReservations`) — *not* from the owner's plan.
- 409 responses surface `suggestedNextAvailableAt` with a one-click rebook.
- Booking-flow times render in the **restaurant** timezone; MyBookingsPage renders `startsAt` with date-fns in the **browser** timezone (inconsistent).

### apps/dashboard (owner)
Routes: restaurant list, create wizard, restaurant detail, billing, auth pages.
Restaurant detail page hosts: profile edit, logo upload, `ReservationConfigPanel` (timezone/seating mode/hours/default turn/fees/maxExtraHours; fee inputs hidden when plan lacks customReservations), `TablesPanel`, `CombinationsPanel`, `TurnTimeRulesPanel`, and the reservation list:
- The list requests page 1 (limit 20, `startsAt asc`, no date filter in UI) — **no pagination controls**, so a busy restaurant sees only its 20 oldest reservations ever.
- Actions: Seat / No-show / Cancel only. **Walk-in, staff booking, override, extend, and free-early endpoints have no UI.**
- Live updates via `useBookingWebSocket` (invalidates queries + toasts). Times display in browser timezone.
- BillingPage: plan comparison (server-provided), checkout redirect, cancel/resume, trial banner.

### apps/admin
Login (password → TOTP setup/verify flow) → stats dashboard, users (ban/unban/plan override, detail), restaurants, reservations, subscriptions, audit logs, feedback. Read-mostly; DataTable with pagination.

## 9. Operational tooling

- `scripts/check-env.ts` — pre-deploy env validation (also rejects localhost CORS in prod).
- `scripts/db-migrate.ts` — `prisma migrate deploy` then `generate` (Windows EPERM tolerated).
- `scripts/load-test.ts` — concurrent booking test against a live API (its header comment still says "SELECT FOR UPDATE" — stale; the mechanism is now the exclusion constraint).
- `scripts/e2e/*` — journey scripts (diner, owner, admin, concurrency, plan-enforcement, security, subscription, timezone, websocket, regression) run against a live stack via `pnpm e2e`.
- Backup scripts export/restore JSON snapshots to `backups/` (gitignored except `.gitkeep`).
- API tests (`vitest`, ~150 `it()`s) are **integration tests against the real database in `.env`** — they build a slimmed Fastify instance (`__tests__/helpers/server.ts` — note: no rate limiting, no threat detector, no ws) and clean up created rows afterward. CI (`.github/workflows/ci.yml`) runs lint/typecheck/test/build with **no DATABASE_URL configured** — how tests pass in CI is unclear from the code **[ambiguity — likely they fail or the workflow relies on repo secrets not visible here]**. Deploy is a manual `workflow_dispatch` with typed confirmation.

## 10. Known intentional behaviors (do not "fix" without product sign-off)

- Fees are informational only; no diner payments anywhere.
- `PAST_DUE`/`PAUSED`/`CANCELLED` subscriptions keep full plan access until LS sends `expired`.
- Back-to-back bookings are allowed (half-open intervals).
- Trial limits are stricter than Starter.
- Walk-ins are seated immediately and count toward the monthly quota.
- Admin accounts cannot use password reset and cannot be banned.

---

# PART 2 — PRODUCTION-READINESS AUDIT

Ordered as a work queue: **P0 = will break real usage quickly or is a security hole — fix before onboarding real restaurants. P1 = will break at modest scale or materially damage trust. P2 = degrades quality/operability; schedule soon. P3 = polish/backlog.**

---

## P0 — Critical

### P0-1 · Every SPA session dies silently after 15 minutes
**What breaks:** Access tokens live 15 min and are held in memory. No app proactively refreshes, and no API client retries a 401 by calling `/auth/refresh` (only the one-shot refresh at page load). After 15 minutes, every request 401s: diners lose bookings mid-flow (the booking flow redirects to `/login`, losing selected slot), owners' dashboards stop updating, mutations fail. The dashboard WebSocket is force-closed at token expiry with code 4001, and the client only reconnects for codes < 4000 — so the "Live" feed dies permanently after ≤15 min on every open dashboard tab, exactly the screen a restaurant keeps open all evening.
**Why:** `apps/*/src/lib/api.ts` has no 401→refresh→retry interceptor; `useBookingWebSocket.ts` line 62 (`ev.code < 4000`); `plugins/websocket.ts` expiry timer.
**Fix involves:** a shared fetch wrapper that on 401 (a) calls `/auth/refresh` once (de-duplicated across concurrent requests), (b) retries the original request, (c) logs out on refresh failure; plus scheduling a refresh ~1 min before `accessTokenExpiresAt` (already returned by the API); and WS reconnect-with-fresh-token on 4001.

### P0-2 · Redis outage logs out the entire platform
**What breaks:** `authenticate` calls `ensureRedisConnected(1500)` + a deny-list GET on **every request**, inside a try/catch whose catch returns **401 "Invalid or expired token"**. If Upstash blips (or the 2 s command timeout trips under load), every authenticated request on the platform 401s; combined with P0-1, every user is dumped to the login screen (and login itself may also fail since lockout checks are best-effort but token issuance still works). Redis is also a hard dependency of webhooks (500s) and password reset.
**Why:** `plugins/authenticate.ts` — the Redis error is indistinguishable from a bad token.
**Fix involves:** deciding a fail-open-vs-closed policy for the deny list (e.g., short-lived in-process cache of deny entries, treat Redis errors as "not revoked" with alerting, or return 503 instead of 401 so clients don't destroy sessions), and removing the per-request DB user lookup or caching it.

### P0-3 · Cross-tenant table blocking via walk-in `tableIds` (security)
**What breaks:** `createWalkIn` accepts optional `tableIds` and passes them straight into `createWithAllocation`, which uses them **without verifying they belong to the target restaurant** (the STANDARD branch: `if (params.tableIds?.length) { tableIds = params.tableIds; }` — contrast with the override path, which validates). Any owner (or trial signup) can create walk-ins holding **another restaurant's tables**, making them unavailable for hours/days — an invisible denial-of-service against competitors, and the victim cannot see why availability is gone (the holds don't appear in their reservation list).
Also unvalidated: the same param path for CUSTOM/until-close bookings (`tableIds = params.tableIds?.length ? params.tableIds : resolved.tableIds` — client tables paired with an `endsAt` computed for *different* tables), and `StaffCreateReservationSchema.dinerId` lets an owner attach any user UUID to a reservation (it then appears in that diner's list and triggers emails to them).
**Fix involves:** in `createWithAllocation`/`createWalkIn`, verify every provided tableId is `{restaurantId, isActive: true}` (one `findMany` + count compare, as the override path does); drop or verify `dinerId` (e.g., require the diner to have booked there before, or remove the field until there's a real use case).

### P0-4 · Every reservation email shows the wrong time
**What breaks:** `email.service.ts` `fmtTime()` calls `new Date(iso).toLocaleString('en-US', {...})` with **no `timeZone`** — times render in the API server's timezone (typically UTC in prod). A diner booking 7:30 PM in Paris gets "5:30 PM" in their confirmation. Wrong-time confirmations are the single most damaging correctness bug a reservation product can ship: diners show up at the wrong hour and blame the restaurant.
**Fix involves:** pass the restaurant's IANA timezone through the worker (`fetchEmailData` already fetches the restaurant — add `timezone`) and format with `timeZone` + an explicit tz label in the copy.

### P0-5 · No weekly schedule, closed days, or blackout dates — diners can book when the restaurant is closed
**What breaks:** The model has exactly one `openMinutes/closeMinutes` window applied to **all seven days, every day of the year**. Real independent restaurants close Mondays, have different weekend hours, split lunch/dinner service, close for vacations, and often serve past midnight. Today: (a) a restaurant closed on Mondays takes Monday bookings it must manually cancel; (b) a 12:00–14:30 / 19:00–23:00 restaurant shows bookable 15:00 slots; (c) overnight service (18:00–02:00) is **impossible to configure** (DB CHECK `close > open`) except by lying with "24 hours"; (d) the only vacation tool is deactivating the whole listing. Additionally, the *API* never checks the service window at all on `POST /reservations` — any future instant with a free table books successfully (3 AM bookings via crafted requests), because only the availability *listing* respects the window.
**Why:** schema `restaurants.openMinutes/closeMinutes`; `createWithAllocation` has no window validation.
**Fix involves:** (short-term) validate `startsAt`/`endsAt` against the service window server-side and add a per-restaurant "closed dates" table checked in availability + booking; (real fix) a `service_periods` table (dayOfWeek, open, close, allowing overnight wrap) replacing the two columns, feeding `serviceWindowBounds`. This is a data-model change touching engine, availability, both frontends, and seeds — the most invasive P0, but the product is not usable by most real restaurants without it.

### P0-6 · Reservation abuse: free unlimited bookings that consume the *owner's* paid quota
**What breaks:** Diner accounts are free (Turnstile optional), booking is free, there's no per-diner cap on active reservations, no duplicate detection (same diner can hold 10 tables at the same hour across restaurants or even the same restaurant), no minimum notice, and no advance-booking horizon (year-3000 bookings accepted). Meanwhile `assertReservationPlanLimit` counts **all non-cancelled reservations against the owner's monthly quota** — so one hostile or clumsy actor with a couple of diner accounts can (a) book out a restaurant's tables for prime time indefinitely at zero cost, and (b) burn a Starter restaurant's 200-reservation monthly quota with fake bookings, after which *real* diners see "This restaurant has reached its monthly limit… The owner needs to upgrade" (which also leaks billing status and looks like the restaurant's fault). No-showing costs the attacker nothing.
**Fix involves:** per-diner limits (e.g., max N upcoming reservations, max 1 per restaurant per time window), booking horizon + minimum-notice settings, excluding owner-cancelled/no-show rows from quota (or counting quota per seated/honored reservation), rate limiting `POST /reservations` per user, and ideally requiring verified email before booking.

### P0-7 · Concurrent refresh rotation → 500s and random logouts
**What breaks:** Two simultaneous `/auth/refresh` calls with the same cookie (multiple tabs, or a mobile client retrying over flaky networks — guaranteed at scale) both pass `findFirst`, then both `delete` the row; the loser throws Prisma P2025, which is not an `AppError`, so the route returns **500** — and because the winner already rotated the cookie, the losing tab holds a dead refresh token and the user is logged out. With P0-1 this multiplies.
**Fix involves:** make rotation race-safe: `deleteMany({where:{tokenHash, revokedAt:null}})` and check `count===1`, or catch P2025 → 401; better, allow a short grace window where the previous token remains valid once (standard rotation practice), and return 401 (not 500) on any rotation race.

---

## P1 — High

### P1-1 · Conflict/suggestion path can issue thousands of sequential DB queries
`findNextAvailableStart` walks up to 7 days × ~52+ 15-min steps, calling `resolveDurationMins` (a DB query) **inside the loop** and `findBestFitUnit` per step, which itself runs one occupancy query **per candidate unit** until one fits. A fully-booked 20-table restaurant ≈ several thousand sequential queries in one request — and this executes precisely on booking conflicts (the hot-restaurant, high-contention moment) and on every "no table available" miss. Under a Friday-night spike this saturates the pooled connection and the 30 s request timeout. **Fix:** hoist duration out of the loop, reuse `loadDayOccupancy` + the in-memory checker (already implemented for `computeAvailabilityTimes`) so the whole scan costs ~1 query per day.

### P1-2 · Search-with-availability fans out ~3 queries × 100 restaurants, uncached, public
`searchRestaurants` with `date&partySize` runs `computeAvailabilityTimes` for up to 100 restaurants in `Promise.all` (~300 queries/request) on an anonymous endpoint. A handful of concurrent searches exhausts the pool; also results are silently limited to the first 100 restaurants (arbitrary subset once the platform exceeds 100 in a city). **Fix:** cache per-restaurant day availability (the Redis cache already exists — reuse it here), bound concurrency, precompute "has availability" flags, or move this to a background-maintained index.

### P1-3 · Owner reservation list is unusable at volume and shows browser-local times
Page-1-only (no pagination UI), `startsAt asc` with no default date filter → the panel permanently shows the 20 **oldest** reservations; today's bookings are unreachable. Times render via date-fns in the device timezone (wrong for owners managing a restaurant in another tz, and inconsistent with the diner flow which correctly uses restaurant tz). The dashboard also lacks UI for walk-in/staff/override/extend/free-early even though the API supports them — floor staff can't log a walk-in, so those tables look free online while occupied. **Fix:** default the list to "today" (param exists server-side), paginate, format in restaurant tz, add walk-in/override UI.

### P1-4 · Rate-limit identity is spoofable if the origin is reachable; per-IP limits punish shared IPs
`getRealIp` trusts `CF-Connecting-IP` unconditionally and `trustProxy: true` is unconditional. `CF_ORIGIN_SECRET` is optional — if unset (or firewall gap), an attacker hitting the origin directly forges any IP per request, nullifying login limits, threat bans, and lockouts. Conversely, real users behind CGNAT/campus NAT share 5 login attempts/15 min and 3 registrations/hour — one busy office lockout away from support tickets. **Fix:** only trust `CF-Connecting-IP` when the peer is a Cloudflare range (or make `CF_ORIGIN_SECRET` mandatory in production), and key login limits by account+IP composite with higher per-IP ceilings.

### P1-5 · Trial expiry strands live reservations; churned-paid owners get free service
When a trial expires, `assertOwnerCanOperate` throws for **everything** — the owner cannot view, seat, or cancel already-booked upcoming reservations (diners keep their confirmations; the restaurant goes dark on the dashboard), and the restaurant **stays publicly listed**; diners hitting "book" get a 403 whose message is written to the owner ("Your 14-day trial has ended…"). Meanwhile a paid subscription that hits `EXPIRED` keeps operating free at STARTER limits forever — a paying Starter customer is strictly worse off than a churned one (subscribe once → let it expire → free Starter). **Fix:** allow read + lifecycle management of existing reservations after trial expiry while blocking *new* inventory; hide/flag non-operable restaurants in search & detail; align EXPIRED behavior with trial-expired (or make both a deliberate, documented grace policy).

### P1-6 · No monitoring, alerting, or error tracking for an unattended system
Failures are pino logs on a single process: email-send failures, Redis flaps, webhook 500s, 23P01 storms, worker crashes — nothing pages anyone, no Sentry/metrics/uptime checks in the codebase, and the notification worker shares the API process (an email backlog or worker crash takes availability down with it, and vice versa). For "thousands of restaurants, no engineer watching," this is a prerequisite, not a nicety. **Fix:** error tracker + log drain + `/health/ready`-based external uptime alerts + BullMQ failed-job alerting; consider running the worker as a separate process.

### P1-7 · Webhook ordering and Redis coupling can corrupt billing state
LS events are applied in arrival order with no `updated_at` guard — a delayed `subscription_updated(active)` arriving after `subscription_expired` resurrects a dead subscription (or vice versa: an early `expired` clobbered by a late `payment_success`). Idempotency and processing both hard-require Redis (500 → LS retries, eventually gives up). Admin plan override doesn't fix `status`, so "comp this TRIALING user to PRO" silently doesn't work until trial machinery is bypassed. **Fix:** store the LS `updated_at` on the subscription and ignore older events; make admin override set a sane status (e.g., ACTIVE with null LS id); alert on webhook failures.

### P1-8 · Malformed IDs and constraint edge-cases return 500s
No route validates `:id`/`:tableId`/… as UUIDs → Prisma P2023 → 500 (e.g., `GET /reservations/abc`, and crawlers hitting `/restaurants/<slug>` — note there is **no slug lookup endpoint** despite slugs existing). Other unhandled-500 paths: duplicate-email registration race (P2002), duplicate table/combination names (P2002 on the unique index), partial table update setting `minPartySize > maxPartySize` (DB CHECK violation), staff CUSTOM booking without `durationMins` (NaN date), config update where only one of open/close is sent and violates the DB window CHECK. Each 500 also feeds nothing to the threat detector but does hide real errors in noise. **Fix:** a UUID param schema on all routes, catch P2002/P2023/CHECK violations into 409/422, add the missing zod cross-field refinements (staff CUSTOM, table min≤max on update).

### P1-9 · Client/server disagree on who offers custom reservations
The diner UI decides "this restaurant offers custom durations" from `customFee`/`extraHourFee` being set — but the server only plan-gates the **booking** (and `maxExtraHours` config), not the fee fields themselves (`updateReservationConfig` lets a Starter owner set fees via the API; conversely a Pro owner who charges nothing but wants to allow long stays cannot expose custom durations at all without inventing a fee). Result: diners can walk the whole duration flow and get rejected at confirm with a plan-upsell message about someone else's billing. **Fix:** expose an explicit server-computed `offersCustomReservations` on the public restaurant payload (plan ∧ config), and plan-gate the fee fields consistently.

### P1-10 · Prisma + PgBouncer transaction-pooler misconfiguration risk
`.env.example` directs the runtime `DATABASE_URL` at Supabase's **transaction pooler (6543)** but never mentions `?pgbouncer=true`. Without it, Prisma uses named prepared statements and under concurrency you get `prepared statement "s0" already exists` errors — the classic Supabase/Prisma production incident, invisible in single-user dev. Interactive transactions (used for every booking, 20 s timeout) also pin pooled connections; pool sizing (`connection_limit`) is unspecified. **Fix:** document/enforce `pgbouncer=true&connection_limit=…` (check-env could validate), load-test booking bursts against the pooler.

### P1-11 · Owner-quota check and plan limits are check-then-act races
`assertReservationPlanLimit` (count, then insert), restaurant/table/combination limits — all race under concurrency: parallel requests can exceed any quota. Mostly monetization leakage (bounded), but the reservation quota interacts with P0-6. **Fix:** accept small overshoot but enforce periodically, or use transactional counts/advisory locks where it matters.

---

## P2 — Medium

- **P2-1 · Status filters lie after the fact.** `deriveDisplayStatus` shows SCHEDULED/SEATED rows as "COMPLETED" once `endsAt` passes, but DB status never changes: filtering `status=SCHEDULED` returns rows badged COMPLETED; filtering `COMPLETED` misses them; no-show can't be marked after `endsAt`+display flip confusion; analytics on raw status are wrong. Fix: a periodic job (or on-read reconciliation) that actually completes past reservations.
- **P2-2 · Walk-in emails to `guest@walk-in.local`.** Every walk-in triggers a "confirmation" to a dead domain — guaranteed bounces will damage Resend/domain reputation until confirmations start landing in spam. Fix: skip diner-side emails when `dinerId` is null.
- **P2-3 · No booking idempotency.** `POST /reservations` has no idempotency key; a mobile client that times out and retries creates two reservations (different tables, same diner/time — exclusion doesn't help). Fix: idempotency-key header honored in Redis, and/or same-diner overlapping-reservation guard (also partially addresses P0-6).
- **P2-4 · Unbounded growth of `refresh_tokens`, `audit_logs`, and `reservation_tables`.** No TTL cleanup jobs exist (the index comment promises one). Every login inserts a refresh row; audit logs grow forever; released holds are kept. At thousands of users this is slow bloat; at scale it degrades the hot exclusion-constraint index. Fix: scheduled cleanup (expired tokens, audit retention policy, optionally archive old holds).
- **P2-5 · Bcryptjs (pure-JS) at cost 12 on the request path.** ~100–300 ms of *event-loop-blocking* CPU per login/registration; a burst of logins visibly stalls all requests on the single process. Fix: native `bcrypt` or `argon2`, or offload to a worker thread.
- **P2-6 · Timezone edges in the booking UI.** Scan dates are computed from browser-UTC "today" (`toISOString().slice(0,10)`), not restaurant-local — near midnight the 7-day scan can start on the wrong day for the restaurant; MyBookings uses device tz (P1-3 covers dashboard). DST spring-forward local times resolve shifted rather than rejected. Fix: derive scan dates in restaurant tz; format all reservation times in restaurant tz everywhere.
- **P2-7 · Combinations can include deactivated tables.** Deactivating a table doesn't touch combinations referencing it, so FLEXIBLE restaurants can still receive bookings that hold a "removed" table. Similarly, plan downgrades don't deactivate now-over-limit combinations/tables (counts are only checked on *create*). Fix: cascade deactivation checks into `loadBookableUnits` (filter combos with inactive members) and/or on table update.
- **P2-8 · Availability cache invalidation misses adjacent dates.** Invalidation targets only the reservation's start date in restaurant tz; an until-close/extended reservation crossing midnight leaves the next day's cached availability stale up to 300 s. Also `getAvailability` recomputes `resolveDurationMins` + `serviceWindowBounds` on every request even on cache hit (2 extra queries). Low impact, easy fix.
- **P2-9 · WS access token in the query string.** `GET /ws?token=…` puts a bearer token in URLs (proxy/CDN logs). Also the WS URL is built from `window.location.host + '/api/ws'` while REST honors `VITE_API_URL` — deploying API on a separate origin breaks WS silently. Fix: subprotocol/first-message auth or short-lived ticket; derive WS base from `VITE_API_URL`.
- **P2-10 · CI cannot actually run the API test suite.** Tests are integration tests needing a real `DATABASE_URL`/Redis via `.env` (vitest config loads it; none provided in CI), and they mutate whatever database they point at (developer runs hit the shared dev DB). Either CI is red/vacuous or it depends on unseen secrets. Fix: ephemeral Postgres+Redis services in CI; never point tests at a shared/prod DB.
- **P2-11 · Register→login double rate-limit trap.** Registration auto-logs-in (`register()` calls `login()`), so a registration consumes a login-limit slot too; 3 registrations/hour/IP + Turnstile mean a shared-IP signup event (restaurant staff onboarding) hits walls quickly. Also `CreateReservationSchema` caps party at 50 while the web UI caps at 20 — restaurants with banquet tables >20 can't take those bookings online. Product-review both numbers.
- **P2-12 · CORS misconfig returns 500s** (`cb(new Error(...))` → generic error handler) and the browser shows opaque failures for disallowed origins; return a 403 cleanly. Also `upgradeInsecureRequests` in an API CSP is harmless but pointless.
- **P2-13 · Trial/plan data duplicated client-side.** `apps/dashboard/src/lib/plan-limits.ts` hardcodes prices/limits that also live in `lib/plan.ts` (server) — they will drift (the server already sends `planComparison`; the client fallback should be removed or minimal).

## P3 — Lower priority / backlog

- **P3-1** No reminder emails, no post-visit flow, no auto-no-show — owners must remember to act; diners get no day-of reminder (biggest real-world no-show reducer).
- **P3-2** 15-minute availability step is fixed; owners can't choose 30/60-min granularity or pacing (max covers per 15-min window) — high-volume restaurants will find slots too dense, tiny kitchens will get slammed by simultaneous seatings.
- **P3-3** `GET /reservations/:id` and diner cancel have no modify/reschedule path — diners must cancel + rebook (losing the slot to races). Consider "change time" that books-then-releases atomically.
- **P3-4** Emails are minimal HTML with no restaurant address/phone, no cancel link, no calendar attachment (.ics), and cancellation emails omit the diner's reference in the owner-cancel case.
- **P3-5** Search has no geo (city string match only), no cursor pagination; `q` doesn't match city/cuisine simultaneously; `createdAt desc` ordering means new restaurants dominate.
- **P3-6** `serviceWindowBounds` for 24 h restaurants makes "until close" end at local midnight — surprising mid-evening cap for a 24 h venue.
- **P3-7** In-process maps (`wsConnectionsByIp`, pubsub listeners) and the in-process worker assume a **single instance**; before scaling horizontally, move WS caps to Redis and the worker to its own deployment (BullMQ + notifyOnce already tolerate multiple workers).
- **P3-8** `load-test.ts` header/comments reference the retired SELECT-FOR-UPDATE/slot-capacity model; `packages/types` is hand-maintained and can drift from Prisma; `packages/ui`/`config` are empty shells; `admin/bookings` + assorted `@deprecated` aliases linger from the old model — cleanup pass.
- **P3-9** Admin: `getStats` counts diners in two separate identical queries; no admin UI/API to force-logout a user (ban deletes refresh tokens but active access tokens live ≤15 min — acceptable, but deny-list them for immediacy).
- **P3-10** `forgotPassword` writes the Redis reset token before attempting the email; if Resend fails the token exists but the user got nothing (harmless), yet the API still returns success — consider surfacing "try again later" on known Resend outages. Also multiple outstanding reset tokens per user are all valid until TTL (only the used one is deleted).
- **P3-11** Registration role choice (`diner`/`owner`) is unauthenticated and free — expect junk owner accounts + trial restaurants polluting search; consider owner verification or delisting restaurants with no tables/activity.
- **P3-12** `.env` sits in the repo working tree (gitignored, but on a dev Windows box) holding production-grade secrets per `.env.example` guidance; `backups/*.json` hold real user data locally. Fine for now — document handling, rotate before launch.

---

## Suggested execution order

1. **Week 1 (stop-the-bleeding):** P0-1 (token refresh + WS reconnect), P0-4 (email timezones), P0-3 (tableIds validation), P0-7 (refresh race), P1-8 (UUID/422 hardening — small).
2. **Week 2 (resilience):** P0-2 (Redis policy in auth), P1-10 (pgbouncer config + load test), P1-6 (monitoring/alerting), P1-7 (webhook ordering).
3. **Weeks 3–4 (product viability):** P0-5 (schedules/closed days — biggest scope), P0-6 (abuse limits), P1-3 (owner reservation UX + walk-in UI), P1-5 (trial-expiry behavior), P1-9 (custom-reservation gating).
4. **Then:** P1-1/P1-2 (engine query efficiency) before any marketing push, followed by the P2 list.
