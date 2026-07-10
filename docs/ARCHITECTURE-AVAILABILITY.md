# Availability & Search Architecture

*Written 2026-07-10 as part of R15. Read this before touching the availability
read path, the cache, or search. Companion documents:
[PLATFORM_MASTER_PLAN.md](../PLATFORM_MASTER_PLAN.md) (strategy),
[R4-SERVICE-UX.md](R4-SERVICE-UX.md) (dashboard behavior).*

---

## 1. The one invariant

**The reservation engine + the database exclusion constraint are the single
source of truth. Everything else — caches, search results, availability
listings — is advisory.**

A double-booking is impossible not because any cache is fresh but because
`reservation_tables` carries a GiST `EXCLUDE` constraint over
`(tableId, tstzrange(startsAt, endsAt))` for unreleased holds. Every
optimization below may serve stale *suggestions*; none can corrupt *bookings*.
A diner acting on a stale suggestion gets a clean 409 with a fresh
`suggestedNextAvailableAt` — the UX absorbs staleness, the constraint absorbs
races.

This division of labor is what lets the read path be aggressive.

## 2. Read paths, slowest truth to fastest suggestion

| Path | Freshness | Cost | Used by |
|---|---|---|---|
| Booking transaction | Absolute (constraint) | 1 interactive tx | `POST /reservations`, walk-in/staff/override |
| `computeAvailabilityTimes` | Exact at compute time | ~3 queries + O(slots × units) memory walk | Detail endpoint (cache miss), search (cache miss) |
| Availability cache | ≤ 300s stale, mutation-invalidated | 1 Redis GET | Detail endpoint |
| Search availability filter | Same cache | 1 Redis MGET for N restaurants | `GET /restaurants?date&partySize` |

## 3. The availability cache (shared, demand-driven)

- **Key:** `restaurant:{id}:availability:{date}:{partySize}` → `{times: [...]}`,
  TTL 300s. A per-`(restaurant,date)` index set tracks written party sizes.
- **Invalidation:** every reservation mutation (create/cancel/no-show/extend/
  free-early, all sources) deletes the tracked keys for the reservation's
  **start date and end date** in restaurant-local terms (two dates when the
  hold crosses local midnight — overnight windows, until-close, extensions).
- **Failure mode:** the cache fails open in both directions — read failures
  compute, write failures skip. Redis being down makes availability slower,
  never wrong, never unavailable.
- **Why demand-driven, not precomputed:** the key space is
  restaurants × dates × party sizes; almost all of it is never asked for.
  Demand-driven caching concentrates warmth exactly where diners are looking
  (tonight, this weekend, party of 2/4), and one popular restaurant's cache
  entry serves *every* searcher and *every* detail view for 5 minutes.

## 4. Search with availability (R15 rework)

`GET /restaurants?date&partySize` previously ran the full engine for up to 100
restaurants **per anonymous request** (~5 queries each, unbounded parallelism —
a handful of concurrent searches exhausted the connection pool), did not apply
the `q` text filter to the candidates (computing availability for restaurants
the search could never return, and silently missing matches beyond the cap),
and happily advertised restaurants whose owners could no longer accept
bookings.

The pipeline is now five gates, ordered so that each is cheaper than the next
is expensive:

```
SQL candidates (q + city + cuisine + active + has-tables, cap 100)   1 query
  → billing gate      (joined subscription row, pure math)           0 extra
  → schedule gate     (batched periods + closures, pure math)        2 queries
  → cache gate        (shared availability cache)                    1 MGET
  → engine, misses only (bounded concurrency 6, writes cache)        ~3 q/miss
```

**Steady-state (warm) cost: ~5 DB queries + 1 Redis round-trip for the whole
request, independent of candidate count.** Cold cost is bounded by the
concurrency limiter — the pool can never be exhausted by search — and every
cold computation warms the exact cache the detail page reads, so a search
immediately followed by a click-through is a guaranteed cache hit.

Ordering rationale:

- **Billing before schedule/cache:** a lapsed owner's restaurant must never
  appear bookable, even if a cache entry from before the lapse is still warm.
  The gate is pure math over a row already joined into the candidate query
  (`canOwnerOperateFromSubscription` — the same rules as
  `resolveOwnerBillingState`, without the lazy row creation).
- **Schedule before cache:** on a Monday, closed-that-day typically eliminates
  a large slice of candidates with zero I/O beyond the two batched queries —
  and those two queries would be needed for the engine fallback anyway.
- **Cache before engine:** self-evident; the point of the design.

### Correctness boundaries (deliberate)

- A cached "has availability" may be up to 300s stale in either direction
  (a table freed 2 minutes ago may not show; one booked 2 minutes ago may
  still show). Both resolve at the next hop: the detail page recomputes on
  miss, the booking path is exact. This is the correct trade for an anonymous,
  unauthenticated, high-fan-out endpoint.
- Past-slot filtering happens at compute time, so an entry cached at 18:58 may
  count a 19:00 slot until 19:03. Same bound, same absorption.
- The 100-candidate cap is now a cap on *relevant* (q-filtered) candidates.

## 5. Scale model (validate against, revisit at thresholds)

Assumptions: one metro ~200 listed restaurants; peak diner search ~50 req/s
platform-wide; bookings ~10/s peak.

- **Search:** warm ≈ 5 pooled queries + 1 MGET ⇒ trivially inside a 10-conn
  pool at 50 req/s. Worst-case cold storm (cache flush at peak): misses ×3
  queries at concurrency 6 per request — pool-bounded, latency degrades, no
  failure.
- **Invalidation:** each booking mutation costs 1–2 SMEMBERS+DEL — O(bookings),
  not O(searches). Correct direction: writes are ~100× rarer than reads.
- **Hold writes:** the GiST index stays small because the maintenance worker
  releases finished holds (R6); per-table write contention is inherently
  shardable — a single Postgres writer holds far past 10⁶ reservations/day.

**Revisit triggers (in priority order):**
1. A single market's candidate set approaches the 100 cap → move to a
   precomputed per-restaurant-day availability bitmap maintained by the worker
   on mutation events, and make search consult only the index.
2. Search QPS makes even the MGET path hot → put a short-TTL (10–30s)
   process-local memo in front of Redis for the top (city,date,partySize)
   tuples.
3. Geo search lands (R9+) → candidates move to PostGIS/pg_trgm composite
   indexes; the gate pipeline is unchanged.

## 6. Validation status

- Integration tests (`search-availability.test.ts`) pin the three new
  correctness properties: closed-day exclusion, lapsed-owner exclusion, and
  q-filtered candidates — including the gate-ordering case where a lapsed
  owner still has a warm cache entry.
- Cache read/write/invalidate semantics are covered by
  `availability-cache.test.ts`.
- **Outstanding (needs a live stack):** a booking-burst load test against the
  PgBouncer transaction pooler (`scripts/load-test.ts`), and a cold-search
  storm benchmark. Run both before the first marketing push; check-env already
  blocks prod deploys missing `pgbouncer=true`.
