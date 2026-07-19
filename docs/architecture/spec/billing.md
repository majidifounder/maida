# Spec · Billing, Plans & Webhooks

> Owns: `apps/api/src/modules/subscription/*`, `apps/api/src/lib/lemon-squeezy.ts`,
> `apps/api/src/lib/plan.ts`
> Related: consumed by [reservation.md](reservation.md) and [availability.md](availability.md)
> (operability + limits); [admin.md](admin.md) (plan override)

## Purpose

Map Lemon Squeezy subscription state onto internal plan/status, expose **operability**
(may this owner take bookings / change config?) and **effective limits** to the rest of
the system, and process LS webhooks exactly-once and in order.

## Responsibilities

- Checkout/cancel/resume against the LS REST API (`lemon-squeezy.ts:59,83`; failure → 502).
- Webhook intake `POST /webhooks/lemon-squeezy`: HMAC verify → event filter → idempotency →
  ordered upsert (`webhook.routes.ts:34-137`).
- The single operability classifier and limits facade used everywhere else
  (`subscription.service.ts:86-224`).

## Architecture (stable — do not silently break)

1. **subscription is the dependency sink.** Every cross-module edge in the backend points
   *at* this module; it imports **no** other module ([02 §3](../02-dependency-graph.md)).
   Keep it that way — a subscription→module import would create the first cycle.
2. **One classifier** (INV-10): `isOwnerOperableByStatus` (exhaustive switch + `never`
   guard) is the only place status→operability is decided; both the DB path
   (`resolveOwnerBillingState`) and pure path (`canOwnerOperateFromSubscription`) call it.
   Never branch on `SubscriptionStatus` elsewhere.
3. **Webhook pipeline is signature → filter → idempotency → ordering → upsert**, each layer
   with distinct semantics:
   - **Signature**: HMAC-SHA256 over the **raw body** buffer, `timingSafeEqual`
     (`lemon-squeezy.ts:6-17`); the buffer parser is plugin-scoped (`webhook.routes.ts:35-46`).
   - **Idempotency** (INV-6): Redis `SET NX ls-event:{event}:{subId}:{updated_at}` EX 7 d;
     on handler throw the key is **deleted** so LS retry can succeed (`:97-108,127-130`).
   - **Ordering** (INV-7): drop events whose `updated_at` < stored `lsUpdatedAt`, compared
     inside the upsert tx (`subscription.service.ts:328-334`). Equal timestamps apply
     (CI-B2); malformed timestamps fall back to `new Date()` = treated newest (CI-B1).
   - The route always 200s handled-or-skipped events; only thrown errors produce retryable
     failures.
4. **Identity comes from the signed payload only**: `user_id` is read from
   `meta.custom_data` of an HMAC-verified body (`webhook.routes.ts:89`), never from headers.
5. **EXPIRED ⇒ free-Starter fallback is a recorded product decision** (X-2), not a bug:
   `EXPIRED → canOperate:true` with Starter limits (`subscription.service.ts:100-107,172-194`).
   Decision provenance: DEBUG_LOG Iteration 1 (retired doc — see git history and
   [../RETIRED.md](../RETIRED.md)). Do not "fix" it to reject.
6. **Trial = full PRO** (`TRIAL_LIMITS = PLAN_LIMITS.PRO`, `plan.ts:42`, X-11).
   Subscription is **per-user** (`schema.prisma:385 userId @unique`) — the owner *is* the
   billing entity and tenant (CI-A4/SYS-7); any team/org feature must revisit this spec.
7. `plan.ts` is fronted by the service facade — other modules import limits via
   `subscription.service` re-exports (`subscription.service.ts:32-38`), with one legacy
   exception (`startOfCurrentMonth` direct import, B-3). Don't add more direct `lib/plan`
   imports from other modules.

## Boundaries

- Imports: `lib/{lemon-squeezy,plan,redis}`, `@restaurant/db`, `@restaurant/types` only.
- `webhook.routes` legitimately touches Redis directly for idempotency (UD-3) — a known
  route-level infrastructure dependency; keep new webhook infra concerns in the route, new
  *domain* logic in the service.
- Client plan display duplicates limits (`apps/dashboard/src/lib/plan-limits.ts`, HC-6/P2-13)
  — until generated from `plan.ts`, any limit change **must** update both.

## Verified invariants (guards in [../INVARIANTS.md](../INVARIANTS.md))

| ID | Statement | Anchor |
|---|---|---|
| INV-6 | Webhook events idempotent (`SET NX`, delete-on-throw for retry) | `webhook.routes.ts:97-108,127-130` |
| INV-7 | Out-of-order events dropped via `lsUpdatedAt` guard in tx | `subscription.service.ts:328-334` |
| INV-10 | Single operability classifier, exhaustive | `subscription.service.ts:86,144,224` |
| — | Signature: HMAC-SHA256 raw-body, constant-time compare, 401 on mismatch | `lemon-squeezy.ts:6-17`, `webhook.routes.ts:54-61` |

## Implementation details (volatile)

Variant→plan env mapping (`LS_VARIANT_*`); `lsStatusToInternal` mapping table (unknown →
PAST_DUE); idem-key TTL; checkout URL construction; audit specifics.

## Extension points — where new code belongs

- **New LS event type**: add to `handledEvents` (`webhook.routes.ts:73-82`) and extend
  `upsertSubscriptionFromWebhook` — the idempotency/ordering layers apply automatically as
  long as the event flows through the same pipeline.
- **New plan or limit dimension**: `plan.ts` (`PLAN_LIMITS`), surfaced via the facade;
  update the dashboard copy (HC-6) until generation exists.
- **New status**: extend the enum via migration; the `never` guard in
  `isOwnerOperableByStatus` will force the operability decision at compile time — that is
  the designed extension pressure, do not weaken it.
- **New billing provider**: mirror the whole pipeline shape (signature → idempotency →
  ordering) with provider-specific `lib/` client; keep provider names out of other modules.

## Evolution guidance

- Intentionally flexible: plan matrix values, trial length, event set, LS API client shape.
- Ordering currently trusts LS `updated_at` monotonicity (CI-B1/CI-B2) — if that proves
  false in production, strengthen inside the existing tx guard, not with a second mechanism.

## Common mistakes

- Verifying HMAC over the *parsed/re-serialized* body instead of the raw buffer — breaks on
  key ordering/whitespace; the buffer parser exists precisely for this.
- Deleting the idempotency key on *success* paths or forgetting delete-on-**throw** —
  either double-applies or permanently drops retried events.
- Branching on subscription status outside the classifier (INV-10) — the EXPIRED fallback
  decision lives in exactly one switch.
- Treating a 200 response as "applied" — 200 also means skipped/duplicate/stale by design;
  observability is via logs and the `applied` boolean, not status codes.
- Adding an unsigned/unauthenticated webhook route variant "for testing".

## Open findings (see [../BACKLOG.md](../BACKLOG.md))

HC-6/P2-13 (client limit duplication) · CI-B1/CI-B2 (updated_at trust) · CI-A4/SYS-7
(owner=tenant=billing ceiling) · CI-B5 (queue rate-cap silent drop affects billing-adjacent
notifications).

## Anchors

`subscription.routes.ts:25-74` · `webhook.routes.ts:34-137` ·
`subscription.service.ts:32-360,488` · `lemon-squeezy.ts:6-83` · `plan.ts:5-112` ·
`schema.prisma:385,404` · guards: `__tests__/guards/webhook.guard.test.ts`, existing
`subscription.test.ts`
