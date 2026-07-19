# Spec · Notifications, Workers & WebSocket

> Owns: `apps/api/src/services/email.service.ts`, `apps/api/src/lib/{queue,pubsub,notify-once,alert}.ts`,
> `apps/api/src/workers/*`, `apps/api/src/worker.ts`, `apps/api/src/plugins/websocket.ts`
> Related: fed by [reservation.md](reservation.md) mutations; token/role rules from
> [auth-session.md](auth-session.md); Redis substrate rules in [platform.md](platform.md)

## Purpose

Deliver the asynchronous consequences of bookings — emails (with dedup + reminders), the
owner live dashboard feed, and background maintenance (reconcile, purges) — without ever
being able to fail a booking.

## Responsibilities

- BullMQ `booking_events` queue: publish (rate-capped 60/min/restaurant, D-11) and consume
  (notification worker, concurrency 5); delayed `reservation.reminder` jobs (`queue.ts:55-136`).
- Email rendering/sending via Resend: restaurant-timezone times (INV-14), HTML escaping of
  owner-controlled fields (L-1 fix), ICS attachments (`email.service.ts:35-130,255-262`).
- Redis pub/sub fan-out to the owner WebSocket feed (`pubsub.ts:39`, `websocket.ts`).
- Maintenance schedulers: reconcile past reservations → COMPLETED + release holds; purge
  refresh tokens; prune audit logs (`maintenance.worker.ts:47-96`).

## Architecture (stable — do not silently break)

1. **Everything here is post-commit and fail-open** (CI-B3/CI-D1): queue publish, pub/sub,
   cache invalidation all swallow errors; a lost event = a missed email/WS frame, never a
   lost booking. Never make a request path await-and-throw on this subsystem.
2. **Delivery guarantees are layered, each with its own mechanism:**
   - *at-most-once per (reservation,event,recipient)*: `notifyOnce` Redis `SET NX
     notify:{key}` 24 h, **fail-open**, delete-on-failure to allow retry
     (`notify-once.ts:14-51`, INV-16);
   - *reminder idempotency*: deterministic `jobId: reminder:{id}` + status re-check at send
     (`queue.ts:127`, `notification.worker.ts:100`, INV-17/CI-B4);
   - *worker retry*: thrown errors → BullMQ retry → `reportCriticalError` alert after
     exhaustion (`notification.worker.ts:150`); deleted-row P2025 is a graceful skip (`:70-81`).
3. **Two channels, one event**: BullMQ (durable, worker-consumed → email) and Redis pub/sub
   (ephemeral → WS). They are independent; the queue's rate cap can drop events the WS
   channel still delivers (CI-B5). Do not conflate them or assume parity.
4. **Workers are in-process by default** (`RUN_WORKER_IN_PROCESS=true`, SI-6) and separable
   via `worker.ts`; **nothing verifies a consumer exists** (CI-E6) — if you deploy with
   in-process workers off and no standalone worker, jobs strand silently. Schedulers are
   idempotent by id (`upsertJobScheduler`, INV-18) and tolerate multiple workers.
5. **WS gate order** (`websocket.ts:14-103`): per-IP cap 5 (in-process Map — per-instance,
   SI-1) → `verifyAccessToken` → role must be `owner` → deny-list check → DB ownership →
   socket force-closed at token `exp` (`setTimeout`). The token arrives in the **query
   string** — an accepted open finding (H-2/P2-9): do not log raw WS URLs, and do not copy
   this pattern to new endpoints.
6. **Reconcile is the DB-truth half of the completion rule** (HC-5): every 5 min,
   force-COMPLETE rows past `endsAt` + 12 h grace and set `releasedAt` on holds
   (`maintenance.worker.ts:47-68,93`). Its rule must stay in agreement with
   `deriveDisplayStatus` ([reservation.md](reservation.md) §6).

## Boundaries

- `email.service.ts` is a **service** (lib layer): imported by modules/workers; imports no
  module. Workers import `lib/*` + `@restaurant/db` only ([02 §2](../02-dependency-graph.md)).
- Email content trusts nothing: owner-controlled strings pass `htmlEscape`, ICS fields pass
  `icsEscape` (`email.service.ts:52,63-70`) — every new template must do the same.
- Queue name is env-coupled (`QUEUE_NAME`, HC-2); tests override to `booking_events_test` —
  never publish to a hard-coded queue name.

## Verified invariants (guards in [../INVARIANTS.md](../INVARIANTS.md))

| ID | Statement | Anchor |
|---|---|---|
| INV-14 | Email times rendered in the **restaurant's** timezone with tz label | `email.service.ts:35-46`, `notification.worker.ts:53` |
| INV-16 | ≤1 email per (reservation,event,recipient), fail-open | `notify-once.ts:14-51` |
| INV-17 | Reminder idempotent + status-rechecked at send | `queue.ts:127`, `notification.worker.ts:100` |
| INV-18 | Schedulers converge under multiple workers | `maintenance.worker.ts:118-124`, `worker.ts:13-15` |
| — | Walk-ins (null diner email) never emailed (X-13) | `notification.worker.ts:50`, `email.service.ts:119-121` |

## Implementation details (volatile)

Reminder offsets (24 h/2 h), grace hours (`RECONCILE_GRACE_HOURS=12`), retention
(`AUDIT_LOG_RETENTION_DAYS`), rate-cap value, worker concurrency, template copy, alert
webhook payload shape, deprecated `sendBooking*` aliases (DC-7 — do not use in new code).

## Extension points — where new code belongs

- **New notification event**: publish through `publishReservationEvent` (inherits rate cap
  + queue), handle in `processNotificationJob` with a **new `notifyOnce` key**, render in
  `email.service.ts` with escaped fields. Never send email inline from a route/service.
- **New scheduled job**: `maintenance.worker.ts` via `upsertJobScheduler` with a stable id
  (idempotent, INV-18); job body must be safe to run concurrently and repeatedly.
- **New WS message type**: publish via `publishToRestaurantChannel`; the WS layer forwards
  raw JSON — version the payload shape, the client is a passive consumer.

## Evolution guidance

- Intentionally flexible: template design, reminder policy, retention windows, alert sink.
- Moving the WS per-IP cap to Redis (SYS-1 direction) replaces the in-process Map — do it
  under a registered key prefix; semantics (cap per real IP) stay.
- If delivery observability is added, prefer a worker-side outcome log/table over making
  publishes awaited in request paths (§1 is load-bearing).

## Common mistakes

- Awaiting queue/pubsub in a request path without catch — turns a Redis blip into booking
  failures; the fail-open wrapper pattern is mandatory.
- New email content without `htmlEscape`/`icsEscape` (reintroduces L-1), or formatting
  times with server locale/timezone instead of `fmtTime(iso, restaurant.timezone)` —
  note the restaurant-tz invariant matters *more* while NEW-H1 shifts stored instants for
  non-UTC restaurants.
- Reusing a `notifyOnce` key across semantically different sends (suppresses legitimate
  email) or minting keys outside the `notify:` prefix.
- Assuming exactly-once delivery anywhere in this subsystem — the guarantees are
  at-most-once (email dedup) and at-least-once (BullMQ retry) composed; design handlers
  idempotent.
- Forgetting that in tests the queue is `booking_events_test` (HC-2) — a guard asserting
  prod queue names will pass locally and lie.

## Open findings (see [../BACKLOG.md](../BACKLOG.md))

CI-E6 (no consumer-presence check) · CI-B5 (rate-cap silent drop) · H-2/P2-9 (WS query
token) · SI-1/SI-2 (per-instance WS cap + listener map) · CI-C2 (reconcile staleness).

## Anchors

`queue.ts:38-142` · `pubsub.ts:5-48` · `notify-once.ts:14-54` · `email.service.ts:5-306` ·
`notification.worker.ts:50-150` · `maintenance.worker.ts:47-124` · `worker.ts:13-17` ·
`websocket.ts:11-103` · `alert.ts:48-60` · guards: existing `notification.test.ts`;
WS/queue behaviors covered per registry
