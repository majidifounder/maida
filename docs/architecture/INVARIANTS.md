# Invariant Registry

*The authoritative map from every load-bearing invariant to the test that guards it.
Statuses: **GUARDED** (passing test exists) · **PARTIAL** (some facets guarded, gap named) ·
**TODO** (no guard yet — tracked as a GT id in [BACKLOG.md](BACKLOG.md)) · **DEFECT**
(invariant does not fully hold — skipped guard + backlog finding). Guard paths are relative
to `apps/api/src/__tests__/`. This file is drift-guard-checked
([DRIFT-GUARD.md](DRIFT-GUARD.md)): every guard file referenced must exist and must mention
the invariant IDs it claims to cover.*

Rules:
- **Changing code an invariant anchors to ⇒ re-run its guard and update this row.**
- **Skipped guards are never deleted** — they are un-skipped in the PR that fixes their finding.
- New invariants get the next INV number, an anchor, a guard (or GT TODO), and a row here.

## Core invariants (INV-1..18, from [01 §11](01-system-map.md))

| ID | Invariant (short) | Anchor | Guard | Status |
|---|---|---|---|---|
| INV-1 | No overlapping unreleased holds per table (GiST, DB-level); released holds stop blocking | migration `20260705120000`; `reservation-engine.ts:345` | `guards/reservation.guard.test.ts` (DB-level, both halves) + `reservation.test.ts:143,578` (HTTP race, [201,409]) | **GUARDED** |
| INV-2 | Timestamptz storage + deterministic local-day math | `schema.prisma:300`; `timezone.ts:43-85` | `guards/timezone.guard.test.ts` — UTC identity, bounds, DST determinism pass; **non-UTC conversion is wrong (×2 offset)** → skipped tests | **DEFECT → NEW-H1** |
| INV-3 | Token-type confusion rejected; RS256 pinned (alg:none & HS256-confusion rejected) | `lib/jwt.ts:48-77` | `guards/auth.guard.test.ts` + `jwt.test.ts` | **GUARDED** |
| INV-4 | Refresh rotation atomic single-use, incl. concurrent double-spend | `auth.service.ts:311-316` | `guards/auth.guard.test.ts` (sequential + concurrent) + `auth.test.ts:295,480` | **GUARDED** |
| INV-5 | Auth infra failure ⇒ 503, never grant | `authenticate.ts:63-98` | none — needs Redis fault injection | **TODO → GT-17** |
| INV-6 | Webhook idempotency (`SET NX`, delete-on-throw) | `webhook.routes.ts:97-130` | `guards/webhook.guard.test.ts` (real Redis, DB-effect proof) | **GUARDED** |
| INV-7 | Webhook ordering (`lsUpdatedAt` drop) | `subscription.service.ts:328-334` | `guards/webhook.guard.test.ts` (HTTP) + `subscription.test.ts:332` (service) | **GUARDED** |
| INV-8 | Monthly quota exact under concurrency (advisory lock) | `reservation.service.ts:403-416` | `guards/reservation.guard.test.ts` `it.todo` — needs at-limit fixture | **TODO → GT-1** |
| INV-9 | Version bump orphans all cached availability (O(1)) | `availability-cache.ts:64,96` | `availability-cache.test.ts:146,182` — caveat: suite silently no-ops if its Redis probe fails (ISO-4) | **GUARDED** |
| INV-10 | Single operability classifier, exhaustive switch | `subscription.service.ts:86,144,224` | structural (`never` guard, compile-time) + `subscription.test.ts:283,657,683` behavior | **GUARDED** (structural+behavioral) |
| INV-11 | Booking window enforced server-side (ONLINE/STAFF) | `reservation.service.ts:649-673` | `reservation.test.ts:498` (until-close facet only) — no plain-ONLINE outside-window guard | **PARTIAL → GT-13** |
| INV-12 | Client `tableIds` must belong to the restaurant | `reservation.service.ts:312-323,503` | `guards/reservation.guard.test.ts` (walk-in, cross-restaurant) | **GUARDED** |
| INV-13 | Diner abuse guards (horizon / overlap / 20-active) | `reservation.service.ts:39-42,270-309` | none | **TODO → GT-14** |
| INV-14 | Email times in restaurant timezone | `email.service.ts:35-46`; `notification.worker.ts:53` | `notification.test.ts:98-112` (tz pass-through asserted; rendering not asserted) | **PARTIAL → GT-8** |
| INV-15 | Logo magic-byte + size + path-traversal guards | `image-validation.ts:30`; `r2-storage.ts:109-114` | `image-validation.test.ts` | **GUARDED** |
| INV-16 | ≤1 email per (reservation,event,recipient) | `notify-once.ts:14-51` | none — `notify-once` is **mocked** in `notification.test.ts:67` | **TODO → GT-15** |
| INV-17 | Reminder idempotent + status-rechecked at send | `queue.ts:127`; `notification.worker.ts:100` | `notification.test.ts:258,272` | **GUARDED** |
| INV-18 | Maintenance schedulers converge (idempotent upsert) | `maintenance.worker.ts:118-124` | `notification.test.ts:375` covers wiring only; convergence untested | **TODO → GT-16** |

## Boundary/tenancy behaviors guarded beyond INV numbers

| Behavior | Anchor | Guard |
|---|---|---|
| Role separation is exact-match (diner↛owner routes, owner↛diner routes) | `authenticate.ts:113-123` | `guards/auth.guard.test.ts` |
| Tenant isolation: non-owned ⇒ rejected oracle-free (restaurant module 404, reservation module 403 — inconsistency = NEW-L1); diner rows filtered by `dinerId` ⇒ 404 | `restaurant.service.ts:46-48`; `reservation.service.ts:362-368,794+` | `guards/reservation.guard.test.ts` |
| Webhook HMAC signature (401 on missing/invalid, raw-body) | `lemon-squeezy.ts:6-17` | `guards/webhook.guard.test.ts` + `subscription.test.ts:111` |
| Walk-ins never emailed (null diner email) | `notification.worker.ts:50` | `notification.test.ts` (create/seat/cancel walk-in cases) |

## Skipped guards — desired invariants that do NOT hold today

| Finding | Desired invariant | Skipped guard | Why skipped |
|---|---|---|---|
| **NEW-H1** | `zonedTimeToUtc` subtracts the offset once (Paris noon → 11:00Z) | `guards/timezone.guard.test.ts` ×4 | Loop double-subtracts offset; fix must assess stored rows + frontend together |
| **M-3**/CI-H1 | Password reset revokes live access tokens | `guards/auth.guard.test.ts` | Reset only deletes refresh rows (`auth.service.ts:494-511`) |
| **L-5**/CI-H2 | Refresh reuse revokes the token family | `guards/auth.guard.test.ts` | No family tracking exists (`auth.service.ts:295-316`) |
| **M-1**/CI-A1 | Staff `dinerId` must be a consenting diner | `guards/reservation.guard.test.ts` | Any user UUID accepted (`reservation.schema.ts:73`) |

## Open guard TODOs (GT series — full list in [BACKLOG.md](BACKLOG.md) §Testing)

GT-1 (INV-8 quota race) · GT-2 ✅ *closed by* `guards/auth.guard.test.ts` · GT-3..GT-6 +
GT-9 (blocked on SYS-3 test-composition unification) · GT-7 ✅ *closed by*
`guards/webhook.guard.test.ts` · GT-8 (INV-14 rendering + DST booking) · GT-10..GT-12
(combos / cross-tenant pinning / turn-bands) · **new this pass:** GT-13 (INV-11 plain
outside-window 422), GT-14 (INV-13 abuse guards), GT-15 (INV-16 real notifyOnce dedup),
GT-16 (INV-18 scheduler convergence), GT-17 (INV-5 fail-closed via Redis fault injection).
