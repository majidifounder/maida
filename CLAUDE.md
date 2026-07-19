# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) first — it is the mandatory editing protocol for this
repository** (required reading order, subsystem→spec table, verification workflow,
invariant registry, completion checklist). Everything there applies to Claude sessions.

Quick anchors:
- Living specs: `docs/architecture/spec/` · Invariants: `docs/architecture/INVARIANTS.md`
- Findings backlog: `docs/architecture/BACKLOG.md` · Doc map: `docs/architecture/README.md`
- Verify before done: `pnpm spec:check && pnpm lint && pnpm typecheck && pnpm test`
  (tests need Docker: `pnpm db:up && pnpm db:migrate:test`; `.env.test` gate is mandatory)
- Never un-skip/delete skipped guard tests to get green — they document known defects.
