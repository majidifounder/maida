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
| Availability cache | mutation-invalidated (per-date + version); TTL 300s backstop | 1 DB query + 1 Redis MGET | Detail endpoint |
| Search availability filter | Same cache | 1 Redis MGET for N restaurants | `GET /restaurants?date&partySize` |

## 3. The availability cache (shared, demand-driven, versioned)

- **Entry:** `restaurant:{id}:availability:{date}:{partySize}` → the FULL
  response (`{v, times, serviceWindows, standardDurationMins}`), TTL 300s.
  Caching the whole response — not just the slot list — is what makes a hit
  cheap: the detail endpoint answers from **1 DB query (restaurant + joined
  subscription) + 1 Redis MGET**, touching neither the schedule nor the
  turn-time rules nor the engine. A per-`(restaurant,date)` index set tracks
  written party sizes.
- **Two invalidation channels, matched to the two mutation shapes:**
  - *Reservation mutations* (create/cancel/no-show/extend/free-early) affect
    one or two known dates → delete the tracked keys for the reservation's
    start/end dates in restaurant-local terms. Precise and immediate.
  - *Config mutations* (weekly schedule, closures, tables, combinations,
    turn-time rules, engine settings) reshape availability for EVERY future
    date — unenumerable with per-date sets. Each restaurant carries a
    **version counter** (`restaurant:{id}:availver`, plain INCR, no TTL);
    entries embed the version they were computed under, and a reader treats a
    mismatch as a miss. One INCR = O(1) invalidation across all dates and
    party sizes. An owner changing hours sees the change on the very next
    read, not after a TTL.
  - Billing operability is **never cached**: it's pure math over a
    subscription row joined into the restaurant fetch, checked live on every
    request — a lapsed owner stops advertising slots instantly, even through
    warm entries.
- **Failure mode:** the cache fails open in every direction — read failures
  compute, write failures skip, a failed version bump degrades to the TTL
  bound (≤300s). Redis being down makes availability slower, never wrong.
- **Why demand-driven, not precomputed:** the key space is
  restaurants × dates × party sizes; almost all of it is never asked for.
  Demand-driven caching concentrates warmth exactly where diners are looking
  (tonight, this weekend, party of 2/4), and one popular restaurant's cache
  entry serves *every* searcher and *every* detail view for 5 minutes.
- **Guardrail:** an empty weekly schedule is rejected at the API (min 1
  window) — zero ServicePeriod rows is indistinguishable from pre-migration
  data, which the engine backstops with the legacy always-open window.
  "Closed indefinitely" is expressed with closures or by deactivating the
  listing, never by an empty week.

## 4. Search with availability (R15 rework)

`GET /restaurants?date&partySize` previously ran the full engine for up to 100
restaurants **per anonymous request** (~5 queries each, unbounded parallelism —
a handful of concurrent searches exhausted the connection pool), did not apply
the `q` text filter to the candidates (computing availability for restaurants
the search could never return, and silently missing matches beyond the cap),
and happily advertised restaurants whose owners could no longer accept
bookings.

The pipeline is five gates, ordered so that each is cheaper than the next is
expensive:

```
SQL candidates (q + city + cuisine + active + has-tables, cap 100)   1 query
  → billing gate    (joined subscription row, pure math)             0 extra
  → cache gate      (version-checked MGET, 2N keys, 1 round-trip)    0 queries
  → schedule gate   (batched periods + closures, MISSES only)        2 queries
  → engine          (bounded concurrency 6, writes full entries)     ~3 q/miss
```

**Steady-state (warm) cost: 3 DB queries + 1 Redis round-trip for the whole
request — candidates, final page, final count — independent of candidate
count.** Cold cost is bounded by the concurrency limiter — the pool can never
be exhausted by search — and every cold computation writes a full-response
entry, so a search immediately followed by a detail-page click-through is a
guaranteed cache hit.

Ordering rationale:

- **Billing before cache:** a lapsed owner's restaurant must never appear
  bookable, even through a still-warm entry. The gate is pure math over a row
  already joined into the candidate query
  (`canOwnerOperateFromSubscription` — the same rules as
  `resolveOwnerBillingState`, without the lazy row creation).
- **Cache before schedule:** version-checked entries already encode the
  schedule outcome (a closed day cached as zero slots, and any schedule change
  bumps the version), so the two schedule queries are spent only on misses —
  where they cheaply eliminate closed-that-day candidates before engine work.
- **Cache before engine:** self-evident; the point of the design.

### Correctness boundaries (deliberate)

- **Reservation changes:** invalidated per-date at mutation time — effectively
  instant. The 300s TTL is only the backstop for a failed invalidation.
- **Config changes (hours/tables/rules/closures):** version bump at mutation
  time — visible on the next read. A failed bump degrades to the TTL bound.
- **Billing changes:** never cached; live on every read.
- Past-slot filtering happens at compute time, so an entry cached at 18:58 may
  count a 19:00 slot until 19:03 — absorbed by the detail/booking hops, which
  are exact where it matters.
- The 100-candidate cap is a cap on *relevant* (q-filtered) candidates.

## 5. Scale model (validate against, revisit at thresholds)

Assumptions: one metro ~200 listed restaurants; peak diner search ~50 req/s
platform-wide; bookings ~10/s peak.

- **Search:** warm ≈ 3 pooled queries + 1 MGET ⇒ trivially inside a 10-conn
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

- Integration tests (`search-availability.test.ts`, `availability-cache.test.ts`) pin the
  correctness properties: closed-day exclusion, lapsed-owner exclusion, and
  q-filtered candidates — including the gate-ordering case where a lapsed
  owner still has a warm cache entry.
- Cache read/write/invalidate semantics are covered by
  `availability-cache.test.ts`.
- **Outstanding (needs a live stack):** a booking-burst load test against the
  PgBouncer transaction pooler (`scripts/load-test.ts`), and a cold-search
  storm benchmark. Run both before the first marketing push; check-env already
  blocks prod deploys missing `pgbouncer=true`.
