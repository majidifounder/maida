# PROJECT_CONTEXT — Session Handoff

*This file is **working memory only**: recent work, current context, active handoff. It is
rewritten at the end of each working session and holds nothing durable. Architecture lives
in [docs/architecture/](docs/architecture/README.md) (living specs in `spec/`), the editing
workflow in [AGENTS.md](AGENTS.md), open findings in
[docs/architecture/BACKLOG.md](docs/architecture/BACKLOG.md), strategy in
[PLATFORM_MASTER_PLAN.md](PLATFORM_MASTER_PLAN.md). If something here contradicts those,
those win. (The former 1,400-line cross-session log that lived in this file was retired
2026-07-19 — see [docs/architecture/RETIRED.md](docs/architecture/RETIRED.md); note this
file was never committed, so the old content exists only in local backups, and it contained
verified inaccuracies — mTLS/gateway/optimistic-locking claims — per
[03-ground-truth-reconciliation.md](docs/architecture/03-ground-truth-reconciliation.md) §B.1.)*

## Recent work (2026-07-19)

**Finalization & consistency pass** (after the three-pass program below): Graphify
regenerated incrementally (1981 nodes / 3893 edges / 159 communities; guard suite + living
specs added, six retired docs pruned; health OK), AGENTS.md gained §7 (Graphify
regeneration-and-resync protocol) and now stands alone as the entry point, the drift guard
additionally digest-pairs INVARIANTS.md with the guard directory (editing guards now forces
a pass over the registry), anchors spot-verified against source, all local doc links
verified, one stale claim fixed (reservation.md said layering was "ESLint-enforced" — it is
drift-guard-enforced). Delivered as a review-ready PR to `staging` (see Active handoff).

Three-pass architecture program completed on branch `staging`:

1. **Ground-truth map** — `docs/architecture/01–04` (system map, dependency graph, doc
   reconciliation, candidate invariants) + refreshed `graphify-out/`.
2. **Systemic/pipeline/testing review** — `docs/architecture/05–07` (SYS-1..7, per-stage
   Safe/Unsafe deploy verdicts, testing-guarantee analysis).
3. **Living layer** — per-subsystem specs (`docs/architecture/spec/`), invariant registry
   (`INVARIANTS.md`), guard-test suite (`apps/api/src/__tests__/guards/`: 23 passing /
   7 skipped-by-design / 1 todo; full API suite 187 passing), CI drift guard
   (`scripts/spec-drift-check.mjs` + ci.yml step + `pnpm spec:check|spec:sync`),
   `AGENTS.md`/`CLAUDE.md` protocol, findings backlog (`BACKLOG.md`), doc consolidation
   (`RETIRED.md` lists every deleted document with rationale and replacement).

**Two new findings discovered while writing guards (recorded, deliberately NOT fixed):**
- **NEW-H1 (high):** `zonedTimeToUtc` double-subtracts the timezone offset — all
  wall-clock→UTC math is shifted for non-UTC restaurants (skipped guards in
  `guards/timezone.guard.test.ts`; UTC-timezone fixtures are why tests never caught it).
- **NEW-L1 (low):** non-owned-resource status inconsistency (restaurant module 404 vs
  reservation module 403).

## Current context

- All of the above is committed on a working branch off `staging` and delivered as a PR
  targeting `staging` (no direct push; review gate preserved).
- Local Docker stack (postgres/redis) running; test DB migrated; `.env.test` gate intact.
- Nothing deployed; no application behavior was changed by the architecture program.

## Active handoff — next actions

1. Review + merge the open PR into `staging` (the whole architecture program + finalization
   pass, in logically separated commits; note `SECURITY_REVIEW.md` and the old
   `PROJECT_CONTEXT.md` were untracked, so their removal/rewrite won't appear as
   deletions in the diff).
2. Triage **NEW-H1** (owner decision: the fix must cover existing stored rows + frontend
   display together — see `docs/architecture/spec/reservation.md`, INV-2 caveat).
3. Then the roadmap waves in `05-systemic-review.md` §8 (Wave 0: SYS-2 runtime key
   isolation, SYS-3 test-composition unification — the latter unblocks guard TODOs
   GT-3..6, GT-9).
