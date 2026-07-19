# 05 · Systemic Review

*Architecture-reviewer stance (not a linter). Subject = **emergent** problems where
individually-correct files combine into whole-system risk. Deduplicated against
[01](01-system-map.md)–[04](04-candidate-invariants.md); prior IDs (INV/SI/HC/CI/D/B, P-x/H-x/M-x/L-x)
are **referenced, not restated**. Horizon = maintainable for 3–5 years by multiple engineers
and future AI agents. Authority = code on `staging`, 2026-07-19.*

Each finding: **anchor · why systemic (not local) · long-term maintenance cost · scalability
impact · AI-maintainability impact · why the design likely exists · minimal corrective
direction · dependencies**. Ranked by permanent engineering leverage. The roadmap in §8
re-sequences them by dependency (some low-ranked enablers must land first).

---

## SYS-1 · The API is an implicit singleton, and nothing says so

**Composes:** SI-1..SI-9, CI-E4, CI-E6, P3-7. **Anchors:** `plugins/websocket.ts:11`
(`wsConnectionsByIp` Map), `lib/pubsub.ts:5-7` (listener Map), `index.ts:171` (in-process
rate limiter in non-prod), `env.ts:40-43`/`index.ts:355-362` (`RUN_WORKER_IN_PROCESS`
default true), `maintenance.worker.ts:118-124`.

**Why systemic, not local.** No single file is wrong. But nine independent in-process-state
decisions add up to one unwritten global invariant — *exactly one API instance runs* — that
is enforced nowhere and documented only in scattered comments. The per-IP WS cap and the
non-prod rate limiter are *correctness* features that silently degrade to per-instance under
horizontal scaling (5 connections/IP becomes 5×N; 100 req/min becomes 100×N). "Scale to 2
instances" is therefore not a config flip but a latent multi-defect event.

**Long-term maintenance cost.** Every future stateful feature inherits an invisible
constraint. An engineer adding an in-memory cache, counter, or debounce has nothing telling
them the process must remain a singleton, so the assumption deepens with each change and
becomes progressively more expensive to unwind.

**Scalability impact.** This is *the* horizontal-scaling ceiling. Redis-backed BullMQ (SI-5)
and Prisma/PgBouncer (SI-3) already scale; the blockers are purely the in-process Maps and
limiters. Until they move, the system's throughput ceiling is one Railway instance.

**AI-maintainability impact.** An agent reasoning locally about `websocket.ts` cannot see
that its Map is load-bearing for a cluster-wide limit; it will confidently "optimize" or
duplicate it. There is no central declaration for an agent to consult.

**Why the design likely exists.** Single-instance is the correct, simplest choice for launch
and for the current traffic; in-process Maps are the least-code path and were never a bug.

**Minimal corrective direction.** (a) Make the instance-count assumption *explicit and
central* (one `runtime.ts` constant/guard + a boot log line). (b) Move the two
correctness-bearing pieces — WS per-IP cap and rate limiter — behind Redis so they are
cluster-correct. (c) Turn CI-E6 into a guarantee: a readiness probe that fails if no queue
consumer is reachable, so a missing worker cannot silently strand emails/reminders/reconcile.

**Dependencies.** (b) adds keys to the shared Redis substrate → do **SYS-2** first so the new
keys land in a governed namespace.

---

## SYS-2 · Redis is an unpartitioned shared substrate with no key registry

**Composes:** HC-1, HC-2, CI-F5, CI-E3, M-4. **Anchors:** `authenticate.ts:66` (`deny:`),
`auth.service.ts:44,75,157,447` (`login:fail:`/`login:locked:`/`pwd_reset:`/`email_verify:`),
`threat-detector.ts:5-10` (`threat:*`/`ban:`), `admin.service.ts:67` (`admin:totp:setup:`),
`queue.ts:66` (`queue:rate:`), `notify-once.ts:20` (`notify:`), `availability-cache.ts:7-57`
(`restaurant:{id}:availability:*`/`:availver`), `webhook.routes.ts:97` (`ls-event:`).

**Why systemic, not local.** ≥11 unrelated concerns coin colon-prefixed keys ad hoc on **one**
Upstash instance, with `noeviction` merely *assumed* (probed by `check-env`, CI-E3). The
concerns span three correctness classes that must never share a fate — **security-authoritative**
(`deny:` revocation, `login:locked:`), **exactly-once** (`ls-event:`, `notify:`), and
**disposable** (`restaurant:*:availability`). Because they share one keyspace and one eviction
policy, a single misconfiguration or one subsystem's key-shape drift couples all of them: an
eviction of `deny:` is a *security* failure (revoked tokens resurrected), while the thing that
filled memory might be disposable cache. HC-3 makes the cache case concrete — writer/reader
key-shape must agree by convention or reads silently miss.

**Long-term maintenance cost.** The most heavily shared runtime resource in the system has no
schema, no ownership, and no TTL/eviction policy per class. Every new feature adds keys with
zero coordination; collisions and wrong-TTL bugs are invisible until production.

**Scalability impact.** `noeviction` means the whole platform's Redis is a single memory
ceiling shared by cache growth and security state; cache pressure can starve auth.

**AI-maintainability impact.** An agent editing one subsystem cannot see the whole keyspace,
cannot know which prefixes are security-critical, and may collide, reuse, or assume the wrong
eviction behavior. This is the single worst "invisible global" for an AI editor.

**Why the design likely exists.** Coining `client.set('prefix:'+id, …)` inline is the
fastest path and each subsystem was built independently; Upstash is a single managed instance.

**Minimal corrective direction.** One `redis-keys.ts` module of typed key builders (the only
place prefixes are minted) + an explicit per-prefix policy table classifying each as
security / exactly-once / disposable, with disposable keys carrying TTLs so eviction pressure
falls only on them. Optionally isolate security state on its own logical DB/instance.

**Dependencies.** None inbound — a foundational enabler. Unblocks SYS-1(b).

---

## SYS-3 · The deploy gate tests a different application than production runs

**Composes:** D-13, B-4, CI-F6. **Anchors:** `__tests__/helpers/server.ts:18-53`
(`buildTestServer`) vs `index.ts:79-290` (`buildServer`); `vitest.config.ts` (deletes
`CF_ORIGIN_SECRET`/Turnstile, `NODE_ENV=test`); `threat-detector.ts:17,38`,
`auth.service.ts:38,54,64` (test-mode short-circuits).

**Why systemic, not local.** `buildTestServer` is a **hand-maintained parallel composition**
that omits, relative to prod: the global rate limiter, the CORS allowlist (uses `origin:true`),
Helmet CSP, the raw-HTTP `/health`, the threat recorder, the extended IP-ban, the `onSend`
security-header pass, the method-override block, the WS plugin, `cloudflareOnly`, **and the
entire admin subsystem** (adminRoutes are never registered). `NODE_ENV=test` further disables
lockout and the threat detector. So `pnpm test` — the gate every CI/staging/prod deploy trusts
— certifies an application whose security-relevant middleware and one whole subsystem are
absent. The gap is not static: it *widens automatically* every time prod middleware grows,
because the two lists drift independently.

**Long-term maintenance cost.** Whole categories of behavior — CORS (P2-12, L-3), rate-limit
(H-1/M-4), security headers, admin TOTP (M-2/CI-H3) — are **structurally untestable** without
first fixing composition. Regressions in them cannot be caught by any test that could be
written today.

**Scalability impact.** Indirect: false green checks let latent production-only defects ship,
raising incident load as traffic grows.

**AI-maintainability impact.** The highest-severity trap for an agent: it observes "tests
pass," infers prod parity, and ships a change that a prod-only middleware would have rejected.
The gate actively *misleads* automated reasoning.

**Why the design likely exists.** A slimmer test server is faster to boot and avoids wiring
Redis-backed rate limiting / Cloudflare into unit tests; it grew as a convenience and was
never reconciled with `buildServer`.

**Minimal corrective direction.** Build the test server from the **same** `buildServer(opts)`
used in prod, with explicit test overrides (in-memory rate store, stub Cloudflare) — one
composition root, not two lists. Register admin routes. This converts the gate from
"different app" to "same app, test-configured."

**Dependencies.** Prerequisite for trusting the guard tests in [07](07-testing-review.md)
(GT-3..GT-6) and for safely refactoring shared logic under **SYS-6**.

---

## SYS-4 · Schema migration is forward-only, gated by a fire-and-forget deploy

**Composes:** CI-E1, CI-E7. **Anchors:** `deploy-prod.yml:148-167` (migrate step precedes
`railway up --service api --detach`), `deploy-staging.yml:112-130` (same), no down-migrations
under `packages/db/prisma/migrations/`, `railway.json` start never migrates.

**Why systemic, not local.** Three individually-reasonable choices interlock into an
unrecoverable failure mode: (1) *schema leads code* — `prisma migrate deploy` mutates the
**production** database **before** the new image ships; (2) *forward-only* — Prisma has no
down-migrations here, so an applied migration cannot be reverted programmatically; (3)
*detached deploy* — `railway up --detach` returns **before** the Railway build/health result
is known, so the workflow's "success" says nothing about whether the new code actually booted.
Combined: a destructive migration paired with a bad image leaves prod running old code against
a new (or half-new) schema, with **no automated rollback path and no signal that anything is
wrong**. The green checkmark is not proof production is healthy.

**Long-term maintenance cost.** Risk compounds with every schema change. Without an enforced
expand/contract discipline, the first destructive migration shipped alongside the code that
stops using a column is a latent production outage waiting for a coincident deploy failure.

**Scalability impact.** Larger tables → longer migrations → wider windows where schema and
code disagree; the detached deploy hides the disagreement.

**AI-maintainability impact.** An agent authoring a migration has no structural signal that
destructive changes are unsafe in the same deploy as the consuming code change, and no
rollback affordance to reach for. It will write the "obvious" drop-column migration.

**Why the design likely exists.** "Migrate before deploy" is the textbook ordering; Prisma
forward-only + `--detach` are the simplest Railway wiring and work fine on the happy path.

**Minimal corrective direction.** (a) Adopt and *document* expand/contract as the migration
rule (a destructive change is a separate, later deploy from the code that abandons the column).
(b) Replace `--detach`-and-done with a **post-deploy health poll** against `/health/ready`
that fails the job if the new instance is unhealthy. (c) Write a rollback runbook: redeploy
the previous image immediately; schema is only ever forward-fixed (never auto-reverted),
which expand/contract makes safe.

**Dependencies.** Reuses the health-gate mechanism that **SYS-5** also needs — build it once.

---

## SYS-5 · Staging validates less than production, so the canary contract is fiction

**Composes:** X-14, CI-E2, CI-E3. **Anchors:** `deploy-prod.yml:128-146` (`check-env`
pre-deploy) vs `deploy-staging.yml` (**no** `check-env` step); `branch-policy.yml:4-7`
(comment asserts `staging` "has actually been deployed and smoke-tested"); neither workflow
runs any smoke test.

**Why systemic, not local.** The release model's safety rests on one premise — *staging ≈
prod, and staging was verified* — encoded in `branch-policy.yml`, which blocks any
non-`staging` head from merging to `main`. But the two deploy workflows have drifted: staging
**skips `check-env`**, so it can boot with a mispooled `DATABASE_URL` (CI-E2) or wrong Upstash
eviction policy (CI-E3) that prod's gate would reject — meaning staging can be "green" in a
configuration prod refuses. And **nothing smoke-tests staging**: the comment's central claim
is simply untrue. The promotion gate is therefore guarding against the wrong risk while
believing it guards against the right one.

**Long-term maintenance cost.** Confidence in "staging passed" is unfounded and will be
trusted anyway, so config-class defects (pooling, eviction) surface first in production
despite a staging environment existing to catch exactly them.

**Scalability impact.** Config drift between environments grows as env-vars multiply; the
asymmetric validation guarantees staging stops being a faithful canary.

**AI-maintainability impact.** An agent reads `branch-policy.yml`, believes staging is
smoke-tested, and reasons about the pipeline on a false guarantee.

**Why the design likely exists.** Staging is auto-deploy and was optimized for speed;
`check-env` and smoke tests were added to prod (the thing that matters) and never backported.

**Minimal corrective direction.** Run the **identical** `check-env` on staging, and add a
post-deploy smoke test (same health-poll as SYS-4) so `branch-policy.yml`'s claim becomes
true. Make the two workflows share steps rather than diverge.

**Dependencies.** Reuses SYS-4's health-poll; do SYS-4 and SYS-5 together.

---

## SYS-6 · Correctness rests on hand-repeated conventions with no structural enforcement

**Composes:** CI-F1..F7, CI-C1, HC-5, HC-6, HC-7, P2-13. **Anchors:** layering
(`grep` in [02](02-dependency-graph.md §1), no lint rule); per-function status guards
(`reservation.service.ts:968,1091,1157,1228`) with no single state machine; display-vs-reconcile
duplicated rule (`reservation-engine.ts:24` vs `maintenance.worker.ts:47-55`, HC-5);
client/server plan-limit duplication (`lib/plan.ts:5` vs `apps/dashboard/src/lib/plan-limits.ts`,
HC-6); hand-mirrored `packages/types` (HC-7); inconsistent 422 shapes
(`admin.routes.ts:194` vs `reservation.routes.ts:52-57`, CI-F2).

**Why systemic, not local.** The architecture's cleanest properties are *unenforced customs*.
The downward-only layering (a genuine strength) is held only by discipline — one `lib/*` file
importing a module would invert it silently. The reservation lifecycle exists as duplicated
per-function guards rather than one state-machine definition, and the "past reservation is
COMPLETED" rule is encoded twice (display path + reconcile job) that must agree by hand.
Plan limits and domain types are duplicated across the client/server boundary. Each is correct
*today*; none resists drift *tomorrow*. Over 3–5 years and many authors/agents, undirected
conventions decay — this is architectural drift as a first-class risk.

**Long-term maintenance cost.** Every duplicated concept is a future divergence: server plan
limits change, client copy doesn't; a new reservation transition is added to one guard site
but not the reconcile rule. The cost is paid as slow, hard-to-attribute correctness bugs.

**Scalability impact.** Low direct; high *organizational* — the cost scales with team size and
number of AI edits, not traffic.

**AI-maintainability impact.** This is the defining 3–5-year AI concern. An agent has **no
lint/type barrier** to learn the convention from, so it will import "downward" the wrong way,
add a status transition in one place, or update one copy of a duplicated constant. Structural
enforcement is what makes a codebase safe for agents to edit; its absence guarantees drift.

**Why the design likely exists.** Conventions are cheaper than machinery early; duplication
across the client boundary avoided a shared-package build step; the layering "just held"
because the team was small and careful.

**Minimal corrective direction (targeted, not boil-the-ocean).** Three high-leverage locks:
(1) an ESLint `no-restricted-imports` boundary rule forbidding `lib/*`→`modules/*` — cheaply
converts CI-F1 from custom to enforced. (2) One reservation **state-machine table** that both
the mutation guards and the reconcile job consult — eliminates HC-5 and unifies CI-C1. (3)
Generate the client plan-limits and shared enum types from the single server source — kills
HC-6/P2-13 and de-risks HC-7.

**Dependencies.** Requires **SYS-3** first: refactoring shared logic (state machine, generated
limits) is only safe once the test gate exercises the real composition.

---

## SYS-7 · Owner = billing = tenant, with no organization boundary (strategic ceiling)

**Composes:** CI-A4, CI-A3, L-2. **Anchors:** `schema.prisma:385` (`subscriptions.userId
@unique`), `subscription.service.ts:196` (`getEffectiveLimitsForOwner` keyed on user id),
`db/src/index.ts:20-22` (`withUserContext`/RLS unused — the only DB-level tenancy backstop,
inert).

**Why systemic, not local.** The tenancy model collapses three distinct concepts —
*authentication principal* (User), *billing entity* (Subscription), and *tenant* (owner of
restaurants) — into one row, fixed by a single `@unique`. There is no organization/account
indirection, so a restaurant cannot change hands, be co-managed by a team, or be billed
separately from its creator. Simultaneously, the **only** tenant boundary is app-layer
`where` clauses (CI-A3); the DB-level backstop (RLS) is defined but inert (L-2). This is not a
bug — it is a data-model ceiling that every future B2B feature will hit.

**Long-term maintenance cost.** The highest-leverage item to address *early*, because it is
the hardest to retrofit: multi-user teams, agency-managed venues, ownership transfer, and
per-restaurant billing all require unwinding "owner == tenant == billing" after it has been
assumed in dozens of service functions.

**Scalability impact.** Business/organizational scalability, not throughput: the model caps
the product's addressable shape (single-operator only).

**AI-maintainability impact.** Agents will keep encoding `ownerId`-as-tenant assumptions
(they already pervade the services), each of which a future org model must find and unwind —
the assumption metastasizes with every AI edit until it is made explicit.

**Why the design likely exists.** One-operator-one-account is the correct, simplest model for
launch and matches the current single-operator target; RLS was scaffolded for later.

**Minimal corrective direction.** Introduce a tenant/account indirection (an `Account`/`Org`
the User belongs to and the Subscription + Restaurants hang off) **before** the assumption
spreads further, and activate RLS keyed on that tenant id as the DB backstop at the same time.
Strategic — sequence deliberately, but the cost of delay is monotonically increasing.

**Dependencies.** Pairs naturally with activating RLS (closes L-2/CI-A3). Independent of the
pipeline items; gated by product strategy, not by the other SYS findings.

---

## 8. Roadmap (dependency-sequenced, not merely ranked)

The findings above are ranked by leverage; executed as a roadmap they sequence by dependency.
Enablers first, then the items they unblock.

```
Wave 0 — foundational enablers (unblock everything else)
  SYS-2  Redis key registry + eviction policy classes      (no deps)
  SYS-3  Unify test server with buildServer()               (no deps)

Wave 1 — pipeline safety (share one health-gate mechanism)
  SYS-4  Expand/contract + post-deploy health gate + runbook   (reuses health poll)
  SYS-5  check-env + smoke test on staging                     (reuses SYS-4 poll)

Wave 2 — scale & drift (need Wave 0)
  SYS-1  De-singleton WS cap + rate limiter via Redis      (needs SYS-2)
         + worker-presence readiness probe
  SYS-6  ESLint boundary rule · state-machine table ·      (needs SYS-3)
         generated plan-limits/types

Wave 3 — strategic (product-gated, highest retrofit cost)
  SYS-7  Account/Org tenant indirection + activate RLS     (independent; do before it spreads)
```

**Coherence.** Wave 0 removes the two "invisible globals" (shared Redis, divergent test
composition) that make every later change riskier. Wave 1 builds one health-gate primitive and
uses it twice, closing the pipeline's unrecoverable failure modes. Wave 2 spends Wave 0's
enablers: SYS-1 relies on the governed Redis namespace; SYS-6 relies on the trustworthy test
gate. Wave 3 is the one item whose cost *rises* the longer it waits and should be scheduled on
product grounds, not deferred by default.

**Cross-references:** deployment specifics and per-stage verdicts → [06](06-pipeline-review.md);
concrete guard tests for the false/missing guarantees implied here → [07](07-testing-review.md).
