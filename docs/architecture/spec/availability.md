# Spec · Availability & Restaurant Config

> Owns: `apps/api/src/modules/restaurant/*`, `apps/api/src/lib/availability-cache.ts`
> Related: [reservation.md](reservation.md) (engine that computes; mutations that invalidate),
> [billing.md](billing.md) (plan limits gate config; operability gates writes)

## Purpose

Serve public restaurant discovery (search + detail + availability) fast and correctly, and
let owners manage the config that drives it (tables, combinations, turn-time rules, weekly
service periods, closures, fees, logo).

## Responsibilities

- Public reads: `GET /restaurants` (search w/ availability filter), `GET /restaurants/:id`,
  `GET /restaurants/:id/availability` — **no auth** (`restaurant.routes.ts`).
- Owner config CRUD gated `[authenticate, requireRole('owner')]` + plan-limit checks; the
  email-verified gate on restaurant creation (`restaurant.routes.ts:82-105`).
- The availability cache: versioned full-response entries + two invalidation channels.
- Logo upload validation and storage (R2 in prod / local disk in dev, INV-15).

## Architecture (stable — do not silently break)

1. **Cache is advisory, engine is truth** — cached availability is a performance layer over
   the engine + exclusion constraint; a stale entry can never cause a double-booking (the
   booking tx re-checks; [reservation.md](reservation.md) §1). It *can* cause phantom
   unavailability, which is why invalidation completeness matters.
2. **Versioned full-response cache** (D-1, INV-9): entries store `{v, payload}` under
   `restaurant:{id}:availability:{date}:...`; a per-restaurant version counter
   `restaurant:{id}:availver` is INCR'd on config change, and readers treat any version
   mismatch as a miss (`availability-cache.ts:64,82-101`). Two invalidation channels, used
   deliberately:
   - **per-date delete** after reservation mutations (start **and** end date if the window
     crosses midnight — `reservation.service.ts:93-114`);
   - **version bump** after config mutations (O(1) across all dates, INV-9) — called after
     every config write (`restaurant.service.ts:733,803,926,1166,1188,1213`).
   Every new config mutation **must** call `bumpAvailabilityVersion`; every new
   reservation-shaped mutation must invalidate its date(s).
3. **Search is a 5-gate cache-first pipeline** (D-2): candidate query (cap
   `SEARCH_AVAILABILITY_CANDIDATES=100`) → MGET cached entries → compute misses with
   bounded concurrency (`SEARCH_COMPUTE_CONCURRENCY=6`) → final findMany+count in one
   `$transaction` (`restaurant.service.ts:186-353,386`). Billing/operability is **never
   cached** — computed live from the joined subscription row (`:487-494`).
4. **Cache key shape is a writer/reader contract** (HC-3): `availabilityCacheKey`
   (`availability-cache.ts:12`) is the only legitimate key builder; detail and search
   readers must use it, never hand-build keys.
5. **Weekly schedule model**: `service_periods` rows (overnight encoded `closeMinute <=
   openMinute`, D-9) with a **legacy fallback** — zero rows ⇒ synthesized 7-day uniform
   window from `restaurants.openMinutes/closeMinutes` (D-10, `service-schedule.ts:56-64`).
   The API guards "min 1 window" (`restaurant.schema.ts:163-169`), but the fallback means
   DB-level row deletion re-opens the restaurant all-day (CI-G7) — never delete periods
   without going through the API path.
6. **Tenant gate**: `assertRestaurantOwner` → 404 (not 403) for non-owned restaurants
   (`restaurant.service.ts:39-48`) — no existence oracle. Keep 404 semantics.

## Boundaries

- Imports allowed: `lib/*`, `@restaurant/db`, and **only**
  `modules/subscription/subscription.service` (operability + plan limits). The one
  route-level reach-in (`assertOwnerRestaurantPlanLimit` called from
  `restaurant.routes.ts:105`, B-2) exists; do not add more route→foreign-service edges.
- `availability-cache.ts` is lib: no module imports, Redis only via `getRedisClient`.
- Public read routes are unauthenticated by design; anything owner-mutating goes through
  `requireRole('owner')` + ownership assert.

## Verified invariants (guards in [../INVARIANTS.md](../INVARIANTS.md))

| ID | Statement | Anchor |
|---|---|---|
| INV-9 | Version INCR invalidates all cached dates in O(1); mismatched version = miss | `availability-cache.ts:64,96` |
| INV-10 | Operability identical on DB and pure paths (single classifier) | `subscription.service.ts:86,144,224` (consumed here `restaurant.service.ts:460-494`) |
| INV-15 | Logo: magic-byte sniff, 2 MB cap, path-traversal guard, prod-disabled local route | `image-validation.ts:14,30`, `r2-storage.ts:20,109-114` |
| — | Tenant 404 (no oracle) on non-owned config access | `restaurant.service.ts:46-48` |

## Implementation details (volatile)

TTL 300 s, per-date index sets, candidate cap & concurrency values, `pg_trgm` search
specifics, cuisine enum, `deriveDisplayStatus` interplay on detail payloads, legacy
open/close columns (scheduled for removal only via migration + fallback retirement).

## Extension points — where new code belongs

- **New config entity** (e.g. seating areas): service CRUD in `restaurant.service.ts` with
  `assertRestaurantOwner` first + `bumpAvailabilityVersion` after commit; schema in
  `restaurant.schema.ts`; count-limit checks go through plan limits
  ([billing.md](billing.md)) — and note the existing config limits are check-then-act
  (P1-11 residual): a new limit that must be exact needs the INV-8 advisory-lock pattern.
- **New search facet**: extend the candidate query gate, not post-filtering after
  computation — keep the pipeline's cost model (gates cheapest-first).
- **New cached read**: reuse `availabilityCacheKey`/`parseEntry` + version check; register
  any new Redis prefix in [platform.md](platform.md)'s keyspace.

## Evolution guidance

- Intentionally flexible: TTLs, caps, concurrency, search ranking, cuisine taxonomy.
- Retiring the legacy open/close fallback (D-10/CI-G7) requires a backfill migration
  creating explicit periods first — the fallback is load-bearing until then.
- If per-restaurant step size (CI-G2) or table priorities (CI-G3) are introduced, they are
  engine concerns — see [reservation.md](reservation.md), not new cache dimensions.

## Common mistakes

- Config mutation without `bumpAvailabilityVersion` — silently serves stale availability
  until TTL; the version bump list in §2 must grow with every new mutation.
- Hand-building cache keys (HC-3) or caching operability/billing state (§3 — must stay live).
- Returning 403 for non-owned resources (existence oracle) — the contract is 404.
- Treating a cache hit as authoritative for booking decisions — only the constraint is.
- Adding an unauthenticated read that joins subscription/billing data without going through
  the operability classifier (INV-10).

## Open findings (see [../BACKLOG.md](../BACKLOG.md))

P2-7/CI-A2 (combination member-table active state) · CI-G1 (turn-band overlap unchecked at
create, `restaurant.service.ts:1013-1036`) · CI-G7 (fallback re-opens on row deletion) ·
P1-11-residual (config count limits check-then-act) · NEW-H1 (window math shifted for
non-UTC timezones — via `service-schedule.ts` → `zonedTimeToUtc`).

## Anchors

`restaurant.routes.ts:21-105` · `restaurant.service.ts:39-1213` ·
`availability-cache.ts:4-194` · `service-schedule.ts:56-165` · `restaurant.schema.ts:25,163-169` ·
`image-validation.ts:14-30` · `r2-storage.ts:9-114` · guards:
`__tests__/guards/reservation.guard.test.ts` (tenant/tableIds), existing
`availability-cache.test.ts`, `search-availability.test.ts`
