# PROJECT_CONTEXT.md
<!-- This file is the single source of truth for Claude + Cursor cross-session context.
     Cursor must update it at the end of every prompt. Claude must read it at the start of every session. -->

---

## 0 · PROJECT SNAPSHOT

| Key | Value |
|-----|-------|
| Project | Restaurant reservation platform |
| Monorepo tool | pnpm + Turborepo |
| Backend | Node.js + Fastify (`apps/api`) |
| Frontend (diner) | React SPA (`apps/web`) |
| Frontend (owner) | React SPA (`apps/dashboard`) |
| Database | PostgreSQL via Prisma on **Supabase** (`packages/db`) |
| Cache / pub-sub | **Redis** (Upstash or local Docker for dev) |
| Queue | Message queue (BullMQ or similar) |
| Shared types | `packages/types` |
| Shared config | `packages/config` (ESLint, Prettier, tsconfig) |
| Shared UI | `packages/ui` |
| Auth | JWT (RS256) — Access token (15 min) + Refresh token (7 days); API live at `http://localhost:3001`; 33 Vitest integration tests |
| Real-time | WebSocket (owner dashboard) via Redis pub/sub |
| Security layers | TLS, rate-limit (Redis counter), JWT validation, mTLS internal, RBAC, optimistic locking |
| CI/CD | GitHub Actions → staging (auto) → production (manual gate) |
| Local dev DB | Supabase (hosted PostgreSQL — Docker not available on dev machine) |
| Local dev Redis | Upstash (hosted Redis — Docker not available on dev machine) |

---

## 1 · ARCHITECTURE DECISIONS (locked)

- `user_id` is **always** read from the verified JWT, never from the request body.
- `owner_id` in JWT must match `restaurant.owner_id` in DB — enforced server-side only.
- Booking uses **optimistic locking** (`SELECT FOR UPDATE`) to prevent double-booking.
- Slot cache is invalidated in Redis after every successful booking.
- Notifications (email diner + alert owner) fire **async** via queue after `201` is returned.
- Gateway handles: TLS termination, rate-limit (`429`), JWT verify (`401`), request logging.
- Services communicate internally over **mTLS** — gateway never touches DB directly.
- Roles: `diner` | `owner` only — defined in `packages/types`.
- **Database:** Supabase PostgreSQL — `DATABASE_URL` (pooled, port 6543) for runtime; `DIRECT_DATABASE_URL` (port 5432) for Prisma migrations only.
- **Cache / queue:** Redis via `REDIS_URL` (Upstash in cloud; optional local Docker via `pnpm redis:up`).
- **Auth:** Custom JWT (RS256) — not Supabase Auth. `SUPABASE_*` keys are for project metadata only unless extended later.
- Local development uses **Supabase** (hosted PostgreSQL) and **Upstash** (hosted Redis) instead of Docker — virtualization unavailable on dev machine. This mirrors the production architecture exactly and is the preferred setup going forward.

---

## 2 · ENGINEERING PHASES

| # | Phase | Status | Tasks |
|---|-------|--------|-------|
| 1 | Foundation | ✅ Done (4 of 4 tasks done) | Monorepo init, shared TS contracts, CI/CD, infra provision |
| 2 | Auth service | ✅ Done (2 of 2 tasks done) | Register, login, JWT issue/refresh/revoke, RBAC middleware, integration tests |
| 3 | Restaurant service | ⬜ Not started | CRUD listings, availability slots, search/filter, media upload |
| 4 | Booking service | ⬜ Not started | Create booking (optimistic lock), cancel, list, WebSocket events |
| 5 | Notification service | ⬜ Not started | Queue consumer, email diner, alert owner (async) |
| 6 | Frontend | ⬜ Not started | Diner web app + Owner dashboard (React, JWT storage, WebSocket) |
| 7 | QA & Launch | ⬜ Not started | Unit tests, integration tests, load test (concurrent booking), prod checklist |

---

## 3 · TASK COMPLETION LOG
<!-- Cursor appends here after every prompt. Format shown below. Do NOT delete old entries. -->

<!-- TEMPLATE — copy and fill per task:
### ✅ Phase X · Task Y — [Task title]
**Date:** YYYY-MM-DD
**Files created / modified:**
- `path/to/file.ts` — what it does
**Interfaces / types added:**
- `InterfaceName` — short description
**API endpoints added:**
- `METHOD /route` — what it does
**Environment variables added:**
- `VAR_NAME` — what it's for
**Notes:** anything Claude must know next session
-->

### ✅ Phase 1 · Task 1 — Initialise monorepo structure
**Date:** 2026-06-22
**Files created / modified:**
- `package.json` — root workspace config (pnpm + Turborepo)
- `pnpm-workspace.yaml` — declares apps/* and packages/*
- `turbo.json` — pipeline: build, dev, lint, typecheck, test
- `packages/config/tsconfig.base.json` — strict TS base config
- `packages/config/.eslintrc.base.js` — shared ESLint rules
- `packages/config/.prettierrc.json` — shared Prettier config
- `packages/types/src/index.ts` — all shared domain types
- `apps/api/src/index.ts` — empty scaffold
- `apps/web/src/index.ts` — empty scaffold
- `apps/dashboard/src/index.ts` — empty scaffold
- `packages/db/src/index.ts` — empty Prisma placeholder
- `packages/ui/src/index.ts` — empty UI placeholder
- `.gitignore` — covers all build artifacts
- `.env.example` — all required env var keys documented
**Interfaces / types added:**
- `Role` — 'diner' | 'owner' union type
- `JWTPayload` — sub, role, jti, iat, exp
- `Booking` — full booking entity
- `TimeSlot` — slot with capacity and booked count
- `Restaurant` — full restaurant entity
- `User` — user entity (no password field)
**API endpoints added:** None
**Environment variables added:**
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_PRIVATE_KEY` — RS256 private key for signing tokens
- `JWT_PUBLIC_KEY` — RS256 public key for verification
- `NODE_ENV` — environment flag
- `PORT` — API server port (default 3001)
- `QUEUE_NAME` — message queue name (default: booking_events)
**Notes:** User must run `pnpm install` from the root after this step. No app is executable yet — all are empty scaffolds. Next: Phase 1 Task 2 — CI/CD pipeline.

### ✅ Phase 1 · Task 2 — CI/CD Pipeline
**Date:** 2026-06-22
**Files created / modified:**
- `.github/workflows/ci.yml` — lint, typecheck, test, build on every push/PR
- `.github/workflows/deploy-staging.yml` — auto-deploy to staging on merge to main
- `.github/workflows/deploy-prod.yml` — manual-only production deploy with DEPLOY confirmation gate
- `.github/CODEOWNERS` — protects workflows/, auth paths, db, .env.example
- `.github/pull_request_template.md` — enforces security + checklist on every PR
**Interfaces / types added:** None
**API endpoints added:** None
**Environment variables added:**
- `STAGING_DATABASE_URL` — staging DB (GitHub Secret: staging environment)
- `STAGING_REDIS_URL` — staging Redis (GitHub Secret: staging environment)
- `STAGING_JWT_PRIVATE_KEY` — staging JWT signing key (GitHub Secret)
- `STAGING_JWT_PUBLIC_KEY` — staging JWT verify key (GitHub Secret)
- `PROD_DATABASE_URL` — production DB (GitHub Secret: production environment)
- `PROD_REDIS_URL` — production Redis (GitHub Secret: production environment)
- `PROD_JWT_PRIVATE_KEY` — production JWT signing key (GitHub Secret)
- `PROD_JWT_PUBLIC_KEY` — production JWT verify key (GitHub Secret)
**Notes:** Deploy steps are stubbed with echo placeholders — real deploy commands (Railway, Vercel, Render, etc.) will be filled in during Phase 7 (QA & Launch). Branch protection rules must be enabled manually in GitHub repo settings: require PR + CI pass before merge to main. CODEOWNERS uses @majidifounder.

### ✅ Phase 1 · Task 3 — Infrastructure provision + full database schema
**Date:** 2026-06-22
**Files created / modified:**
- `docker-compose.yml` — PostgreSQL 16 + Redis 7 for local dev with health checks
- `packages/db/init/00_extensions.sql` — pgcrypto, pg_trgm, citext extensions
- `packages/db/package.json` — Prisma deps, db:migrate/seed/reset scripts
- `packages/db/prisma/schema.prisma` — full production schema: User, RefreshToken, Restaurant, TimeSlot, Booking, AuditLog
- `packages/db/prisma/migrations/20260101000001_constraints_and_rls/migration.sql` — CHECK constraints, trigram indexes, partial indexes, RLS policies
- `packages/db/src/index.ts` — Prisma singleton + withUserContext helper (sets app.user_id for RLS)
- `packages/db/src/seed.ts` — idempotent seed: 2 owners, 10 diners, 4 restaurants, 112 slots, bookings
- `.env.example` — updated with DATABASE_URL, DIRECT_DATABASE_URL, Docker vars
- `package.json` — added db:up, db:down, db:migrate, db:seed, db:studio, db:reset scripts
**Interfaces / types added:**
- `Role` enum — DINER | OWNER (Prisma)
- `BookingStatus` enum — PENDING | CONFIRMED | CANCELLED | NO_SHOW (Prisma)
- `CuisineType` enum — ITALIAN | FRENCH | JAPANESE | ... | OTHER (Prisma)
**API endpoints added:** None
**Environment variables added:**
- `DIRECT_DATABASE_URL` — direct DB URL for Prisma migrations (bypasses PgBouncer)
- `POSTGRES_USER` — Docker compose Postgres username
- `POSTGRES_PASSWORD` — Docker compose Postgres password
- `POSTGRES_DB` — Docker compose database name
- `REDIS_PASSWORD` — Redis auth password
**Notes:**
- Run `docker compose up -d` then `pnpm db:migrate` then `pnpm db:seed` to initialise local DB.
- `withUserContext(userId, fn)` MUST be called before any query that relies on RLS — it sets `app.user_id` for the transaction.
- AuditLog is append-only — app_user has no UPDATE/DELETE on that table.
- Slot id `[seed output id]` is fully booked in seed data — use it to test 409 responses.
- Next: Phase 2 — Auth service (register, login, JWT RS256, refresh, revoke, RBAC middleware).

### ✅ Infra pivot — Supabase + Redis
**Date:** 2026-06-23
**Files created / modified:**
- `docker-compose.yml` — Redis only (optional local dev); Postgres removed
- `.env.example` — Supabase `DATABASE_URL` / `DIRECT_DATABASE_URL`, `SUPABASE_*`, `REDIS_URL`
- `packages/db/sql/supabase_enable_extensions.sql` — run in Supabase SQL Editor before migrate
- `packages/db/sql/rls_self_hosted_optional.sql` — RLS moved out of Prisma migration (Supabase incompatible)
- `packages/db/prisma/migrations/20260101000001_constraints_and_rls/migration.sql` — constraints + indexes only
- `package.json` — `redis:up` / `redis:down`; `db:up` now starts Redis only
- `packages/db/src/index.ts` — updated `withUserContext` comment for Supabase
**Interfaces / types added:** None
**API endpoints added:** None
**Environment variables added:**
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — public anon key (optional, future client features)
- `SUPABASE_SERVICE_ROLE_KEY` — server-only (optional; never expose to browser)
**Environment variables removed:**
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` — no local Postgres
**Notes:**
- Setup: enable extensions in Supabase → copy connection strings to `.env` → `pnpm db:migrate` → `pnpm db:seed`.
- Redis: set `REDIS_URL` from Upstash, or run `pnpm redis:up` and use `redis://:devredispass@localhost:6379`.
- Do not run `rls_self_hosted_optional.sql` on Supabase.

### ✅ Phase 1 · Task 3b — Infrastructure switch: Docker → Supabase + Upstash
**Date:** 2026-06-23
**Files created / modified:**
- `PROJECT_CONTEXT.md` — updated to reflect cloud infrastructure
**Notes:**
- Docker Desktop fails on dev machine (virtualization not supported in BIOS).
- Switched to Supabase (hosted PostgreSQL) + Upstash (hosted Redis).
- `docker-compose.yml` remains in the repo for future contributors who can run Docker.
- `.env` file (not committed) contains live Supabase DATABASE_URL, DIRECT_DATABASE_URL, and Upstash REDIS_URL.
- All Phase 1 verification steps passed against Supabase:
  - Migration: 2 migrations applied cleanly
  - Seed: 2 owners, 10 diners, 4 restaurants, 112 slots, 12 bookings
  - Fully-booked slot id for 409 testing: 85a899ad-ca52-46ca-ac39-5e0015d0caf3
  - typecheck: 6/6 pass, 0 errors
  - lint: 6/6 pass, 0 errors (3 no-console warnings in seed.ts are intentional)
- Next: Phase 2 — Auth service

### ✅ Phase 2 · Task 1 — Auth Service (server bootstrap + all auth endpoints)
**Date:** 2026-06-23
**Files created / modified:**
- `apps/api/package.json` — api app manifest with all deps
- `apps/api/tsconfig.json` — TS config extending base
- `apps/api/src/env.ts` — Zod env validation; process exits on bad config
- `apps/api/src/lib/redis.ts` — ioredis lazy singleton + subscriber factory
- `apps/api/src/lib/jwt.ts` — RS256 sign/verify helpers; ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS
- `apps/api/src/errors/index.ts` — AppError, UnauthorizedError, ForbiddenError, ConflictError, NotFoundError, UnprocessableError
- `apps/api/src/modules/auth/auth.schema.ts` — RegisterSchema, LoginSchema, RefreshSchema (Zod)
- `apps/api/src/modules/auth/auth.service.ts` — registerUser, loginUser, refreshTokens, logoutUser
- `apps/api/src/modules/auth/auth.routes.ts` — POST /auth/register, POST /auth/login, POST /auth/refresh, POST /auth/logout, GET /auth/me
- `apps/api/src/plugins/authenticate.ts` — authenticate preHandler + requireRole decorator
- `apps/api/src/index.ts` — Fastify server with helmet, cors, rate-limit, cookie, sensible, health check
- `.env.example` — added BCRYPT_ROUNDS, CORS_ORIGIN
- `packages/db/package.json` — added `exports` for ESM workspace resolution
- `packages/types/package.json` — added `exports` for ESM workspace resolution
**Interfaces / types added:** None (using existing types from `@restaurant/types`)
**API endpoints added:**
- `POST /auth/register` — create new user account; 201 on success, 409 on duplicate email, 422 on bad input
- `POST /auth/login` — issue access + refresh token pair; 200 on success, 401 on bad credentials, 429 on rate limit
- `POST /auth/refresh` — rotate token pair; accepts cookie or body; 200 on success, 401 on invalid/expired
- `POST /auth/logout` — revoke tokens; requires Bearer token; 200 on success
- `GET /auth/me` — return current user from DB; requires Bearer token; 200 on success
- `GET /health` — server health check; no auth
**Environment variables added:**
- `BCRYPT_ROUNDS` — bcrypt cost factor, default 12
- `CORS_ORIGIN` — comma-separated allowed origins
**Notes:**
- Refresh token stored as SHA-256 hash in RefreshToken table — raw token never persisted
- `tokenHash` is not `@unique` in schema — service uses `findFirst` + delete by `id` (prompt assumed `findUnique`; adapted to match Prisma schema)
- Logout sets `revokedAt` on refresh token (`updateMany`); refresh rotation deletes old row in transaction
- Logout writes jti to Redis deny-list (key: `deny:{jti}`) with TTL matching token expiry
- `authenticate` plugin decorates `request.user?: JWTPayload`; `requireRole(role)` returns a preHandler (built; not yet used on business routes)
- Login rate limit: 5 attempts per IP per 15 min (separate from global 100/min limit)
- Package scope is `@restaurant/*` (not `@repo/*` from prompt); `dev` script loads root `.env` via `dotenv -e ../../.env`
- `pnpm --filter @restaurant/api typecheck` and `lint` pass (0 errors, 11 warnings)
- **Verification (prompt §15):** all assertions passed — health, register, duplicate 409, login, me, wrong password 401, refresh rotation, old refresh 401, logout, revoked access 401, login rate limit 429 (2026-06-23)
- **Dev machine verified:** register/login/me via PowerShell `Invoke-RestMethod` with user `you@example.com` (2026-06-23)
- Start API: `pnpm --filter @restaurant/api dev` (keep terminal open; kill stale `node.exe` on port 3001 if `EADDRINUSE`)
- Next: Phase 2 · Task 2 — Auth integration tests (Vitest + supertest against test DB)

### ✅ Phase 2 · Task 2 — Auth Integration Tests
**Date:** 2026-06-24
**Files created / modified:**
- `apps/api/vitest.config.ts` — Vitest config; loads root `.env` via dotenv; 30 s timeout for remote datastores; serial execution; forks pool
- `apps/api/src/__tests__/helpers/server.ts` — `buildTestServer()` — Fastify test instance with rate limiting disabled
- `apps/api/src/__tests__/helpers/db.ts` — `cleanupTestUsers(ids[])` — FK-safe DB cleanup scoped to test-created rows only
- `apps/api/src/__tests__/helpers/auth.ts` — `uniqueEmail()`, `registerUser()`, `loginUser()` — test convenience helpers
- `apps/api/src/__tests__/auth.test.ts` — 33 integration tests across all 5 auth endpoints + security invariants
- `apps/api/package.json` — added `test`, `test:watch`, `test:coverage` scripts; devDeps: vitest, @vitest/coverage-v8, dotenv
**Interfaces / types added:** None
**API endpoints added:** None
**Environment variables added:** None (tests use existing `DATABASE_URL` and `REDIS_URL`)
**Notes:**
- Tests use UUID-prefixed emails (`test-{uuid}@integration-test.local`) to isolate from seed data
- `afterAll` deletes all test-created users in FK-safe order (AuditLog → RefreshToken → User)
- Rate limiting is disabled in the test server to avoid polluting Upstash Redis with test counters
- Redis deny-list (logout revocation) IS tested with real Upstash — it is our code, not a library
- Run tests: `pnpm --filter @restaurant/api test` (~110 s against Supabase + Upstash)
- If cleanup fails, run in Supabase SQL editor:
  ```sql
  DELETE FROM audit_logs WHERE "actorId" IN (SELECT id FROM users WHERE email LIKE '%@integration-test.local');
  DELETE FROM refresh_tokens WHERE "userId" IN (SELECT id FROM users WHERE email LIKE '%@integration-test.local');
  DELETE FROM users WHERE email LIKE '%@integration-test.local';
  ```
- **33 tests passed** on 2026-06-24 against Supabase + Upstash; typecheck still passes
- Next: Phase 3 · Task 1 — Restaurant service (CRUD listings, availability slots, search, Redis caching)

---

## 4 · SHARED TYPE CONTRACTS (`packages/types`)
<!-- Cursor updates this section when types are added or changed -->

> **Note:** Prisma enums `Role`, `BookingStatus`, and `CuisineType` in `packages/db/prisma/schema.prisma` are now the source of truth for database-layer types. The TypeScript `Role` type in `packages/types` should import from `@prisma/client` going forward.

```ts
export type Role = 'diner' | 'owner';

export interface JWTPayload {
  sub: string;       // user_id
  role: Role;
  jti: string;
  iat: number;
  exp: number;
}

export interface Booking {
  id: string;
  restaurantId: string;
  dinerId: string;
  slotId: string;
  partySize: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
}

export interface TimeSlot {
  id: string;
  startsAt: string;   // ISO 8601
  capacity: number;
  booked: number;
}

export interface Restaurant {
  id: string;
  ownerId: string;
  name: string;
  cuisine: string;
  description: string;
  address: string;
  imageUrl?: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}
```

---

## 5 · API SURFACE (built so far)
<!-- Cursor updates this section as endpoints are implemented -->

| Method | Route | Service | Auth | Status |
|--------|-------|---------|------|--------|
| GET | `/health` | api | None | ✅ Live |
| POST | `/auth/register` | api | None | ✅ Live |
| POST | `/auth/login` | api | None | ✅ Live |
| POST | `/auth/refresh` | api | Refresh token (cookie or body) | ✅ Live |
| POST | `/auth/logout` | api | Bearer JWT | ✅ Live |
| GET | `/auth/me` | api | Bearer JWT | ✅ Live |

---

## 6 · DATABASE SCHEMA (Prisma — built so far)
<!-- Cursor updates this section as models are added -->

All models defined in `packages/db/prisma/schema.prisma`:
- `User` — id (uuid), email (citext), password (bcrypt), role, soft-delete
- `RefreshToken` — jti, tokenHash (SHA-256), expiresAt, revokedAt
- `Restaurant` — id, ownerId, name, slug, cuisine, city, isActive, soft-delete
- `TimeSlot` — id, restaurantId, startsAt, capacity, booked, isActive
- `Booking` — id, restaurantId, dinerId, slotId, partySize, status, cancelledAt
- `AuditLog` — id, actorId, action, entityType, entityId, metadata, ipAddress (append-only)
RLS policies optional — see `packages/db/sql/rls_self_hosted_optional.sql` (not applied on Supabase; API enforces access)

---

## 7 · ENVIRONMENT VARIABLES
<!-- Cursor appends here as new vars are introduced -->

| Variable | Used in | Set in | Status |
|----------|---------|--------|--------|
| `DATABASE_URL` | `packages/db`, `apps/api` | `.env` (Supabase pooled / port 6543) | Active — Supabase Transaction Pooler URL (port 6543) |
| `REDIS_URL` | `apps/api` | `.env` (Upstash or local Docker) | Active — Upstash Redis URL (rediss://) |
| `JWT_PRIVATE_KEY` | `apps/api` | `.env` | Active — RS256 signing key (PKCS#8 PEM; `\n`-escaped in `.env`) |
| `JWT_PUBLIC_KEY` | `apps/api` | `.env` | Active — RS256 verify key |
| `BCRYPT_ROUNDS` | `apps/api` | `.env` | Defined in .env.example — default 12 |
| `CORS_ORIGIN` | `apps/api` | `.env` | Defined in .env.example — comma-separated origins |
| `NODE_ENV` | all apps | `.env` | Defined in .env.example |
| `PORT` | `apps/api` | `.env` | Defined in .env.example |
| `QUEUE_NAME` | `apps/api` | `.env` | Defined in .env.example |
| `STAGING_DATABASE_URL` | deploy-staging.yml | GitHub Secret (staging env) | Stubbed — needs real value |
| `STAGING_REDIS_URL` | deploy-staging.yml | GitHub Secret (staging env) | Stubbed — needs real value |
| `STAGING_JWT_PRIVATE_KEY` | deploy-staging.yml | GitHub Secret (staging env) | Stubbed — needs real value |
| `STAGING_JWT_PUBLIC_KEY` | deploy-staging.yml | GitHub Secret (staging env) | Stubbed — needs real value |
| `PROD_DATABASE_URL` | deploy-prod.yml | GitHub Secret (production env) | Stubbed — needs real value |
| `PROD_REDIS_URL` | deploy-prod.yml | GitHub Secret (production env) | Stubbed — needs real value |
| `PROD_JWT_PRIVATE_KEY` | deploy-prod.yml | GitHub Secret (production env) | Stubbed — needs real value |
| `PROD_JWT_PUBLIC_KEY` | deploy-prod.yml | GitHub Secret (production env) | Stubbed — needs real value |
| `DIRECT_DATABASE_URL` | `packages/db` | `.env` (Supabase direct / port 5432) | Active — Supabase Direct Connection URL (port 5432) |
| `SUPABASE_URL` | optional | `.env` | Defined in .env.example |
| `SUPABASE_ANON_KEY` | optional | `.env` | Defined in .env.example |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | `.env` | Defined in .env.example |
| `REDIS_PASSWORD` | docker-compose.yml (local Redis only) | `.env` | Defined in .env.example |

---

## 8 · WHAT DOES NOT EXIST YET
<!-- Read this before writing any prompt — prevents calling things that aren't built -->

- ✅ Monorepo scaffold created (Phase 1 · Task 1)
- ✅ Shared TypeScript types written (packages/types)
- ✅ CI/CD pipeline created (.github/workflows/) — deploy steps stubbed, to be filled in Phase 7
- ✅ Full Prisma schema written (packages/db) — User, RefreshToken, Restaurant, TimeSlot, Booking, AuditLog
- ✅ docker-compose.yml exists (for future Docker users) — dev machine uses Supabase + Upstash instead
- ✅ Supabase PostgreSQL connected and migrated (Phase 1 verified)
- ✅ Upstash Redis connected (Phase 1 verified)
- ✅ Seed script ready (idempotent)
- ✅ Auth service complete — register, login, refresh, logout, JWT RS256, Redis deny-list, rate limiting (`apps/api`)
- ✅ RBAC middleware (`requireRole`) — built in `authenticate` plugin; not yet wired to restaurant/booking routes
- ✅ Redis integrated in API — deny-list on logout + global rate limit (Upstash)
- ✅ Auth integration tests complete (33 tests; Vitest + Fastify `inject()`; Supabase + Upstash)
- ❌ No restaurant service
- ❌ No booking service
- ❌ No notification service
- ❌ No frontend apps
- ❌ No queue integration
- ❌ No WebSocket server

---

## 9 · HOW CURSOR MUST UPDATE THIS FILE

At the end of every prompt response, Cursor must:

1. Change the **phase status** in Section 2 from `⬜ Not started` → `🟡 In progress` → `✅ Done`.
2. Append a new entry to **Section 3 (Task Completion Log)** using the template.
3. Update **Section 4** if new types were written.
4. Update **Section 5** if new API endpoints were added.
5. Update **Section 6** if new Prisma models were added.
6. Update **Section 7** if new environment variables are needed.
7. Update **Section 8** — remove items from the "does not exist" list as they get built.

**Cursor must never skip this update.** If it forgets, remind it with: _"Update PROJECT_CONTEXT.md before finishing."_
