# 07 · Testing Review — What the Suite Actually Guarantees

*Correctness guarantees, not coverage percentages. Assesses **true guarantees**,
**false/absent guarantees**, **isolation weaknesses**, **environment assumptions**,
**concurrency gaps**, and **production blind spots**. Every gap is expressed as a concrete
future **guard test (GT-n)** mapped to a Prompt-1 invariant/finding or a
[05](05-systemic-review.md) systemic finding. Authority = test sources on `staging`,
2026-07-19. Static shape: 170 `it()` across 11 API files (`auth` 41, `restaurant` 41,
`subscription` 24, `notification` 22, `reservation` 20, others ≤5), plus `apps/web`. Live
pass-counts remain Unverifiable ([03 §D](03-ground-truth-reconciliation.md)).*

Runner model (load-bearing): `pool: 'forks'`, `sequence:{concurrent:false}`
(`vitest.config.ts`). **Within** a file tests are serial; **across** files vitest runs
parallel forks — all against the **one** `DATABASE_URL`. There is no per-test transaction
rollback and no truncation: isolation rests entirely on `cleanupTestUsers` deleting by
explicitly-tracked `userIds` (`__tests__/helpers/db.ts:3-43`).

---

## A. Guarantees the suite genuinely provides (true — keep, don't re-derive)

| # | Guarantee | Maps | Evidence |
|---|---|---|---|
| T-1 | **INV-1 exclusion under real concurrency.** Two `Promise.all` `POST /reservations` on one table → exactly `[201, 409]`; both handlers open real concurrent `$transaction`s against the real GiST constraint | INV-1, P0-3 | `reservation.test.ts:143-180` (STANDARD), `:578-614` (until-close) |
| T-2 | **INV-7 webhook out-of-order drop.** A late event with older `updated_at` returns `staleApplied===false` and does not resurrect state | INV-7, P1-7 | `subscription.test.ts:332-344` |
| T-3 | **INV-4 refresh single-use (sequential).** A used refresh token cannot be reused; genuine rotation (new ≠ old) | INV-4 (partial), P0-7 | `auth.test.ts:275-315,480` |
| T-4 | **Deny-list revocation after logout.** Access token invalid for `/auth/me` post-logout; refresh unusable post-logout | INV-3, M-3-adjacent | `auth.test.ts:348-388` |
| T-5 | **JWT type confusion, image magic-byte validation, email HTML escaping** | INV-3, INV-15, L-1 | `jwt.test.ts`, `image-validation.test.ts`, `email-escaping.test.ts` |
| T-6 | **Order/unhandled webhook events return 200 and skip** | INV-6-adjacent | `subscription.test.ts:165-168` |

These are real, engine-level guarantees — notably T-1 (the hardest invariant) is exercised on
the true constraint, not a mock. Preserve them across any refactor (esp. SYS-3/SYS-6).

---

## B. False or absent guarantees → concrete guard tests

Each row is a guarantee a reader would *assume* holds but the suite does **not** establish.

| GT | Guard test to add | Maps | Why it's missing today |
|---|---|---|---|
| **GT-1** | **Quota exactness under concurrency.** Owner at plan boundary (limit−1 used); fire `k` concurrent `POST /reservations`; assert **exactly one** crosses the limit (201) and the rest 409/402, and the stored count never exceeds the limit | **INV-8**, P1-11 | No test references quota/limit/advisory in the reservation suite (grep empty). The advisory-lock (`pg_advisory_xact_lock`) is the paid-plan gate and has **zero** concurrency coverage |
| **GT-2** | **Refresh rotation race.** Present the **same** refresh token in two `Promise.all` `/auth/refresh` calls; assert exactly one 200 + one 401, and the account is **not** locked out afterward | **INV-4** (race half), P0-7 | T-3 covers single-use *sequentially*; the `deleteMany({id})+count===0` race guard (`auth.service.ts:311-316`) — the actual hard part — is never exercised concurrently |
| **GT-3** | **CORS allowlist behavior.** Disallowed `Origin` → not 500; no-Origin request handled per policy | P2-12, L-3, **SYS-3** | `buildTestServer` uses `origin:true` (`helpers/server.ts:22`); prod's allowlist + `cb(new Error())` path (`index.ts:141-149`) is never tested |
| **GT-4** | **Rate-limit + lockout enforcement.** Nth+1 login/register within window → 429; account lockout after repeated failures | H-1, M-4, CI-F6 | Test server omits the rate limiter (D-13); `NODE_ENV=test` disables lockout (`auth.service.ts:38,54`). The abuse controls are structurally untested |
| **GT-5** | **Admin auth + TOTP.** Admin login, TOTP setup/verify, and single-use-within-window; admin plan override sets `status:'ACTIVE'` | M-2, **CI-H3**, X-7 | `adminRoutes` are **not registered** in `buildTestServer` — the entire admin subsystem has zero integration coverage |
| **GT-6** | **Security-header + method-override contract.** `onSend` adds Permissions-Policy / removes X-Powered-By / X-Request-Id; method-override header → 400 | D-13, VALIDATION #1 | Omitted from test composition; the onSend regression that once hung every response (`index.ts:210-224`) could recur untested |
| **GT-7** | **Webhook idempotency replay.** Deliver the *same* LS event twice (same `event:subId:updated_at`) → applied once; on handler throw the idem key is deleted so a retry re-applies | **INV-6** | T-2/T-6 cover ordering & skip; exact-once replay via `SET NX` (`webhook.routes.ts:97-108,127-130`) not evidenced |
| **GT-8** | **DST spring-forward booking.** Book a local time inside the spring-forward gap; assert deterministic UTC (shifted, not rejected) and correct `endsAt` | INV-2, **CI-G6**, P2-6 | Two-pass `zonedTimeToUtc` (`timezone.ts:52-57`) has no DST-boundary test evidenced |
| **GT-9** | **Reconcile → COMPLETED + hold release.** After `endsAt`+grace, the maintenance job flips status to COMPLETED and sets `releasedAt`; a freed table is then re-bookable | P2-1, **CI-C2**, CI-C3 | The DB-truth reconcile (`maintenance.worker.ts:47-68`) — distinct from `deriveDisplayStatus` — is not evidenced in the suite; the display/truth divergence (HC-5) is exactly what needs a guard |
| **GT-10** | **Combination with inactivated member table.** Deactivate a member table; assert the combination is no longer offered as bookable | **CI-A2**, P2-7 | `loadBookableUnits` filters combos by combo-level `isActive` only (`reservation-engine.ts:56-74`); member-table state is unguarded and untested |
| **GT-11** | **Cross-tenant `dinerId` / `tableIds`.** Staff reservation with a foreign `dinerId` and with another restaurant's `tableId` → rejected | M-1/CI-A1, INV-12/P0-3 | `assertTablesBelongToRestaurant` (INV-12) should be pinned by a test; the `dinerId` any-UUID gap (M-1) should be pinned as a *known* behavior test so a future fix is detectable |
| **GT-12** | **Overlapping turn-time bands.** Create overlapping `turn_time_rules`; assert defined first-match (or rejection once enforced) | **CI-G1** | Overlap is silently allowed (`reservation-engine.ts:150-159`); no test locks the current first-match semantics, so any change is invisible |

**Prerequisite.** GT-3..GT-6 and GT-9 cannot be written against the current `buildTestServer`.
They are **blocked on SYS-3** (unify the test server with `buildServer()` and register admin
routes). This is the highest-leverage testing action: it does not add one guarantee, it
*unblocks a whole class* of them.

---

## C. Isolation weaknesses

| ID | Weakness | Evidence | Guard/direction |
|---|---|---|---|
| **ISO-1** | **Parallel forks share one Postgres with no structural isolation.** Cross-file tests that issue *global* reads — `GET /restaurants` search, availability scans, any owner-agnostic list — can observe rows created by another file's fork, producing order-dependent passes/failures | `pool:'forks'` (`vitest.config.ts`); global search path `restaurant.service.ts:186-353` | Scope every global-read assertion to created IDs, **or** give each test file a unique tenant namespace, **or** run search/availability files in a dedicated non-parallel project. Maps CI-A3, **SYS-6** |
| **ISO-2** | **Cleanup is by hand-tracked `userIds`, not truncation.** A test that forgets to push an id, or crashes before cleanup, leaks rows that pollute later files; `cleanupTestUsers` also omits `service_periods`/`closures`/`turn_time_rules`/`table_combinations` except via restaurant cascade | `helpers/db.ts:3-43` | Prefer per-test transaction rollback or a `TRUNCATE ... CASCADE` between files over manual id tracking; makes isolation structural, not disciplinary |
| **ISO-3** | **Shared Redis keyspace across parallel forks.** Auth lockout, deny-list, idempotency, and availability keys are not fork-namespaced; only `QUEUE_NAME` is isolated | `vitest.config.ts` (only queue overridden); HC-1 | Prefix Redis keys with a per-fork/run token in tests, or flush between files. Maps HC-1, **SYS-2** |

ISO-1..ISO-3 are the concrete **flaky-test risk**: today's green is partly luck-of-scheduling.
They are the test-side face of **SYS-2** (shared Redis) and **SYS-6** (convention-only isolation).

---

## D. Environment assumptions baked into the suite

| ID | Assumption | Evidence | Consequence |
|---|---|---|---|
| ENV-1 | `TEST_DATABASE==='true'` + `.env.test` is the prod wall | `vitest.config.ts:22-40` | **Strong true guarantee** — the suite cannot touch prod. Keep; do not weaken |
| ENV-2 | Security behaviors are *off* in tests (`NODE_ENV=test` disables lockout/threat; CF secrets deleted; `BCRYPT_ROUNDS=10`) | `vitest.config.ts`; `threat-detector.ts:17,38`; `auth.service.ts:38,54,64` | The exact paths in GT-4/GT-5 are unreachable *by design*; a prod-parity harness (SYS-3) is required before they can be tested |
| ENV-3 | Real BullMQ jobs are published to `booking_events_test` | `vitest.config.ts` | Good isolation; but means worker *consumption* is not asserted end-to-end unless a test drains the queue |

---

## E. Production blind spots (cannot be caught by any test as configured)

| ID | Blind spot | Maps | Note |
|---|---|---|---|
| BLND-1 | **PgBouncer / pooled-connection behavior.** Tests hit Postgres directly (no pooler); prepared-statement issues under 6543 pooling (P1-10) can only appear in prod | CI-E2, P1-10 | `check-env` guards config, but runtime pooling semantics are untested. Closest feasible guard: a CI job that runs a smoke subset through PgBouncer |
| BLND-2 | **Single-instance assumptions.** No test runs ≥2 API instances, so the per-instance WS cap / rate limiter / pubsub Map (SI-1,2,4) degradation is invisible | SI-1..SI-9, **SYS-1** | Only closeable *after* SYS-1 moves state to Redis; then a 2-instance integration test becomes meaningful |
| BLND-3 | **Redis eviction of security keys.** `noeviction` is assumed (CI-E3); no test simulates eviction of a `deny:` key to confirm auth stays fail-closed (INV-5) | CI-E3, INV-5, **SYS-2** | Guard: delete a `deny:` key mid-flight and assert 503/deny, not silent grant |
| BLND-4 | **Deploy health.** No test/stage verifies the deployed image booted (`--detach`) | **SYS-4**, PIPE-10 | Closed by the pipeline health poll, not by vitest |

---

## F. Priority ordering (testing)

```
1. SYS-3 first — unify buildTestServer with buildServer(), register admin routes.
   Unblocks GT-3, GT-4, GT-5, GT-6, GT-9 (a whole class, not one test).
2. Concurrency guards on the money paths — GT-1 (quota advisory lock), GT-2 (refresh race).
   These protect the two invariants (INV-8, INV-4) whose HARD half is currently unguarded.
3. Structural isolation — ISO-1..ISO-3 — before adding more DB-touching tests, or new
   guards inherit the flakiness.
4. Domain correctness guards — GT-7..GT-12 — idempotency, DST, reconcile, combos, tenancy,
   turn-bands: each pins a known behavior so future change is detectable.
5. Feasible prod-parity smoke — BLND-1/BLND-3 as CI smoke jobs; BLND-2/BLND-4 deferred to
   SYS-1 / SYS-4 landing.
```

**Net.** The suite gives a few *real, deep* guarantees — T-1 exercises the hardest invariant
on the true engine — but its breadth is narrower than a green run implies. The two structural
causes are shared with the systemic review: a **test composition that isn't production**
(SYS-3) makes the security/admin surface untestable, and **convention-only isolation** (SYS-6,
SYS-2) makes today's pass partly scheduling-dependent. Fix those two, add the two concurrency
money-path guards (GT-1/GT-2), and the suite's guarantees start matching its green checkmark.
