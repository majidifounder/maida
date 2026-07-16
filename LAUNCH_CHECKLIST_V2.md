# Maida — Launch Checklist V2

A strictly ordered deployment guide. **Every step depends only on steps above it.**
If you follow it top to bottom you will never need to jump ahead or come back.

- **Domain:** `get-maida.com`
- **Starting point:** Supabase, Upstash, Resend and JWT keys exist (test + prod).
  Lemon Squeezy merchant approval is pending. Railway and Vercel have nothing yet.
- **Golden rule:** production credentials never live in a file on your machine.
  They exist only in Railway's `production` environment and the GitHub
  `production` environment.

## How to read this document

Each step is tagged:

| Tag | Meaning |
|-----|---------|
| 🤖 **AUTOMATED** | Paste the given prompt to your agent. It does the work. |
| 🖱️ **MANUAL** | Genuinely requires clicking in a vendor dashboard. |
| ✅ **VERIFY** | Prove the step worked before continuing. Do not skip these. |

Phases 0–6 get you a **working staging stack**. Phases 7–13 get you
**production**. Lemon Squeezy approval is only required from Phase 10 onward —
everything before it runs on Lemon Squeezy **test mode**.

---

## Architecture (decided — this is what the rest of the doc assumes)

| Host | What | Count |
|------|------|-------|
| **Railway** | 1 project `maida`, 2 environments (`staging`, `production`), one service named `api` in each | 1 project |
| **Vercel** | 1 project per app: `maida-web`, `maida-dashboard`, `maida-admin`. Staging = the Preview environment. Production = the Production environment. | 3 projects |
| **Supabase / Upstash** | 1 test + 1 prod each | done |

**Why not 5 Vercel projects:** a Vercel project already has Production and Preview
environments with independently scoped env vars. One project per app gives you the
staging/prod split with half the config surface, and the workflows already pass
`--environment=preview` for staging and `--prod` for production.

**Why not 2 Railway projects:** one project with two environments gives the same
isolation (one project token per environment — the staging token cannot touch
production) without duplicating variables across projects.

```
                 ┌──────── Cloudflare (DNS · TLS · CDN · WAF · Turnstile) ────────┐
 diner  ─▶ get-maida.com            ─▶ maida-web        (Vercel · Production)      │
 owner  ─▶ dashboard.get-maida.com  ─▶ maida-dashboard  (Vercel · Production)      │
 admin  ─▶ admin.get-maida.com      ─▶ maida-admin      (Vercel · Production)      │
 all    ─▶ api.get-maida.com        ─▶ api (Railway · production) ─┬─ Supabase     │
                                                                   ├─ Upstash      │
                                                                   ├─ Resend       │
                                                                   └─ Lemon Squeezy│
                 └───────────────────────────────────────────────────────────────┘

 staging.get-maida.com           ─▶ maida-web       (Vercel · Preview)
 dashboard-staging.get-maida.com ─▶ maida-dashboard (Vercel · Preview)
 api-staging.get-maida.com       ─▶ api (Railway · staging)
```

**Why the API cannot be serverless:** it holds long-lived WebSocket connections
(`/ws`) and runs an in-process BullMQ worker. That needs an always-on process.

---

## Cost at launch

| Service | Plan | Cost |
|---------|------|------|
| Domain | registrar | ~$1/mo amortised |
| Cloudflare | Free | $0 |
| Supabase (test + prod) | Free | $0 |
| Upstash (test + prod) | Free | $0 |
| Resend | Free (3 000/mo) | $0 |
| Lemon Squeezy | ~5% + fees per sale | $0 fixed |
| Railway | Hobby | ~$5/mo |
| Vercel | Hobby now → **Pro before real customers** | $0 → $20/mo |
| GitHub | Free | $0 |

> Vercel's Hobby tier is **non-commercial per its Terms**. Launch on Hobby to
> validate; budget Pro before you take paying customers.

---

# PHASE 0 · Repository fixes (must land before anything is deployed)

**Prerequisite:** none. Do this first.
**Why:** the deploy workflows contain three defects that will fail every deploy.
Fixing them now means Phase 6 works on the first push instead of the fifth.

### 0.1 · The three defects

1. Both workflows run `cd apps/api && railway up`. `railway up` uploads the
   working directory as the build context, so Railway receives `apps/api` with no
   `pnpm-lock.yaml`, no `pnpm-workspace.yaml` and no `packages/*`. The API depends
   on `@restaurant/db` and `@restaurant/types` as workspace packages, so the build
   cannot resolve them.
2. Nothing runs `prisma generate` outside CI. Railway would ship an ungenerated
   `@prisma/client` and crash at boot.
3. The `admin` app is not deployed by any workflow.

### 0.2 · 🤖 AUTOMATED — fix the deploy pipeline

> **Prompt to paste:**
>
> In the Maida monorepo, fix three defects in `.github/workflows/deploy-staging.yml`
> and `.github/workflows/deploy-prod.yml`:
>
> 1. Both workflows deploy the API with `cd apps/api && railway up --service api-<env>`.
>    `railway up` uploads the CWD as the build context, which excludes the pnpm
>    workspace root, the lockfile and `packages/*`, so the workspace deps
>    (`@restaurant/db`, `@restaurant/types`) cannot resolve. Change both to run
>    `railway up` from the repository root, and rename the service target to
>    `--service api` in both (we use one Railway project with a `staging` and a
>    `production` environment, each containing a single service named `api`;
>    the project token is environment-scoped so no `--environment` flag is needed).
> 2. Add a root `railway.json` so Railway builds the workspace correctly and
>    generates the Prisma client (nothing in the repo has a postinstall hook that
>    does this). Build must run pnpm install with a frozen lockfile, then
>    `prisma generate` for `@restaurant/db`, then build only the API and its
>    dependencies (not web/dashboard/admin). Start must run the API. Set the
>    healthcheck path to `/health`, which already exists.
> 3. The `admin` app is never deployed. Add an admin deploy step to
>    `deploy-prod.yml` only (admin is production-only, internal, TOTP-protected),
>    mirroring the existing web/dashboard Vercel steps and reading a new secret
>    `VERCEL_PROJECT_ID_ADMIN_PROD`.
> 4. In `deploy-staging.yml`, after the web and dashboard Vercel deploys, add
>    `vercel alias` steps pinning the preview deployments to
>    `staging.get-maida.com` and `dashboard-staging.get-maida.com`. Capture the
>    deployment URL from the `vercel deploy` output rather than assuming it.
>
> Verify `apps/api/package.json` scripts and `turbo.json` before writing the build
> command, and confirm both workflows still parse as valid YAML. Show me the diff
> and explain any assumption you had to make.

- [ ] Fixes applied on a feature branch, PR opened into `staging`.
- [ ] ✅ **VERIFY:** CI green on the PR. Merge to `staging`.

> The staging deploy steps will still fail at Railway/Vercel (no tokens yet).
> That is expected until Phase 5.

---

# PHASE 1 · Lemon Squeezy test mode (unblocks everything)

**Prerequisite:** none.
**Why this is first:** `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`,
`LEMON_SQUEEZY_WEBHOOK_SECRET` and all three `LS_VARIANT_*` are **required** in
`apps/api/src/env.ts` — the API `process.exit(1)`s on boot without them. That
means your pending merchant approval blocks **staging too**, not just production.

Lemon Squeezy **test mode** works before merchant approval. You get a store ID,
a test API key and test variant IDs today. Approval is only needed to accept
**real money** (Phase 10).

### 1.1 · 🖱️ MANUAL — store, test API key, variants

1. [ ] Lemon Squeezy → create/open your store → **Settings → Stores** → copy the
   numeric **Store ID**.
2. [ ] Toggle the dashboard into **Test mode**.
3. [ ] **Settings → API** → create a key → this is your **test** `LEMON_SQUEEZY_API_KEY`.
4. [ ] Create one subscription product with three variants matching
   `apps/api/src/lib/plan.ts`:

   | Plan | Restaurants | Bookings/mo | Env var |
   |------|-------------|-------------|---------|
   | STARTER | 1 | 200 | `LS_VARIANT_STARTER` |
   | PRO | 5 | 1 000 | `LS_VARIANT_PRO` |
   | PREMIUM | Unlimited | Unlimited | `LS_VARIANT_PREMIUM` |

5. [ ] Open each variant → copy its numeric **Variant ID**.

### 1.2 · Record what you now have

Write these into a scratch note — you will paste them into Railway in Phase 3.
These are **test** values; they are not production secrets.

- [ ] `LEMON_SQUEEZY_STORE_ID`
- [ ] `LEMON_SQUEEZY_API_KEY` (test)
- [ ] `LS_VARIANT_STARTER` / `_PRO` / `_PREMIUM` (test)

> The **webhook secret** is deliberately not here. The webhook needs a public API
> URL, which does not exist until Phase 3. You will create it in Phase 3.6.

- [ ] ✅ **VERIFY:** you have 5 of the 6 Lemon Squeezy values. Store ID and all
  three variant IDs are numeric.

---

# PHASE 2 · Confirm the test stack is sound locally

**Prerequisite:** Phase 0 merged.
**Why:** every later phase assumes the code builds and the test wall holds. Prove
it once, locally, before any host is involved.

### 2.1 · The test/production wall

`pnpm test` and `pnpm e2e` load `.env.test` and **refuse to run** unless it sets
`TEST_DATABASE=true` (`apps/api/vitest.config.ts`, `scripts/e2e/preload-env.ts`).
Production never sets that var, so even if prod credentials were somehow loaded,
the destructive suites abort. CI spins up its own throwaway Postgres and Redis.

**Never point these at production:** `pnpm test` · `pnpm e2e` · `pnpm db:seed` ·
`pnpm db:reset` · `pnpm db:dev-reset`.

### 2.2 · Run the gate

```bash
cp .env.test.example .env.test     # fill with TEST Supabase + Upstash creds only
pnpm install
pnpm --filter @restaurant/db db:migrate:deploy   # against the TEST db
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- [ ] ✅ **VERIFY:** all four commands exit 0.
- [ ] ✅ **VERIFY:** no production URL or credential appears in `.env`, `.env.test`,
  or any other local file. `grep -ri "prod" .env .env.test` should show nothing
  meaningful.

---

# PHASE 3 · Railway — staging API

**Prerequisite:** Phase 0 (railway.json exists), Phase 1 (LS test values in hand).
**Why now:** the staging API URL that Vercel (Phase 4) and GitHub (Phase 5) both
need is produced here. Nothing downstream can be configured until this URL exists.

### 3.1 · 🖱️ MANUAL — create the project and environments

1. [ ] Railway → **New Project → Deploy from GitHub repo** → select `maida`.
2. [ ] Rename the default service to **`api`**. Leave Root Directory at the
   repository root — `railway.json` (Phase 0) supplies the build and start
   commands. **Do not set Root Directory to `apps/api`**; that breaks pnpm
   workspace resolution.
3. [ ] Rename the default environment to **`production`**.
4. [ ] Create a second environment named **`staging`** (it inherits the service).

> If your Railway plan does not offer multiple environments, fall back to one
> project with two services named `api-staging` and `api-prod`, and tell your
> agent to revert the `--service api` rename from Phase 0. Everything else in this
> doc is unchanged.

### 3.2 · 🖱️ MANUAL — staging variables

Railway → environment **`staging`** → service `api` → **Variables**. Set:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | **TEST** Supabase transaction pooler (6543) **+ `?pgbouncer=true&connection_limit=10`** |
| `DIRECT_DATABASE_URL` | **TEST** Supabase session pooler (5432) |
| `REDIS_URL` | **TEST** Upstash `rediss://…` |
| `JWT_PRIVATE_KEY` | **TEST** RS256 private PEM |
| `JWT_PUBLIC_KEY` | **TEST** RS256 public PEM |
| `RESEND_API_KEY` | your Resend key |
| `EMAIL_FROM` | `onboarding@resend.dev` |
| `LEMON_SQUEEZY_API_KEY` | test key (Phase 1) |
| `LEMON_SQUEEZY_STORE_ID` | store ID (Phase 1) |
| `LS_VARIANT_STARTER` / `_PRO` / `_PREMIUM` | test variant IDs (Phase 1) |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | `placeholder-replaced-in-3.6` |
| `NODE_ENV` | `production` |
| `RUN_WORKER_IN_PROCESS` | `true` |

**Do not set `TEST_DATABASE` here.** **Do not set `CF_ORIGIN_SECRET` on staging** —
staging does not sit behind the Cloudflare origin guard.

> `pgbouncer=true` is not optional. Prisma's prepared statements break on the
> transaction pooler without it (`prepared statement "s0" already exists`), and
> `check-env` blocks the prod deploy if it is missing.

### 3.3 · 🖱️ MANUAL — apply the schema to the test DB

Already done in Phase 2.2 if you migrated your TEST Supabase project. If you used
a local Postgres there, run it now against TEST Supabase:

```bash
DATABASE_URL="<test-direct-url>" DIRECT_DATABASE_URL="<test-direct-url>" \
  pnpm --filter @restaurant/db db:migrate:deploy
```

### 3.4 · 🖱️ MANUAL — generate the staging domain

1. [ ] Railway → `staging` → service `api` → **Settings → Networking →
   Generate Domain**.
2. [ ] Copy the URL, e.g. `https://api-staging-xxxx.up.railway.app`.
   **Write it down — Phases 4, 5 and 6 all need it.**

### 3.5 · 🖱️ MANUAL — staging deploy token

1. [ ] Railway → **Project Settings → Tokens** → create a token scoped to the
   **`staging`** environment. Name it `github-actions-staging`.
2. [ ] Write it down. It goes into GitHub in Phase 5.

> Scope the token to the environment, not the account. An account-wide token in
> the staging workflow could deploy production.

### 3.6 · 🖱️ MANUAL — Lemon Squeezy staging webhook

Now that a public API URL exists, the webhook can be created.

1. [ ] Lemon Squeezy (**test mode**) → **Settings → Webhooks → Add** → URL:
   `https://<your-staging-railway-url>/webhooks/lemon-squeezy`
2. [ ] Enable exactly these 8 events (all consumed by `webhook.routes.ts`):
   `subscription_created`, `subscription_updated`, `subscription_cancelled`,
   `subscription_resumed`, `subscription_expired`, `subscription_payment_success`,
   `subscription_payment_failed`, `subscription_payment_recovered`.
3. [ ] Copy the **signing secret** → replace the placeholder
   `LEMON_SQUEEZY_WEBHOOK_SECRET` in Railway `staging` (3.2).

> The route is `POST /webhooks/lemon-squeezy`. It takes no JWT — it is
> HMAC-SHA256 verified and registered before the Cloudflare origin guard.

- [ ] ✅ **VERIFY:** Railway `staging` has all 15 variables set and no
  `TEST_DATABASE`, no `CF_ORIGIN_SECRET`.
- [ ] ✅ **VERIFY:** you have written down the staging API URL and the staging
  Railway token.

---

# PHASE 4 · Vercel — three projects

**Prerequisite:** Phase 3.4 (you have the staging API URL).
**Why now:** `VITE_API_URL` is baked in at **build time** by Vite. You cannot
configure a Vercel project correctly without already knowing the API URL — which
is exactly the dependency the old checklist got backwards.

### 4.1 · 🖱️ MANUAL — create the projects

Create three projects via **Import Git Repository → `maida`**:

| Project | Root directory | Build command | Output dir |
|---------|----------------|---------------|------------|
| `maida-web` | `apps/web` | `pnpm install && pnpm --filter @restaurant/web build` | `apps/web/dist` |
| `maida-dashboard` | `apps/dashboard` | `pnpm install && pnpm --filter @restaurant/dashboard build` | `apps/dashboard/dist` |
| `maida-admin` | `apps/admin` | `pnpm install && pnpm --filter @restaurant/admin build` | `apps/admin/dist` |

- [ ] All three created.
- [ ] **Disable Vercel's automatic Git deployments** on all three (Settings → Git →
  Ignored Build Step, or disconnect the repo). The GitHub workflows are the only
  thing that should deploy, or you will get double deploys racing each other.

### 4.2 · 🖱️ MANUAL — environment variables

Vercel scopes env vars per environment. Set them **per scope**, not globally.

**`maida-web`:**

| Variable | Scope | Value |
|----------|-------|-------|
| `VITE_API_URL` | Preview | your staging Railway URL (3.4) |
| `VITE_API_URL` | Production | `https://api.get-maida.com` |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | Preview | `1x00000000000000000000AA` (always-passes test key) |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | Production | *(leave unset — set in Phase 9)* |

**`maida-dashboard`:**

| Variable | Scope | Value |
|----------|-------|-------|
| `VITE_API_URL` | Preview | your staging Railway URL (3.4) |
| `VITE_API_URL` | Production | `https://api.get-maida.com` |

**`maida-admin`:**

| Variable | Scope | Value |
|----------|-------|-------|
| `VITE_API_URL` | Production | `https://api.get-maida.com` |

> `https://api.get-maida.com` does not resolve yet. That is fine — it is a
> build-time string, and DNS lands in Phase 8 before any production traffic.

### 4.3 · 🖱️ MANUAL — collect the deploy identifiers

```bash
vercel login
vercel whoami                    # confirms the account
```

- [ ] **Settings → Tokens** (account level) → create a token → `VERCEL_TOKEN`.
- [ ] Team/account **Settings → General → Team ID** → `VERCEL_ORG_ID`.
      (Or run `vercel link` in `apps/web` and read `.vercel/project.json`.)
- [ ] Each project → **Settings → General → Project ID**:
  - `maida-web` → used for **both** `VERCEL_PROJECT_ID_WEB_STAGING` and `_WEB_PROD`
  - `maida-dashboard` → both `VERCEL_PROJECT_ID_DASHBOARD_STAGING` and `_DASHBOARD_PROD`
  - `maida-admin` → `VERCEL_PROJECT_ID_ADMIN_PROD`

> Same ID in the `_STAGING` and `_PROD` secrets is correct and intentional. The
> workflows separate the environments with `--environment=preview` vs `--prod`,
> not with different projects.

- [ ] ✅ **VERIFY:** you have 1 token, 1 org ID, and 3 project IDs written down.
- [ ] ✅ **VERIFY:** `.vercel/` is not committed (it is git-ignored).

---

# PHASE 5 · GitHub — secrets and variables

**Prerequisite:** Phase 3.4 + 3.5 (staging URL + Railway token), Phase 4.3
(Vercel token, org ID, project IDs).
**Why now, and not earlier:** every value below is *produced* by Phases 3 and 4.
This is the step the old checklist put before its own inputs existed.

Repo: `majidifounder/maida`. These names are exactly what the workflows read.

### 5.1 · Repository-level secrets (shared by both environments)

```bash
for s in VERCEL_TOKEN VERCEL_ORG_ID \
         VERCEL_PROJECT_ID_WEB_STAGING VERCEL_PROJECT_ID_DASHBOARD_STAGING \
         VERCEL_PROJECT_ID_WEB_PROD    VERCEL_PROJECT_ID_DASHBOARD_PROD \
         VERCEL_PROJECT_ID_ADMIN_PROD; do
  gh secret set "$s" --repo majidifounder/maida
done
```

### 5.2 · `staging` environment

The staging deploy only reads a Railway token and the two staging DB URLs. The
staging API's own runtime env lives in **Railway**, not here.

```bash
for s in STAGING_RAILWAY_TOKEN STAGING_DATABASE_URL STAGING_DIRECT_DATABASE_URL; do
  gh secret set "$s" --env staging --repo majidifounder/maida
done

gh variable set STAGING_URL --env staging --repo majidifounder/maida \
  --body "https://<your-staging-railway-url>"    # from Phase 3.4
```

### 5.3 · `production` environment — partial for now

You have Supabase, Upstash, Resend and JWT prod values. You do **not** have Lemon
Squeezy production keys yet. Set what you have; Phase 10 completes the rest.

```bash
for s in PROD_DATABASE_URL PROD_DIRECT_DATABASE_URL PROD_REDIS_URL \
         PROD_CORS_ORIGIN PROD_EMAIL_FROM PROD_RESEND_API_KEY; do
  gh secret set "$s" --env production --repo majidifounder/maida
done

# JWT PEMs must come from a file to preserve their newlines:
gh secret set PROD_JWT_PRIVATE_KEY --env production --repo majidifounder/maida < prod-private.pem
gh secret set PROD_JWT_PUBLIC_KEY  --env production --repo majidifounder/maida < prod-public.pem

gh variable set PRODUCTION_URL --env production --repo majidifounder/maida \
  --body "https://api.get-maida.com"
```

Values to use now:

- `PROD_CORS_ORIGIN` = `https://get-maida.com,https://www.get-maida.com,https://dashboard.get-maida.com,https://admin.get-maida.com`
  — no trailing slashes, no `localhost` (prod `check-env` rejects both).
- `PROD_EMAIL_FROM` = `onboarding@resend.dev` for now → `noreply@get-maida.com`
  in Phase 8.
- The prod Railway token is created in Phase 7. `PROD_CF_ORIGIN_SECRET` in
  Phase 9. Lemon Squeezy prod values in Phase 10.

- [ ] ✅ **VERIFY:** `gh secret list --env staging --repo majidifounder/maida`
  shows 3 secrets.
- [ ] ✅ **VERIFY:** `gh secret list --repo majidifounder/maida` shows 7
  repo-level secrets.
- [ ] ✅ **VERIFY:** delete `prod-private.pem` / `prod-public.pem` from your
  machine once they are in GitHub — you will paste them into Railway in Phase 7
  from your note, then destroy the note.

---

# PHASE 6 · First staging deploy

**Prerequisite:** Phases 0–5 complete.
**Why:** this is the first moment anything can actually deploy. Everything it
needs now exists.

### 6.1 · Deploy

```bash
git switch staging && git push
```

`deploy-staging.yml` runs automatically: CI gate (lint, typecheck, test on an
ephemeral Postgres+Redis) → build → migrate the staging DB → deploy the API to
Railway `staging` → deploy web + dashboard to Vercel Preview → alias them.

- [ ] Workflow green end to end.

### 6.2 · ✅ VERIFY — the staging stack

```bash
curl https://<staging-api-url>/health         # {"status":"ok",...}
curl https://<staging-api-url>/health/ready   # {"checks":{"database":"ok","redis":"ok"}}
```

- [ ] `/health` → 200.
- [ ] `/health/ready` → `database: ok`, `redis: ok`.
- [ ] `GET /` → 404. **This is correct** — the API has no homepage.

### 6.3 · ✅ VERIFY — full end-to-end on staging

Do not proceed to production until every one of these passes on staging.

- [ ] Register → verification email arrives → login.
- [ ] Create restaurant → add table → book a slot → confirmation shows.
- [ ] Owner dashboard **updates live while a diner books** (WebSocket `/ws`).
- [ ] Cancel → row/table state updates.
- [ ] Owner checkout with a Lemon Squeezy **test card** → webhook fires →
  `/subscriptions/me` shows the new plan.
- [ ] Re-send the same webhook → log shows *duplicate — skipping* (idempotent).
- [ ] STARTER owner blocked from a 2nd restaurant → 403 `Plan limit reached`.

> Resend is in sandbox until Phase 8 — it only delivers to your own account email.
> That is expected here.

**Staging is now your safety net. Every future change goes through it.**

---

# PHASE 7 · Railway — production API

**Prerequisite:** Phase 6 fully green.
**Why now:** you never build production until staging has proven the same code
path works.

### 7.1 · 🖱️ MANUAL — production variables

Railway → environment **`production`** → service `api` → **Variables**.
Same 15 variables as 3.2, but with **PROD** values, plus:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | **PROD** Supabase pooler (6543) **+ `?pgbouncer=true&connection_limit=10`** |
| `DIRECT_DATABASE_URL` | **PROD** Supabase session pooler (5432) |
| `REDIS_URL` | **PROD** Upstash `rediss://…` |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | **PROD** RS256 pair |
| `CORS_ORIGIN` | the four `get-maida.com` origins (as in 5.3) |
| `WEB_URL` | `https://get-maida.com` |
| `DASHBOARD_URL` | `https://dashboard.get-maida.com` |
| `EMAIL_FROM` | `onboarding@resend.dev` → changes in Phase 8 |
| `LEMON_SQUEEZY_*` / `LS_VARIANT_*` | **test values for now** → replaced in Phase 10 |
| `NODE_ENV` | `production` |
| `RUN_WORKER_IN_PROCESS` | `true` |

`CF_ORIGIN_SECRET` is deliberately **not set yet** — Phase 9, after Cloudflare
exists. Setting it before the Transform Rule exists would make the API reject
every request.

- [ ] ✅ **VERIFY:** prod Upstash eviction policy is **`noeviction`**
  (Upstash console → your DB → Configuration). The default `allkeys-lru`
  silently evicts rate-limit counters and the JWT deny-list, and prod
  `check-env` fails on it.
- [ ] ✅ **VERIFY:** your prod credential note has now been transcribed into
  Railway and GitHub. **Destroy the note.** Prod creds must not exist on your
  machine.

### 7.2 · 🖱️ MANUAL — apply the schema to the prod DB

The API image never migrates at boot. The workflow migrates on each deploy, but
the first schema apply is safest by hand:

```bash
DATABASE_URL="<prod-direct-url>" DIRECT_DATABASE_URL="<prod-direct-url>" \
  pnpm --filter @restaurant/db db:migrate:deploy
```

- [ ] Migrations applied. **Never run `pnpm db:seed` against prod** — it inserts
  demo data.
- [ ] Supabase free tier has **no automated backups**. Run `pnpm db:export`
  before every prod change, or budget Supabase Pro ($25/mo).

### 7.3 · 🖱️ MANUAL — production token and domain

1. [ ] Railway → **Project Settings → Tokens** → token scoped to the
   **`production`** environment → `gh secret set PROD_RAILWAY_TOKEN --env production --repo majidifounder/maida`
2. [ ] `production` → service `api` → **Settings → Networking → Generate Domain**
   (temporary; Phase 8 puts `api.get-maida.com` in front of it). Write it down.

- [ ] ✅ **VERIFY:** `gh secret list --env production` now shows 9 secrets.

---

# PHASE 8 · Cloudflare + domain + email

**Prerequisite:** Phase 7 (prod Railway service exists and has a domain target),
Phase 4 (Vercel projects exist as domain targets).
**Why now:** you cannot create DNS records pointing at hosts that do not exist.

### 8.1 · 🖱️ MANUAL — add the site

1. [ ] `dash.cloudflare.com` → **Add a site** → `get-maida.com` → **Free** plan.
2. [ ] Switch your registrar's nameservers to Cloudflare's. Wait for **Active**.

### 8.2 · 🖱️ MANUAL — DNS

Add each custom domain **inside the host first** (Vercel → project → Domains;
Railway → service → Settings → Domains) so it issues a certificate and gives you
a CNAME target. Then add the records:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `@` / `www` | `maida-web` Vercel target | **Proxied** 🟠 |
| CNAME | `dashboard` | `maida-dashboard` target | **Proxied** 🟠 |
| CNAME | `admin` | `maida-admin` target | **Proxied** 🟠 |
| CNAME | `api` | Railway `production` target | **Proxied** 🟠 |
| CNAME | `staging` | `maida-web` target | **Proxied** 🟠 |
| CNAME | `dashboard-staging` | `maida-dashboard` target | **Proxied** 🟠 |
| CNAME | `api-staging` | Railway `staging` target | **Proxied** 🟠 |

### 8.3 · 🖱️ MANUAL — TLS and WebSockets

- [ ] **SSL/TLS → Overview → Full (strict)**.
- [ ] **Edge Certificates →** Always Use HTTPS **on**, Min TLS **1.2**.
- [ ] **Network → WebSockets → On**. *Required* — the `/ws` live feed dies without it.

### 8.4 · 🖱️ MANUAL — Resend domain verification

1. [ ] Resend → **Domains → Add domain** → `get-maida.com`.
2. [ ] Add the SPF / DKIM / DMARC records to Cloudflare DNS as
   **DNS only / grey cloud**. Mail records must not be proxied.
3. [ ] Once verified, set `EMAIL_FROM=noreply@get-maida.com` in **both**:
   - Railway `production` variables
   - `gh secret set PROD_EMAIL_FROM --env production --repo majidifounder/maida`

- [ ] ✅ **VERIFY:** `dig api.get-maida.com` returns Cloudflare IPs
  (104.x / 172.x), not your Railway origin.
- [ ] ✅ **VERIFY:** all four prod hostnames serve valid HTTPS.
- [ ] ✅ **VERIFY:** Resend shows the domain as **Verified**.

---

# PHASE 9 · Security hardening

**Prerequisite:** Phase 8 (traffic actually flows through Cloudflare).
**Why now:** the origin lock is only safe once Cloudflare is in front of the API.
Enable it earlier and you lock yourself out of your own API.

### 9.1 · 🖱️ MANUAL — origin lock (order matters)

Do these **in this exact order**:

1. [ ] Generate the secret: `openssl rand -hex 32` (must be ≥32 chars or prod
   `check-env` fails).
2. [ ] Cloudflare → **Rules → Transform Rules → Modify Request Header → Create**:
   when `true`, **Set** header `X-CF-Origin-Secret` = *(the hex value)*.
   **Create the rule before setting the env var.**
3. [ ] Set `CF_ORIGIN_SECRET` = same value in Railway `production` variables.
4. [ ] `gh secret set PROD_CF_ORIGIN_SECRET --env production --repo majidifounder/maida`

The `cloudflareOnly` guard now rejects anything that did not arrive via
Cloudflare. Webhook and health routes are exempt by design.

### 9.2 · 🖱️ MANUAL — Turnstile

1. [ ] Cloudflare → **Turnstile → Add widget** (domains: your web hosts, mode
   **Managed**).
2. [ ] **Site Key** (public) → Vercel `maida-web` → `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`,
   **Production scope**.
3. [ ] **Secret Key** → Railway `production` → `CLOUDFLARE_TURNSTILE_SECRET_KEY`.

> Both or neither. One set without the other gives `TURNSTILE_TOKEN_MISSING`.
> Leaving both unset skips the registration bot check.

### 9.3 · 🖱️ MANUAL — WAF and bots

- [ ] **Security → WAF → Rate limiting rules:**
  `/auth/register` POST → 5/IP/hr → Block; `/auth/login` POST → 10/IP/15min → Block.
- [ ] **WAF → Managed rules:** Cloudflare Managed Ruleset + OWASP Core (PL2).
- [ ] **Security → Bots → Bot Fight Mode → On**.
- [ ] **Security → Settings → Security Level: High** for launch.

- [ ] ✅ **VERIFY:** `curl https://<railway-prod-origin-url>/health` → blocked or
  times out. Direct-to-origin must not work.
- [ ] ✅ **VERIFY:** `curl https://api.get-maida.com/health` → 200.

---

# PHASE 10 · Lemon Squeezy production (gated on approval)

**Prerequisite:** merchant approval email. Everything above runs without it.
**Why here:** this is the only step that genuinely waits on a third party, and
it is the last thing production needs.

### 10.1 · 🖱️ MANUAL — swap test for live

1. [ ] Toggle the dashboard **out of Test mode**.
2. [ ] **Settings → API** → create a **live** key.
3. [ ] Confirm the three variants exist in live mode → copy their **live**
   Variant IDs (they differ from the test IDs).
4. [ ] **Settings → Webhooks → Add** (live mode) → URL
   `https://api.get-maida.com/webhooks/lemon-squeezy` → same 8 events → copy the
   **live signing secret**.

### 10.2 · Load the live values

Both places — Railway is what the API reads at runtime; GitHub is what the prod
`check-env` gate reads.

```bash
for s in PROD_LEMON_SQUEEZY_API_KEY PROD_LEMON_SQUEEZY_STORE_ID \
         PROD_LEMON_SQUEEZY_WEBHOOK_SECRET \
         PROD_LS_VARIANT_STARTER PROD_LS_VARIANT_PRO PROD_LS_VARIANT_PREMIUM; do
  gh secret set "$s" --env production --repo majidifounder/maida
done
```

- [ ] Same six values set in Railway `production` variables.
- [ ] ✅ **VERIFY:** `gh secret list --env production --repo majidifounder/maida`
  shows **all 16** production secrets:
  `PROD_DATABASE_URL`, `PROD_DIRECT_DATABASE_URL`, `PROD_REDIS_URL`,
  `PROD_JWT_PRIVATE_KEY`, `PROD_JWT_PUBLIC_KEY`, `PROD_CORS_ORIGIN`,
  `PROD_RESEND_API_KEY`, `PROD_EMAIL_FROM`, `PROD_CF_ORIGIN_SECRET`,
  `PROD_RAILWAY_TOKEN`, `PROD_LEMON_SQUEEZY_API_KEY`,
  `PROD_LEMON_SQUEEZY_STORE_ID`, `PROD_LEMON_SQUEEZY_WEBHOOK_SECRET`,
  `PROD_LS_VARIANT_STARTER`, `PROD_LS_VARIANT_PRO`, `PROD_LS_VARIANT_PREMIUM`.

> Do **not** run `check-env` locally to verify. `scripts/check-env.ts` loads your
> local `.env`, so a local run either fails or forces prod secrets onto your
> machine. The prod workflow runs the same gate with the GitHub secrets — that is
> the real check, and it runs in Phase 11.

---

# PHASE 11 · Production deploy

**Prerequisite:** Phases 0–10 complete.

### 11.1 · Promote

```bash
# CI must be green on staging first
gh pr create --base main --head staging --title "Release: launch"
# merge (squash or rebase — merge commits are disabled; history is linear)
```

- [ ] PR merged into `main`.

### 11.2 · Deploy

1. [ ] Take a backup first: `pnpm db:export`.
2. [ ] Actions → **`Deploy · Production`** → **Run workflow** → type `DEPLOY`.
3. [ ] Approve the required-reviewer gate.

The workflow runs the full CI gate → `check-env` with your prod secrets →
migrates the prod DB → deploys `api` to Railway `production` → deploys web,
dashboard and admin to Vercel Production.

- [ ] ✅ **VERIFY:** the **Pre-deploy environment check** step passes. This is
  your real env validation — it enforces every required var, blocks `localhost`
  in `CORS_ORIGIN`, enforces `pgbouncer=true`, the `CF_ORIGIN_SECRET` length and
  the Upstash eviction policy.
- [ ] ✅ **VERIFY:** `curl https://api.get-maida.com/health/ready` → all `ok`.

### 11.3 · 🖱️ MANUAL — bootstrap the admin user

Register normally at `get-maida.com`, then in Supabase SQL editor (prod):

```sql
UPDATE users SET role='ADMIN', "emailVerifiedAt"=now() WHERE email='you@get-maida.com';
```

- [ ] Log in at `admin.get-maida.com` → scan the TOTP QR → enter the 6-digit code.

---

# PHASE 12 · Launch verification

**Prerequisite:** Phase 11. Run every row on the **real domain** before announcing.

| Check | How | Expected |
|-------|-----|----------|
| API live | `curl https://api.get-maida.com/health` | `status: ok` |
| DB + Redis | `curl …/health/ready` | `database: ok`, `redis: ok` |
| CORS | Load each frontend, open Network tab | No CORS errors |
| Auth | Register (with Turnstile) → verify → login | Session persists; `/auth/me` returns the user |
| Email | Book / cancel | Mail arrives from `@get-maida.com` at a **non-Resend-account** address |
| Booking | Book a slot | 201; shows in *My Reservations* and the owner board |
| Real-time | Owner board open while a diner books | Row appears without refresh |
| Billing | Owner checkout → **real card** → webhook | `/subscriptions/me` shows the plan; log shows `subscription_created` |
| Idempotency | Re-send the webhook | *duplicate — skipping* |
| Plan gate | STARTER owner, 2nd restaurant | 403 `Plan limit reached` |
| Origin lock | `curl https://<railway-origin>/health` | Blocked / times out |
| Admin | Login at `admin.get-maida.com` | Email + password + TOTP → stats load |
| Rate limits | 6 rapid `/auth/register` | 429 after the 5th (edge) / 3rd (server) |
| Logo upload | Upload a logo, redeploy the API | **Still there** — see below |

> **Known gap — logo uploads.** Railway is stateless; local-disk uploads vanish on
> every redeploy. If logos matter at launch, configure Cloudflare **R2** (`R2_ACCOUNT_ID`,
> `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`)
> in Railway `production` before you announce.

- [ ] All rows pass.
- [ ] 🎉 Announce.

---

# PHASE 13 · Steady state

## Day-to-day flow

```
feature/xyz ──PR──▶ staging ──(auto-deploy, smoke-test)──▶ PR ──▶ main ──(manual deploy)──▶ 🚀
```

1. `git switch staging && git switch -c feature/xyz`
2. PR into `staging`. CI check **`Lint · Typecheck · Test · Build`** must pass.
3. Merge → staging auto-deploys → verify on `staging.get-maida.com`.
4. PR `staging → main`. Merge (squash/rebase — linear history).
5. Actions → **Deploy · Production** → type `DEPLOY` → approve.

`main` is protected: no direct pushes, PR + green CI required, admin-enforced.

> Emergency bypass, only if CI itself is broken:
> `gh api -X DELETE repos/majidifounder/maida/branches/main/protection`, push,
> then re-apply. Prefer fixing CI.

## Rollback

| What broke | Rollback |
|------------|----------|
| Bad API release | Railway → service → **Deployments** → last good → **Redeploy** |
| Bad frontend | Vercel → Deployments → **promote** the previous good build |
| Bad DB migration | Restore from `pnpm db:export`. Prisma has no down-migration — ship a forward migration that reverts |
| Leaked secret | Rotate at source → update Railway + GitHub → redeploy. JWT key rotation invalidates all sessions |
| Bad merge on `main` | Revert the PR; history is linear so `git revert` is clean |
| Total outage | `/health/ready` isolates DB vs Redis → check provider status → roll the API back first |

**Before any prod change:** fresh `pnpm db:export`, and note the deployed release
IDs on each host as a known-good rollback target.

---

# Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Railway build: cannot resolve `@restaurant/db` | Deploying with `apps/api` as the build context or Root Directory | Deploy from the repo root; `railway.json` supplies the commands (Phase 0) |
| API crashes at boot: `@prisma/client did not initialize` | `prisma generate` never ran | It belongs in the Railway build command (Phase 0) |
| API exits immediately, no logs | Missing required env var | `env.ts` prints which one. Lemon Squeezy vars are **required** even on staging |
| `prepared statement "s0" already exists` | `DATABASE_URL` on 6543 without `pgbouncer=true` | Append `?pgbouncer=true&connection_limit=10` |
| `P1001: can't reach database` during migrate | Migrating via the pooled URL | Use `DIRECT_DATABASE_URL` (5432) |
| Rate limits / logins behave randomly | Upstash eviction policy `allkeys-lru` | Set **`noeviction`** |
| `Not allowed by CORS` | Origin missing, or a trailing slash | List every origin exactly; no trailing slash, no `localhost` in prod |
| CORS breaks on staging after each deploy | Preview URL changes per deploy | The alias step (Phase 0.2) pins it to `staging.get-maida.com` |
| WebSocket never connects in prod | Cloudflare WebSockets off | **Network → WebSockets → On** |
| Turnstile `TURNSTILE_TOKEN_MISSING` | Site key or secret set, not both | Set both and redeploy both, or unset both |
| Emails only reach your own address | Resend not verified | Phase 8.4 |
| Plan doesn't update after paying | Wrong webhook URL/secret, or missing events | Verify URL + secret; confirm all 8 events; check logs for `subscription_*` |
| Prod API rejects everything after Phase 9 | `CF_ORIGIN_SECRET` set before the Transform Rule, or values differ | They must match exactly; create the rule first |
| Frontend still calls the old API URL | `VITE_*` vars are baked in at build time | Redeploy the frontend after any `VITE_*` change |
| Prod deploy "does nothing" | It is manual-only | Actions → *Deploy · Production* → type `DEPLOY` |
| `Refusing to run tests: TEST_DATABASE is not "true"` | No `.env.test`, or the var is not in `turbo.json` `passThroughEnv` | Guard working as designed (Phase 2.1) |

## Mistakes that cost the most

- Putting a production credential in a local file. Prod creds live **only** in
  Railway `production` + GitHub `production`.
- Running `pnpm test` / `e2e` / `db:seed` / `db:reset` against a production DB.
- Reusing test JWT keys or the test `CF_ORIGIN_SECRET` in production.
- Forgetting to redeploy a frontend after changing a `VITE_*` var.
- Leaving Vercel on Hobby for a commercial product (ToS violation).
- Enabling the origin lock before the Cloudflare Transform Rule exists.

---

## Appendix · Command reference

```bash
# Test-env setup (points the suites at TEST databases only)
cp .env.test.example .env.test
pnpm --filter @restaurant/db db:migrate:deploy

# Local dev
pnpm install
pnpm redis:up
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Database
pnpm --filter @restaurant/db db:migrate:deploy   # uses DIRECT_DATABASE_URL
pnpm db:export                                   # backup → ./backups

# GitHub secrets (values prompted, never in shell history)
gh secret set <NAME> --env staging    --repo majidifounder/maida
gh secret set <NAME> --env production --repo majidifounder/maida
gh secret list        --env production --repo majidifounder/maida

# Branch flow
git switch staging && git switch -c feature/xyz
```

## Dependency map — why the order is what it is

```
Phase 0  repo fixes ─────────────────────────┐
Phase 1  LS test mode ──┐                    │
Phase 2  local gate ────┤                    │
                        ▼                    ▼
Phase 3  Railway staging (needs LS values, railway.json)
                        │
                        ├──▶ staging API URL ──┐
                        └──▶ staging token ────┤
                                               ▼
Phase 4  Vercel (needs the staging API URL for VITE_API_URL)
                        └──▶ token, org ID, 3 project IDs ─┐
                                                           ▼
Phase 5  GitHub secrets (needs Railway token + Vercel IDs + staging URL)
                                                           ▼
Phase 6  staging deploy + E2E  ◀── the proof gate
                                                           ▼
Phase 7  Railway production (only after staging proves the code path)
                        └──▶ prod domain target ─┐
                                                 ▼
Phase 8  Cloudflare DNS (needs Vercel + Railway targets to point at)
                        └──▶ traffic flows through CF ─┐
                                                       ▼
Phase 9  origin lock + Turnstile + WAF (only safe once CF is in front)
                                                       ▼
Phase 10 LS production (gated on merchant approval — nothing else waits on it)
                                                       ▼
Phase 11 production deploy ──▶ Phase 12 verify ──▶ Phase 13 steady state
```
