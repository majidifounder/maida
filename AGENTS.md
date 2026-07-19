# AGENTS.md — Editing Protocol for This Repository

**This is the mandatory entry point for every AI agent session and every new engineer.**
It exists so you can implement, verify, and document a change correctly *without first
exploring the repository*. Following it is not optional: CI structurally enforces parts of
it (drift guard, guard tests), and review enforces the rest.

> **What this system is (30 seconds):** a restaurant-reservation SaaS. One Fastify 5 API
> (`apps/api`) + three React SPAs (`apps/web` diner, `apps/dashboard` owner, `apps/admin`)
> + shared packages (`packages/db` Prisma→Postgres, `packages/types`,
> `packages/api-client`). Postgres (Supabase in prod) + Redis (Upstash in prod) + BullMQ
> workers + Resend email + Lemon Squeezy billing. Local dev/test run on Docker only.
> Double-booking prevention is a **database GiST exclusion constraint** — not application
> logic. The API is currently a deliberate **single instance**.

---

## 1. Required reading order (before any code change)

1. **This file** — the workflow.
2. **[docs/architecture/README.md](docs/architecture/README.md)** — the documentation map
   (2 minutes; tells you what exists and what is authoritative).
3. **The living spec for the subsystem you are changing** — see the table in §2. Read the
   whole spec; they are short by design. It tells you the stable architecture, the
   invariants you must not break, where new code belongs, and the known mistakes.
4. **[docs/architecture/INVARIANTS.md](docs/architecture/INVARIANTS.md)** — scan the rows
   whose anchors overlap your change; note their guard tests.
5. Only if your change is architectural (new module, new infra, cross-cutting):
   [docs/architecture/01-system-map.md](docs/architecture/01-system-map.md) and
   [02-dependency-graph.md](docs/architecture/02-dependency-graph.md).

Do **not** start by reading legacy prose docs; the living specs supersede them
([docs/architecture/RETIRED.md](docs/architecture/RETIRED.md) records what was retired and why).

## 2. Subsystem discovery — which spec do I read?

| You are touching… | Read first |
|---|---|
| Login, tokens, cookies, `authenticate`, password reset, email verify | [spec/auth-session.md](docs/architecture/spec/auth-session.md) |
| Bookings, holds, lifecycle (seat/cancel/…), engine, schedules, timezone math | [spec/reservation.md](docs/architecture/spec/reservation.md) |
| Search, availability, restaurant/table/turn-rule/closure config, logo, cache | [spec/availability.md](docs/architecture/spec/availability.md) |
| Plans, limits, operability, Lemon Squeezy, webhooks | [spec/billing.md](docs/architecture/spec/billing.md) |
| Email, queue, workers, reminders, WebSocket, pub/sub, maintenance jobs | [spec/notifications.md](docs/architecture/spec/notifications.md) |
| Admin routes, TOTP, bans, plan overrides | [spec/admin.md](docs/architecture/spec/admin.md) |
| `index.ts`, env, Redis, middleware, deploy/CI, `packages/db`, anything cross-cutting | [spec/platform.md](docs/architecture/spec/platform.md) |
| Frontend SPAs / `packages/api-client` | no spec yet — follow the API contracts in the relevant backend spec |

`docs/architecture/spec/spec-map.json` is the machine-readable version of this table
(source path → spec).

## 3. Editing workflow (every change)

1. **Read** the spec (§2). If your plan contradicts the spec's *stable architecture*
   section, stop — either your plan is wrong or you are proposing an architecture change
   (make that explicit, update the spec in the same PR, and say so in the PR).
2. **Verify claims against source before relying on them.** Specs cite anchors
   (`path:line`); line numbers drift, so confirm the anchored symbol still does what the
   spec says (open the file, or grep the symbol). If a spec statement is stale, fixing the
   spec is part of your change — the code is the authority, the spec must follow it.
3. **Place code where the spec's "where new code belongs" section says.** Hard rules that
   CI enforces: `lib/`/`services/` never import `modules/` (layering check); new Redis key
   prefixes must be registered in [spec/platform.md](docs/architecture/spec/platform.md) §4;
   new env vars go through `apps/api/src/env.ts`.
4. **Respect invariants.** If your change touches code anchored by an INV row, its guard
   test must still pass, and if you *intentionally* change an invariant you must update
   the INV row, the guard, and the spec together — never silently.
5. **Known bugs are backlog items, not drive-by fixes.**
   [docs/architecture/BACKLOG.md](docs/architecture/BACKLOG.md) is the single findings
   backlog (IDs like `M-1`, `SYS-3`, `NEW-H1`). Fixing one = its own change: un-skip its
   guard test, close the row, update the spec.

## 4. Verification workflow (before you call anything done)

Run, from the repo root:

```bash
pnpm spec:check        # drift guard: specs ↔ code ↔ registry ↔ layering
pnpm lint && pnpm typecheck
pnpm test              # requires Docker: pnpm db:up && pnpm db:migrate:test (once)
```

- Tests refuse to run unless `.env.test` sets `TEST_DATABASE=true` (they create/destroy
  data; the gate keeps them off production — never work around it).
- The guard suite lives in `apps/api/src/__tests__/guards/` and runs with `pnpm test`.
  **Never delete or un-skip a skipped guard to make CI green** — skipped guards document
  known defects (see the header comment in each file).
- Know the limits of green: `buildTestServer` omits production middleware and all admin
  routes (finding SYS-3), so rate-limit/CORS/headers/admin behavior is NOT covered by a
  passing suite — verify those paths manually if you touched them.
- If you changed spec-watched code: re-read the spec, update it if needed, then
  `pnpm spec:sync` and commit `.spec-hashes.json` with your change (CI fails otherwise).

## 5. Documentation update rules

| Your change… | You must update… |
|---|---|
| Alters behavior a spec describes | that spec (same PR) + `pnpm spec:sync` |
| Adds/changes/retires an invariant | [INVARIANTS.md](docs/architecture/INVARIANTS.md) row + guard test + owning spec |
| Adds a subsystem/module | new spec file + `spec-map.json` entry + §2 table above + spec/README.md |
| Fixes a backlog finding | close its [BACKLOG.md](docs/architecture/BACKLOG.md) row, un-skip its guard |
| Changes deploy/CI | [spec/platform.md](docs/architecture/spec/platform.md) §8 (+ pipeline review [06](docs/architecture/06-pipeline-review.md) if verdict-relevant) |
| Only refactors with zero behavior change | `pnpm spec:sync` (digest includes the code) — spec text usually untouched |

`PROJECT_CONTEXT.md` is the session handoff file (recent work / current context / active
handoff) — update it at the end of a working session; never put architecture knowledge
there, it belongs in the specs.

## 6. Invariant registry & guard mapping

[docs/architecture/INVARIANTS.md](docs/architecture/INVARIANTS.md) is the single source:
every invariant → anchor → guard test → status (GUARDED / PARTIAL / TODO / DEFECT). The
drift guard verifies the registry and the guard files reference each other. Current
DEFECT to be aware of: **NEW-H1** — `zonedTimeToUtc` double-subtracts the timezone offset
(non-UTC restaurants get shifted instants); its correct behavior is encoded in skipped
tests in `guards/timezone.guard.test.ts`.

## 7. Graphify — the dependency-graph ground truth (regenerate & resync)

`graphify-out/` (gitignored, regenerated locally) is the **authoritative machine view** of
modules, dependencies, and ownership boundaries: `graph.json` (raw graph),
`graph.html` (interactive viewer), `GRAPH_REPORT.md` (god nodes / communities / audit).
It is built by the `/graphify` skill — AST extraction for code, semantic extraction for docs.

- **Query it before exploring by hand.** Architecture questions ("what imports X?",
  "trace flow through Y") → `/graphify query "<question>"` against the existing graph.
- **Regenerate it whenever module structure changes** — new/moved/deleted source files,
  changed import edges, new packages, layer boundary changes:
  `/graphify . --update` (incremental; code-only changes are AST-only, no LLM cost).
  A missing/corrupt `graphify-out/` is rebuilt with a full `/graphify .` run.
- **Resync the dependent artifacts in the same change.** When the regenerated graph
  materially differs (the update prints a graph diff):
  1. [02-dependency-graph.md](docs/architecture/02-dependency-graph.md) — build stats
     header and any section (layering, cycles, god nodes) the diff contradicts;
  2. the owning spec's architecture/boundaries sections (§2 table);
  3. `spec-map.json` watch lists if files moved (then `pnpm spec:sync`);
  4. [INVARIANTS.md](docs/architecture/INVARIANTS.md) anchors if guarded code moved.
- The drift guard **cannot** watch `graphify-out/` (untracked); keeping the graph and
  its dependent documents synchronized is this protocol's job, enforced by review.

## 8. Completion checklist (copy into your working notes)

- [ ] Read the owning spec; my change matches its boundaries & placement rules
- [ ] Verified every spec/registry claim I relied on against current source
- [ ] `pnpm spec:check` green (ran `pnpm spec:sync` if watched code changed — after
      actually re-reading the spec)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` green locally (Docker up)
- [ ] No skipped guard deleted/un-skipped without fixing its finding
- [ ] Spec / INVARIANTS.md / BACKLOG.md updated per §5
- [ ] New Redis prefixes registered; new env vars in `env.ts` (+ `check-env` if prod-critical)
- [ ] Module structure/dependencies changed? → regenerated Graphify (`/graphify . --update`)
      and re-synced 02-dependency-graph.md + owning specs (§7)
- [ ] PROJECT_CONTEXT.md handoff updated if ending a session
- [ ] Reported honestly: what passed, what is not covered (SYS-3 gaps), what is deferred

---

*Deployment operations (Railway/Vercel/secrets): follow `LAUNCH_CHECKLIST_V2.md` (operator
runbook) and the safety analysis in
[docs/architecture/06-pipeline-review.md](docs/architecture/06-pipeline-review.md). Brand
work: `maida-brand-guidelines.md`. Product strategy: `PLATFORM_MASTER_PLAN.md`.*
