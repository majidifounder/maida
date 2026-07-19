# Drift Guard — How Spec↔Code Synchronization Is Enforced

*The living documentation workflow is enforced **structurally** (a CI gate), not by
contributor discipline. Mechanism: `scripts/spec-drift-check.mjs`, run by CI
(`.github/workflows/ci.yml` → "Spec drift guard") and locally via `pnpm spec:check`.*

## The three checks

| # | Check | Fails when |
|---|---|---|
| 1 | **Spec↔code digests** | Any file watched by a spec (per [spec/spec-map.json](spec/spec-map.json)) changes — or the spec itself changes — without `pnpm spec:sync` being re-run. Digests live in `spec/.spec-hashes.json` (committed). [INVARIANTS.md](INVARIANTS.md) is itself a spec-map entry watching the guard directory and this script, so editing guards (or the guard mechanism) forces a pass over the registry too. |
| 2 | **Registry↔guards** | [INVARIANTS.md](INVARIANTS.md) references a guard file that doesn't exist, a guard file mentions an `INV-n` with no registry row, or a guard file isn't referenced by the registry at all. |
| 3 | **Layering (CI-F1)** | Any file under `apps/api/src/lib/` or `apps/api/src/services/` imports from `modules/` — the downward-only rule ([spec/platform.md](spec/platform.md) §2). |

## The workflow it forces

```
change watched code ──► CI fails with the exact spec to re-read
        │
        ├─ spec still accurate?  → pnpm spec:sync → commit .spec-hashes.json
        └─ spec now stale?       → edit the spec → pnpm spec:sync → commit both
```

`pnpm spec:sync` is deliberately trivial to run — the guard's job is not to make syncing
hard, it is to make **skipping the spec impossible to do silently**: every PR that touches
spec-critical code visibly carries either a spec edit or a conscious "reviewed, still
accurate" re-sync in its diff, and reviewers can hold the author to that.

## Maintaining the guard itself

- **New subsystem/spec** → add the spec file + its watched paths to `spec-map.json`, run
  `pnpm spec:sync`.
- **New guard test file** → name it `apps/api/src/__tests__/guards/<area>.guard.test.ts`,
  reference the `INV-n` ids in comments/test names, and add it to
  [INVARIANTS.md](INVARIANTS.md) — check 2 verifies both directions.
- **Moving/renaming watched files** → update `spec-map.json` in the same commit.
- The script is dependency-free Node ≥20; keep it that way (it must run before `pnpm
  install` finishes being assumed).

## What it deliberately does NOT do

It cannot verify a spec's *content* is correct — only that a human/agent was forced past
the spec when the code moved. Content correctness is the editing protocol's job
([/AGENTS.md](../../AGENTS.md) — verification workflow) plus review.

It also cannot watch `graphify-out/` (gitignored, regenerated locally). Keeping the
dependency graph and its dependent documents (02-dependency-graph.md, spec architecture
sections) synchronized is the Graphify protocol in [/AGENTS.md](../../AGENTS.md) §7,
enforced by review.
