# Spec · Reservation & Engine

> Owns: `apps/api/src/modules/reservation/*`, `apps/api/src/lib/reservation-engine.ts`,
> `apps/api/src/lib/service-schedule.ts`, `apps/api/src/lib/timezone.ts`
> Related: [availability.md](availability.md) (cache it must invalidate), [billing.md](billing.md)
> (operability + quota it must consult), [notifications.md](notifications.md) (events it emits)

## Purpose

Create and manage reservations such that **no table is ever double-booked**, quotas are
exact under concurrency, and every mutation propagates to cache, queue, and WebSocket.

## Responsibilities

- Diner online booking (`POST /reservations`), owner walk-in/staff/override creation,
  and the owner lifecycle: seat, cancel, no-show, extend, free-early
  (`reservation.routes.ts:23-340`).
- Table/combination allocation, duration resolution (turn-time rules, custom, until-close),
  and the server-side service-window gate (INV-11).
- Diner abuse guards (horizon / overlap / active-cap, INV-13) and the per-owner monthly
  quota under an advisory lock (INV-8).
- Post-commit side effects: availability invalidation, BullMQ publish, Redis pub/sub
  (`reservation.service.ts:762-782`).

## Architecture (stable — do not silently break)

1. **The GiST exclusion constraint is the sole authority on overlap** (INV-1):
   `reservation_tables_no_overlap` — `EXCLUDE (tableId WITH =, tstzrange(startsAt,endsAt,'[)')
   WITH &&) WHERE releasedAt IS NULL` (migration `20260705120000`). All application-level
   availability checks are advisory pre-filters; the constraint is the arbiter. Violations
   surface as SQLSTATE 23P01, caught by `isExclusionViolation`
   (`reservation-engine.ts:345`) and mapped to 409 + `suggestedNextAvailableAt`.
2. **Holds** (`reservation_tables` rows) carry the blocking interval; releasing a table is
   *always* `releasedAt = now()`, never row deletion — the partial index (`WHERE releasedAt
   IS NULL`) is what frees the slot.
3. **Booking is one transaction** (`createReservationWithHolds`,
   `reservation.service.ts:392-462`): reservation + holds + audit + quota, `TX_OPTIONS`
   maxWait 15 s / timeout 20 s (`:91`). Quota is count-then-insert **under
   `pg_advisory_xact_lock(hashtext(ownerId))`** (`:403`) — the lock is what makes the count
   exact (INV-8); never move the count outside the locked tx.
4. **Side effects are strictly after commit and fail-open** (CI-B3/CI-D1): a lost cache
   invalidation / queue publish / pub-sub event must never roll back or fail a booking.
5. **Ownership gates**: `assertOwnerAccess` (ownership only, deliberately *not*
   operability-gated so a lapsed owner can still manage existing bookings —
   `reservation.service.ts:358-368`, decision X-2 adjacent; note it throws **403**, unlike
   the restaurant module's 404 — both oracle-free, inconsistency tracked as NEW-L1);
   `assertTablesBelongToRestaurant` whenever client-supplied `tableIds` are present
   (INV-12, `:312-323,503`).
6. **DB status vs display status are two layers** (D-7): DB truth transitions via service
   calls + the reconcile job; `deriveDisplayStatus` rewrites past SCHEDULED/SEATED →
   COMPLETED **in responses only**, with `rawStatus` preserving truth. Keep both layers or
   drop the distinction consciously — they must agree on the "past ⇒ completed" rule (HC-5).

## Boundaries

- Imports allowed: `lib/*`, `services/email.service`, `@restaurant/db`, and **only**
  `modules/subscription/subscription.service` (the sanctioned cross-module edge —
  `assertOwnerCanOperate`, `getEffectiveLimitsForOwner`; [02 §3](../02-dependency-graph.md)).
- `reservation-engine.ts`/`service-schedule.ts` are **lib** files: they must never import
  from `modules/*` (enforced by the drift-guard layering check; see [platform.md](platform.md)).
- Tenancy: diner rows are isolated only by `where:{dinerId}` filters
  (`reservation.service.ts:794,819,843`); owner rows by `assertOwnerAccess`. There is no DB
  backstop (CI-A3) — every new query **must** carry the filter.

## Verified invariants (guards in [../INVARIANTS.md](../INVARIANTS.md))

| ID | Statement | Anchor |
|---|---|---|
| INV-1 | No overlapping unreleased holds per table (DB-enforced) | migration `20260705120000`; `reservation-engine.ts:345` |
| INV-8 | Monthly quota exact under concurrency (advisory xact lock) | `reservation.service.ts:403-416` |
| INV-11 | Booking window enforced server-side for ONLINE/STAFF | `reservation.service.ts:649-673` |
| INV-12 | Client-supplied `tableIds` must belong to the restaurant | `reservation.service.ts:312-323,503,1401-1411` |
| INV-13 | Diner abuse guards (365 d horizon, overlap, 20-active cap) | `reservation.service.ts:39-42,270-309` |
| INV-2 | Timestamps stored/compared as timestamptz | `schema.prisma:300-301`, `reservation-engine.ts:106` |

**⚠ INV-2 caveat — open defect NEW-H1:** the *storage* half of INV-2 holds (timestamptz
everywhere), but the wall-clock→UTC converter `zonedTimeToUtc` (`timezone.ts:52-57`)
**double-subtracts the zone offset**: its loop applies `utcMs -= offset(utcMs)` twice
cumulatively, so Paris noon converts to 10:00Z (correct: 11:00Z) and New York noon to
22:00Z (correct: 17:00Z). Only UTC-timezone restaurants (offset 0 — the test-fixture
default) are unaffected. Every consumer of `zonedTimeToUtc` / `localDayBoundsUtc` /
`addLocalDays` (service windows, closures, day bounds, engine scans) is shifted by one
extra offset for non-UTC restaurants. Recorded as **NEW-H1** in
[../BACKLOG.md](../BACKLOG.md); guarded by a **skipped** test in
`guards/timezone.guard.test.ts`. Do not "fix in passing" — window semantics, existing rows,
and the frontend must be assessed together.

## Implementation details (volatile)

Slot step 15 min (`AVAILABILITY_STEP_MINS`, CI-G2); best-fit = smallest `maxPartySize`
(CI-G3); `suggestedNextAvailableAt` scan depth; fee snapshot columns (CI-G5/HC-4);
turn-time first-match ordering (CI-G1 — currently unenforced overlap); rate limits per
route; `TX_OPTIONS` values.

## Extension points — where new code belongs

- **New lifecycle action** (e.g. reconfirm): new service function in
  `reservation.service.ts` following the existing shape — status guard first,
  `assertOwnerAccess`/diner filter, tx if multi-row, then the post-commit triple
  (invalidate + publish + pubsub). Route in `reservation.routes.ts` with zod schema +
  `ownerHooks`/`dinerHooks`.
- **New allocation strategy**: extend `reservation-engine.ts` only; the engine stays pure
  DB-read + math, no HTTP concepts.
- **New reservation source**: extend the `ReservationSource` enum via migration; decide
  explicitly which guards apply (window gate? abuse guards? quota?) — they are opt-in per
  source (`:649-678`).

## Evolution guidance

- Intentionally flexible: step size, best-fit policy, suggestion algorithm, fee model,
  status guard *messages*.
- If a status state machine is centralized (SYS-6 direction), fold the per-function guards
  (`:968,1091,1157,1228`) and the reconcile rule (`maintenance.worker.ts:47-55`) into one
  table both consult — do not add a third encoding.
- A booking idempotency key (open P2-3) belongs at the route boundary, keyed in Redis under
  a registered prefix, before `createWithAllocation`.

## Common mistakes

- Deleting hold rows (or forgetting `releasedAt`) instead of releasing — breaks INV-1's
  partial-index semantics (CI-C3).
- Checking availability in app code and trusting it — only the constraint is authoritative;
  always handle 23P01.
- Doing side effects inside the booking tx (they must not abort a booking) or forgetting
  one of the three post-commit effects (stale cache = phantom unavailability; P2-8 was the
  cross-midnight variant — invalidate **both** dates, `:93-114`).
- Adding a count-based limit as check-then-act without the advisory lock — that is exactly
  the race INV-8 closed (P1-11); restaurant/table/combination limits still have this gap.
- Extending/moving a reservation without updating hold rows in lockstep (CI-C4).
- Accepting `dinerId`/`tableIds` from the client without the ownership checks (M-1 is the
  open `dinerId` gap — do not widen it).

## Open findings (see [../BACKLOG.md](../BACKLOG.md))

NEW-H1 (zonedTimeToUtc offset ×2) · M-1/CI-A1 (`dinerId` any-UUID) · P2-3 (no idempotency
key) · P2-7/CI-A2 (combos with inactive member tables) · CI-G1 (turn-band overlap) ·
CI-C2 (reconcile staleness window) · P1-11-residual (config-limit check-then-act).

## Anchors

`reservation.routes.ts:16-340` · `reservation.service.ts:39-1411` ·
`reservation-engine.ts:11-570` · `service-schedule.ts:56-165` · `timezone.ts:43-85` ·
`reservation.schema.ts:3-131` · migration `20260705120000` · guards:
`__tests__/guards/reservation.guard.test.ts`, `__tests__/guards/timezone.guard.test.ts`
