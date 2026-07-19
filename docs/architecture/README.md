# Architecture Ground Truth — Maida Reservation Platform

*Source-anchored architecture documentation. Generated 2026-07-19 from the `staging`
branch source code. **The source code is the sole authority.** Every claim here cites a
concrete anchor (`path:symbol`, `path:line`, a migration filename, an env key, a test
name, or a config key). Prose documents elsewhere in the repo were read only as claims to
verify — see [03-ground-truth-reconciliation.md](03-ground-truth-reconciliation.md).*

## What this area is

This directory is the canonical, deterministic architecture map of the platform, written
for future AI agents and engineers. It is organized as three layers of cross-referenced
artifacts plus this index: the **ground-truth map** (01–04, observation only), the
**systemic review** (05–07, analysis + corrective direction), and the **living layer**
(spec/, INVARIANTS.md, BACKLOG.md, DRIFT-GUARD.md — actively maintained, CI-enforced).
Terminology is fixed (see [Canonical terms](#canonical-terms)); prefer these files over
narrative planning docs when they disagree, because these are anchored to current code.

**Where to start:** if you are about to *change code*, start at the repository root
**[/AGENTS.md](../../AGENTS.md)** (the mandatory editing protocol) — it routes you to the
right spec. If you are trying to *understand the system*, start with
[01-system-map.md](01-system-map.md), then the relevant [spec/](spec/README.md) file.

## How the artifacts relate

```
                    ┌── 01 system map ─ 02 dependency graph ─┐   frozen ground truth
  code (authority) ─┤   03 reconciliation ─ 04 candidates    │   (dated snapshots)
        │           └── 05 systemic ─ 06 pipeline ─ 07 tests ┘   review verdicts
        │
        ├── spec/*.md          living per-subsystem contracts (maintained forever)
        ├── INVARIANTS.md      invariant → guard-test registry
        ├── BACKLOG.md         every open finding, one place, original IDs
        ├── DRIFT-GUARD.md     how spec↔code sync is enforced (CI)
        └── RETIRED.md         what legacy docs were deleted, and what replaced them
                │
   apps/api/src/__tests__/guards/*.guard.test.ts   executable invariants (run by pnpm test)
   scripts/spec-drift-check.mjs                    the enforcement mechanism (run by CI)
```

01–07 are **dated snapshots** — correct as of 2026-07-19, superseded progressively by the
living layer as code evolves; they are not updated retroactively (except that their open
findings now live in BACKLOG.md). The **living layer + guards** are what future changes
must maintain, structurally enforced per [DRIFT-GUARD.md](DRIFT-GUARD.md).

## Artifacts

### Ground-truth map (Prompt 1 — observation only)

| File | Contents |
|---|---|
| [01-system-map.md](01-system-map.md) | Subsystem inventory, per-subsystem request lifecycle, trust/data/tenancy boundaries, deployment topology, async & side-effect topology, external integrations, data model, and every load-bearing invariant with its anchor. |
| [02-dependency-graph.md](02-dependency-graph.md) | Module dependency graph, layering, detected cycles, cross-layer reach-ins, hidden coupling, dead/orphaned-code candidates, unexpected dependency directions, and every single-instance assumption. References the Graphify export. |
| [03-ground-truth-reconciliation.md](03-ground-truth-reconciliation.md) | Every material documentation claim classified Confirmed / Contradicted / Partially True / Unverifiable, with anchor + evidence. Resolves contradictions between and within docs. Carries forward prior review identifiers (P0-x, H-x, R-x). |
| [04-candidate-invariants.md](04-candidate-invariants.md) | Assumptions the system relies on but never explicitly enforces. Inputs for later triage. |

### Systemic review (Prompt 2 — analysis + corrective direction)

| File | Contents |
|---|---|
| [05-systemic-review.md](05-systemic-review.md) | Ranked **emergent** findings (SYS-1..SYS-7) where individually-correct files combine into whole-system risk — single-instance state, shared Redis substrate, test≠prod composition, forward-only migrations, staging-canary drift, convention-only enforcement, tenancy ceiling. Each with systemic rationale, long-term/scalability/AI-maintainability cost, minimal corrective direction, and a dependency-sequenced roadmap. |
| [06-pipeline-review.md](06-pipeline-review.md) | End-to-end Development → CI → Staging → Production review with an explicit **Safe / Unsafe** verdict per stage, evidence, gaps (PIPE-1..PIPE-13), secret/isolation/ordering assessment, and a consolidated closure roadmap. |
| [07-testing-review.md](07-testing-review.md) | What the suite actually **guarantees** vs. what a green run implies: true guarantees (T-1..T-6), false/absent guarantees as concrete guard tests (GT-1..GT-12), isolation weaknesses (ISO-1..ISO-3), environment assumptions, and production blind spots (BLND-1..BLND-4) — each mapped to an invariant/finding. |

### Living layer (Prompt 3 — maintained, CI-enforced)

| File | Contents |
|---|---|
| [spec/README.md](spec/README.md) | Spec index + the section contract every spec follows. |
| [spec/*.md](spec/) | Seven per-subsystem living specifications: platform, auth-session, reservation, availability, billing, notifications, admin. Stable architecture vs volatile detail, extension points, common mistakes, anchors. |
| [INVARIANTS.md](INVARIANTS.md) | Registry: every invariant → anchor → guard test → status (GUARDED/PARTIAL/TODO/DEFECT), incl. skipped guards for known defects. |
| [BACKLOG.md](BACKLOG.md) | The single findings backlog — every still-open item from all reviews, original IDs preserved. |
| [DRIFT-GUARD.md](DRIFT-GUARD.md) | The CI mechanism that makes spec/registry/guard sync structural (`scripts/spec-drift-check.mjs`, `pnpm spec:check` / `spec:sync`). |
| [RETIRED.md](RETIRED.md) | Retirement log: every deleted legacy document, rationale, replacement. |

Guard tests live at `apps/api/src/__tests__/guards/` (run by `pnpm test` in the same
CI/Docker environment as the rest of the suite — see [07 §runner model](07-testing-review.md)).

## Graphify dependency-graph export

The machine-readable dependency/call graph is at:

- `graphify-out/graph.json` — full graph, 1981 nodes / 3893 edges / 159 communities (build 2026-07-19, incl. the living-layer/guard-suite incremental update; health OK).
- `graphify-out/graph.html` — interactive viewer (open in a browser, no server).
- `graphify-out/GRAPH_REPORT.md` — god nodes, community labels, surprising connections.

Graphify was available and used (AST extraction for code + LLM semantic extraction for
the docs/CI corpus). See [02-dependency-graph.md](02-dependency-graph.md) for interpretation.
The directory is gitignored — regenerate with `/graphify . --update`; the
regeneration-and-resync protocol (when to rebuild, which artifacts must follow) is
[/AGENTS.md](../../AGENTS.md) §7.

## Canonical terms

| Term | Definition (anchored) |
|---|---|
| **API** | The single Fastify 5 server, `apps/api`, entry `apps/api/src/index.ts:buildServer`. The only backend process. |
| **Worker** | BullMQ notification + maintenance workers. In-process by default; separable via `RUN_WORKER_IN_PROCESS` (`apps/api/src/env.ts:40`, standalone entry `apps/api/src/worker.ts`). |
| **Engine** | Reservation availability/allocation logic in `apps/api/src/lib/reservation-engine.ts` + `service-schedule.ts` + `timezone.ts`. |
| **Hold** | A `reservation_tables` row (`packages/db/prisma/schema.prisma:347`) carrying a `[startsAt, endsAt)` interval for one table. |
| **Exclusion constraint** | `reservation_tables_no_overlap` GiST EXCLUDE, current definition in migration `20260705120000_reservation_timestamptz_timezone` (tstzrange). |
| **Operability** | Whether an owner may accept new bookings / mutate config; single classifier `isOwnerOperableByStatus` (`apps/api/src/modules/subscription/subscription.service.ts:86`). |
| **Availability version** | Per-restaurant O(1) cache invalidation counter, `restaurant:{id}:availver` (`apps/api/src/lib/availability-cache.ts:55`). |
| **Owner / Diner / Admin** | The three `Role` values (`packages/types/src/index.ts:1`, `Role` enum `packages/db/prisma/schema.prisma:16`). |

## Scope note

**01–04 are observation only**: no fixes, recommendations, refactors, or feature work —
findings that imply future work (candidate invariants, prior-review identifiers) are
recorded for later triage, not acted on. **05–07 add analysis and *corrective direction*
only**: they rank emergent problems, give per-stage deployment verdicts, and specify guard
tests, but stop at *direction*. **The living layer adds only documentation, guard tests
for already-true behavior, and CI scaffolding** — application behavior was not changed;
known defects discovered along the way (e.g. NEW-H1) are recorded in
[BACKLOG.md](BACKLOG.md) with skipped guards, never fixed in passing.
