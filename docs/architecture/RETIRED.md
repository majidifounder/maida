# Retired Documentation Log

*Every legacy document removed in the 2026-07-19 consolidation, with rationale,
replacement, and migration reference. Nothing disappeared silently: tracked files were
removed with `git rm` (recoverable from git history at any commit before the consolidation);
two files noted below were never committed. The consolidation rule: **one maintained purpose
per document, no two documents describing the same aspect of the current system.***

## Removed (tracked — recoverable via git history)

| Document | Rationale | Replacement | Migration reference |
|---|---|---|---|
| `PLATFORM_REVIEW.md` (2026-07-09) | Historical audit snapshot of the **pre-Phase-17** codebase; most P0/P1 findings were already fixed, and its architecture description conflicted with current code — a standing trap for readers | Current state: [01-system-map.md](01-system-map.md) + [spec/](spec/README.md) | Every claim classified in [03 §B.2](03-ground-truth-reconciliation.md); still-open findings (P0-3b, P1-11-residual, P2-3/5/6/7/12/13, P3-7/8) carried into [BACKLOG.md](BACKLOG.md) under original IDs |
| `DEBUG_LOG.md` (2026-07-12/13) | Stabilization diary; its fixes are in code and its counts stale | Living specs + git history | Claims classified in [03 §B.6](03-ground-truth-reconciliation.md). Its one **load-bearing decision** — EXPIRED→free-Starter fallback is intentional (Iteration 1) — is preserved in [spec/billing.md](spec/billing.md) §5 and X-2 |
| `docs/VALIDATION-2026-07-11.md` | One-time validation run record (#1–#11); all fixes confirmed present in code | Guard tests + [INVARIANTS.md](INVARIANTS.md) | All 11 items confirmed in [03 §B.5](03-ground-truth-reconciliation.md); the onSend contract it recorded is pinned in [spec/platform.md](spec/platform.md) §1 |
| `LAUNCH_CHECKLIST.md` (v1) | Self-declared superseded by V2; described retired local-infra and deploy flows (X-14) | `LAUNCH_CHECKLIST_V2.md` (kept — operational runbook) | [03 §B.7](03-ground-truth-reconciliation.md) |
| `docs/ARCHITECTURE-AVAILABILITY.md` | Accurate at freeze (2026-07-11) but unmaintained design prose duplicating what the living spec now owns — the exact drift-pair the consolidation eliminates | [spec/availability.md](spec/availability.md) + [spec/reservation.md](spec/reservation.md) (maintained, drift-guarded) | Claims confirmed in [03 §B.4](03-ground-truth-reconciliation.md); cache/search/invariant content absorbed into the specs; load-test design note retained as `scripts/load-test.ts` header |

## Removed / rewritten (never committed — no git history)

| Document | Rationale | Replacement |
|---|---|---|
| `SECURITY_REVIEW.md` (2026-07-09, untracked) | Historical security audit of pre-Phase-17 code; resolved items (L-1, and the "solid" confirmations) recorded in 03; open items migrated | Open H-1/H-2/M-1..M-4/L-2/3/5/6/7 rows in [BACKLOG.md](BACKLOG.md) §B under original IDs; classification in [03 §B.3](03-ground-truth-reconciliation.md) |
| `PROJECT_CONTEXT.md` (old content, untracked) | 1,400-line cross-session log containing **verified inaccuracies** (mTLS, gateway, optimistic locking, `SUPABASE_*` env vars, stale test counts — [03 §B.1](03-ground-truth-reconciliation.md)); rated least-reliable doc in the reconciliation | **Rewritten in place** as a 1-page session-handoff file (recent work / current context / active handoff). Durable knowledge now lives in specs; the entry point is [/AGENTS.md](../../AGENTS.md) |

## Reduced in scope (kept)

| Document | Change |
|---|---|
| `PLATFORM_MASTER_PLAN.md` | Pruned to **strategy only** (vision, market, pricing, R1–R21 plan, standing rulings, 10-year posture). Removed: execution log, §2 working-tree status table, §9 technical review detail, §10 debt register, §12 bottleneck ranking — all superseded by [BACKLOG.md](BACKLOG.md), [05](05-systemic-review.md)–[07](07-testing-review.md), and the specs. |

## Preserved unchanged

`LAUNCH_CHECKLIST_V2.md` (operational deploy runbook — cross-referenced from
[06-pipeline-review.md](06-pipeline-review.md)) · `maida-brand-guidelines.md` (brand) ·
`docs/R4-SERVICE-UX.md` (design charter) · `docs/architecture/01–07` (dated ground-truth +
review snapshots — the layer the living docs build on) · `graphify-out/` (dependency-graph
export).

## Dangling-reference note

The frozen snapshots 01–07 and this log still *mention* the retired documents by name —
that is intentional (they are historical records citing historical sources; 03 §B is
precisely the record of what those documents claimed). No **maintained** document
(AGENTS.md, specs, INVARIANTS.md, BACKLOG.md, master plan, checklists) links to a retired
file as a live source.
