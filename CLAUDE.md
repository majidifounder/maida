# Maida — operating manual

Default procedure for all work in this repository. It applies unless the repo
owner explicitly says otherwise in the request itself.

`main` is production. `staging` is pre-production. Both are deployed branches —
never workspaces.

---

## Branching

Never develop directly on `main` or `staging`. Every task starts from a fresh
branch cut from the latest `staging`:

```bash
git fetch origin
git switch staging && git pull --ff-only
git switch -c <prefix>/<short-description>
```

| Prefix      | Use for                                      |
| ----------- | -------------------------------------------- |
| `feature/`  | new capability                                |
| `fix/`      | bug fix                                       |
| `chore/`    | tooling, CI, config, docs, dependencies       |
| `refactor/` | behaviour-preserving restructuring            |

Branch from `staging`, never from `main` — `main` may be ahead of `staging`
after a release, and branching from it drags unreleased commits into the PR.

## Development loop

For every task, in order:

1. Sync local `staging` (above).
2. Create the branch. **Report its name before making changes.**
3. Implement the change.
4. Run validation (below) and **report which commands ran**.
5. Fix every failure before continuing. Do not proceed with a red check.
6. Commit with a Conventional Commit message. **Report the exact commit.**
7. Push the branch to `origin`.
8. **Stop.** Report which branch to open the PR from.

## Validation

Run the subset that matches the change; run all four when unsure.

```bash
pnpm lint        # turbo run lint       — eslint across all 8 packages
pnpm typecheck   # turbo run typecheck  — tsc --noEmit
pnpm test        # turbo run test       — vitest
pnpm build       # turbo run build      — tsc / vite
```

Scope to one package with `--filter`, e.g. `pnpm --filter @restaurant/api test`.

`pnpm test` needs `.env.test` at the repo root pointing at a **throwaway**
database with `TEST_DATABASE=true`. The API suite creates and deletes rows;
`apps/api/vitest.config.ts` hard-exits without that flag. Never point it at
production. If the suite cannot run, say so plainly — do not work around it.

`pnpm lint` currently reports warnings but zero errors, and exits 0. Warnings
are not failures; do not mass-fix them as part of an unrelated task.

## Commits

Conventional Commits, matching existing history:

```
<type>(<optional scope>): <imperative summary>
```

Types in use: `feat`, `fix`, `ci`, `chore`, `build`, `docs`, `test`, `refactor`.
Explain **why** in the body when the reason is not obvious from the diff.

## Pull requests — owner only

```
feature/* ──PR──▶ staging ──(auto-deploy, smoke-test)──▶ PR ──▶ main ──▶ 🚀
```

**Never open a PR. Never merge. Never push to `staging` or `main`.** Those are
always manual, owner-performed actions.

After a branch is pushed, the owner reviews it, CI runs, and the owner merges
into `staging`. If CI fails, the owner will ask for a fix. If further changes
are needed after staging testing, start a **new** branch from the latest
`staging` — do not revive a merged one. The owner alone opens `staging → main`
and triggers the production deploy.

`main` is protected: PRs into it are rejected by the `Branch policy` required
check unless the source branch is `staging` (`.github/workflows/branch-policy.yml`).
`staging` requires the CI check to pass, which blocks direct pushes to it.

## Safety rules

Never, unless explicitly instructed in the request:

- Bypass this workflow.
- Target `main`.
- Change branch protection rules or rulesets.
- Disable, skip, or weaken CI — including skipping tests or disabling lint rules.
- Rewrite Git history (`rebase`, `amend`, `reset` on shared branches).
- Force push.

## Stop and ask

Stop and request confirmation before touching anything that could affect:

deployment · infrastructure · CI/CD · authentication · billing · security ·
production data · Git history

Report honestly. If a check fails, say so and show the output. If a step was
skipped, say which. Never describe work as verified when it was not run.
