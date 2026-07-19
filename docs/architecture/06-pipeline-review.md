# 06 · Deployment Pipeline Review

*End-to-end lifecycle review: **Development → CI → Staging → Production**. Every stage carries
an explicit **Safe / Unsafe** verdict backed by anchors. Gaps are given IDs (PIPE-n), a closure
order, and the cross-references to systemic findings in [05](05-systemic-review.md). Authority =
workflow/config on `staging`, 2026-07-19. Verdicts describe the pipeline as written, not the
vendor state (Railway/Vercel/Supabase project existence is Unverifiable from source — see
[03 §D](03-ground-truth-reconciliation.md)).*

Verdict legend: **Safe** = no unmitigated correctness/safety gap at this stage · **Safe\*** =
safe for its declared purpose but carrying a scoped caveat · **Unsafe** = at least one gap that
can ship or hide a production defect.

---

## Stage 1 — Development (local, Docker)

**Verdict: Safe\*** — strong prod-isolation wall; a scoped fidelity caveat.

**Evidence.**
- Test/prod wall is real and layered: `vitest.config.ts` loads `.env.test` (not `.env`) and
  **hard-exits** unless `TEST_DATABASE==='true'` (`vitest.config.ts:22-40`); prod (Railway)
  never sets that var, so destructive suites cannot touch it even if prod creds leaked in.
- Test jobs isolate side-channels: `QUEUE_NAME='booking_events_test'` (never drains the
  dev/staging queue), Cloudflare secrets deleted so prod trust paths stay off
  (`vitest.config.ts`).
- Local infra is disposable Docker (`docker-compose.yml`: `postgres:16-alpine` + `redis:7-alpine`),
  matching CI images — the X-1 Docker-only model.

**Concrete gaps.**
- **PIPE-1 (fidelity).** Local/dev runs the in-memory rate limiter and no Cloudflare secret
  (`index.ts:171`, `cloudflare.ts:30-36`), so security-path behavior differs from prod. This
  is the same divergence that **SYS-3** makes untestable — dev cannot exercise the prod
  security middleware.
- **PIPE-2 (worker presence).** Nothing local verifies a queue consumer exists (CI-E6); a dev
  can run the API with `RUN_WORKER_IN_PROCESS=false` and no `worker.ts`, and emails/reminders
  silently never process.

**Ordering dependencies.** None inbound. **Closure order:** low priority; folded into SYS-3
(unify composition) and SYS-1(c) (worker-presence probe).

---

## Stage 2 — CI (`ci.yml`, every branch + PRs into main/staging)

**Verdict: Safe\*** — a genuine gate for what it covers; two blind spots it does **not** cover.

**Evidence (strengths).**
- Runs against a **real** Postgres with the GiST exclusion constraint and a **real** Redis
  (`ci.yml:26-48`) — the concurrency invariant INV-1 is exercised on the true engine, never a
  mock or shared DB.
- Real gate ordering: `prisma migrate deploy` → `prisma generate` → `lint` → `typecheck` →
  `test` → `build`, with `TEST_DATABASE=true` on ephemeral disposable stores (`ci.yml:96-130`).
- Supply-chain hygiene on the runner itself: `pnpm install --frozen-lockfile`, action versions
  **pinned to commit SHAs**, `confirm` input read via env var to prevent shell injection
  (`deploy-prod.yml:24-31`).
- Build artifacts uploaded per SHA (`ci.yml:132-141`).

**Concrete gaps.**
- **PIPE-3 (supply-chain gate is a no-op).** `pnpm audit` is wrapped to **warn, never fail**
  because the npm legacy audit endpoint returns HTTP 410 (`ci.yml:70-79`). Advisory gating
  rests entirely on Dependabot; CI cannot block a known-vulnerable dependency.
- **PIPE-4 (the gate certifies the wrong app).** `pnpm test` exercises `buildTestServer`, not
  `buildServer` — see **SYS-3**. CI green ≠ prod-composition green; CORS/rate-limit/threat/
  headers/admin are unexercised.
- **PIPE-5 (no schema-drift / down-migration check).** CI applies migrations forward only;
  nothing runs `prisma migrate diff` against a baseline or proves a migration is reversible,
  so a drift or a destructive change passes CI unremarked (feeds **SYS-4**).

**Ordering dependencies.** PIPE-4 is closed by SYS-3. **Closure order:** SYS-3 → then PIPE-3
(restore a working audit gate or adopt `osv-scanner`) → PIPE-5 (add migrate-diff step).

---

## Stage 3 — Staging (`deploy-staging.yml`, auto on push to `staging`)

**Verdict: Unsafe** — three gaps; the canary is not a faithful canary.

**Evidence.**
- Correct spine: ephemeral-store gate (lint/typecheck/test) → build → **`prisma migrate deploy`
  on staging DB → `railway up --service api --detach`** → Vercel web/dashboard, aliased to
  `*.staging.get-maida.com` (`deploy-staging.yml:83-161`). Migrate-before-deploy ordering is
  right (CI-E1).

**Concrete gaps.**
- **PIPE-6 (no `check-env` on staging).** Prod runs `check-env` pre-deploy (`deploy-prod.yml:128`);
  staging does **not**. Staging can boot with a mispooled `DATABASE_URL` (CI-E2/P1-10) or wrong
  Upstash eviction policy (CI-E3) that prod would reject — the canary can pass in a config prod
  refuses. **= SYS-5.**
- **PIPE-7 (fire-and-forget deploy, no smoke test).** `railway up --detach` returns before the
  Railway build/health result is known, and no step probes `/health/ready` afterward.
  `branch-policy.yml:4-7` *claims* staging is "smoke-tested" — untrue. **= SYS-4 / SYS-5.**
- **PIPE-8 (cancellable mid-flight).** `concurrency: cancel-in-progress: true`
  (`deploy-staging.yml:7-9`): a second push can cancel the first **between** `migrate deploy`
  and `railway up`, leaving staging's schema ahead of its running code with no signal.

**Ordering dependencies.** PIPE-6/7 close together with prod's health-gate work (SYS-4 primitive
reused by SYS-5). PIPE-8 is a one-line concurrency fix but only matters once PIPE-7's health gate
exists to detect the split state. **Closure order:** SYS-4 health poll → apply to staging (PIPE-7)
→ add `check-env` (PIPE-6) → set `cancel-in-progress:false` or guard the migrate/deploy pair
(PIPE-8).

---

## Stage 4 — Production (`deploy-prod.yml`, manual `workflow_dispatch`)

**Verdict: Unsafe** — strong front-door controls, but an unrecoverable migration/deploy tail.

**Evidence (strengths).**
- Best-in-pipeline entry controls: typed `DEPLOY` confirmation validated via env var
  (`deploy-prod.yml:19-31`), `concurrency: cancel-in-progress:false` (never cancels a prod
  deploy mid-flight, `:10-12`), GitHub `environment: production` scoping, **environment-scoped**
  secrets (`PROD_*`) and an env-scoped `RAILWAY_TOKEN` targeting the single `api` service.
- Full gate before any prod mutation: ephemeral-store `lint/typecheck/test` → build →
  **`check-env`** (blocks bad pooling/eviction, `:128-146`) → **`prisma migrate deploy` on prod**
  → `railway up` → Vercel web/dashboard/admin (`:109-205`). Admin is prod-only (internal, TOTP).
- Migrate-before-deploy ordering is correct (CI-E1); `check-env` closes P1-10 (PgBouncer) and
  probes CI-E3 (eviction) before the schema is touched.

**Concrete gaps.**
- **PIPE-9 (forward-only migration, no rollback).** `prisma migrate deploy` mutates the prod
  schema (`:148-154`) with **no** down-migration and **no** expand/contract enforcement. Once
  applied, a bad schema change cannot be programmatically reverted. **= SYS-4.**
- **PIPE-10 (deploy success is unverified).** `railway up --service api --detach` (`:167`)
  returns before the Railway build/boot/health result is known; the job's `success()` (and the
  "Production deployment complete" notice, `:207-209`) can be green while the new image is
  crash-looping. No post-deploy `/health/ready` poll exists. **= SYS-4.**
- **PIPE-11 (no rollback runbook / automation).** Nothing in-repo redeploys the previous image
  or defines recovery; combined with PIPE-9 a failed deploy has no defined path back. Build
  artifacts exist (`ci.yml:132`) but are not wired to any rollback.

**Ordering dependencies.** PIPE-9/10/11 are one coherent fix (SYS-4): expand/contract discipline
makes forward-only safe, the health poll makes `--detach` honest, the runbook makes recovery
defined. **Closure order:** health poll after `railway up` (PIPE-10) → expand/contract rule +
CI migrate-diff (PIPE-9, with PIPE-5) → documented rollback = redeploy previous image, schema
forward-fixed only (PIPE-11).

---

## 5. Cross-cutting: secret management, isolation, ordering

| Concern | Assessment | Anchor |
|---|---|---|
| **Secret storage** | GitHub Actions secrets, environment-scoped (`PROD_*`/`STAGING_*`), injected as step env only; JWT keypair for tests generated ephemerally per run, never stored | `deploy-*.yml` `env:` blocks; `ci.yml:81-94` |
| **Secret trust root** | Single root = GitHub; no rotation mechanism or secret-scanning gate in-repo (**PIPE-12**, low) | — |
| **Env isolation** | Good: separate Railway env-scoped tokens, separate Vercel project IDs per env (`VERCEL_PROJECT_ID_*_{STAGING,PROD}`), separate DB/Redis URLs; admin only in prod | `deploy-prod.yml:176-200`, `deploy-staging.yml:139-154` |
| **Pooled vs direct DB** | Correct split: runtime `DATABASE_URL` pooled 6543, migrations use `DIRECT_DATABASE_URL`; `check-env` mandates `?pgbouncer=true` on prod pooled URL | `schema.prisma:9-10`, `check-env.ts:73-81` (CI-E7/CI-E2) |
| **Migration ordering** | Correct (schema leads code) at every stage; the risk is *recovery*, not ordering (PIPE-9) | `deploy-*.yml` migrate steps |
| **Deploy ordering** | API → SPAs within a stage; SPAs assume the new API contract is live, but `--detach` means the API may not actually be up when SPAs deploy (**PIPE-13**, ties to PIPE-10) | `deploy-prod.yml:159-205` |
| **Promotion guard** | `staging`-only head into `main`, wired as required check; sound *mechanically*, but guards a canary that isn't verified (SYS-5) | `branch-policy.yml` |
| **Failure recovery** | Absent (PIPE-11); the sharpest cross-cutting gap | — |

---

## 6. Consolidated closure roadmap

One health-gate primitive closes most of the pipeline risk; build it once, reuse across stages.

```
Priority 1 — make deploys verifiable & recoverable  (closes PIPE-9,10,11,13; = SYS-4)
   • post-`railway up` poll of /health/ready → fail job if unhealthy
   • expand/contract migration rule + CI `prisma migrate diff` gate (PIPE-5)
   • rollback runbook: redeploy previous image; schema forward-fix only

Priority 2 — make staging a real canary            (closes PIPE-6,7,8; = SYS-5)
   • run check-env on staging (parity with prod)
   • reuse the P1 health poll as staging smoke test
   • stop cancelling between migrate and deploy (PIPE-8)

Priority 3 — make the gate certify the real app    (closes PIPE-4; = SYS-3)
   • test against buildServer() composition, incl. admin routes

Priority 4 — restore supply-chain gating           (closes PIPE-3)
   • replace retired `pnpm audit` with a working scanner (e.g. osv-scanner)

Priority 5 — dev fidelity & worker presence        (closes PIPE-1,2; = SYS-1c/SYS-3)
   • readiness probe fails without a reachable queue consumer
```

**Net.** The pipeline's *inputs* are well-guarded (typed prod confirmation, env-scoped secrets,
correct pool/migration ordering, staging-only promotion). Its *outputs* are not: no stage
verifies that the thing it deployed is actually healthy, and no stage can recover if it isn't.
Priorities 1–2 convert the two **Unsafe** stages to Safe by adding verification and recovery;
Priority 3 removes the false-confidence that lets defects reach those stages at all.

*Operational counterpart: the step-by-step operator runbook for executing these deploys
(vendor setup, secrets, promotion) is `LAUNCH_CHECKLIST_V2.md` at the repo root — this
review is the safety analysis, that checklist is the procedure. Gaps identified here
(PIPE-6/7/10) should be closed in the workflows themselves, then reflected there.*
