# Maida — Production Deployment Guide

A complete, start-to-finish guide to deploying the Maida restaurant‑reservation
platform. **No prior knowledge of the stack is assumed.** Follow the parts in
order; each step says exactly what to click, what to run, and where to find
every value.

> **Golden rule:** never commit a real secret. Everything sensitive lives in
> GitHub Actions Secrets and in each host's environment settings — never in the
> repo. `.env` is git‑ignored; only `*.env.example` files are committed.

> **Domain note:** the live domain is **`get-maida.com`** (owned). The brand
> guidelines still list `getmaida.app` as the intended domain — that is a
> documentation lag to reconcile in the brand kit. This guide uses the domain
> you actually control: **`get-maida.com`**.

---

## Where you are right now (status)

Already done — you do **not** need to redo these:

- [x] **GitHub repo hardened** (§A6): `main` branch protection (PR + green CI +
  linear history + admin enforcement), `staging` + `production` environments,
  required reviewer on `production`, secret scanning + push protection +
  Dependabot all on. Repo renamed to **`maida`**, description/topics/homepage set.
- [x] **Branch model** `main` (production) + `staging` (pre‑prod) wired into CI
  and the deploy workflows.
- [x] **CI is green** — the workflows had non‑existent action SHAs, a broken
  `pnpm audit` gate, and a Turbo strict‑mode env‑passthrough gap; all fixed.
- [x] **Supabase** provisioned — a **test** project and a **prod** project.
- [x] **Upstash Redis** provisioned — a **test** database and a **prod** database.
- [x] **Resend** API key created (test + prod).
- [x] **RS256 JWT keys** generated (a test pair and a prod pair).

Still to do (this guide walks each one):

- [ ] Put the credentials you generated into **GitHub Secrets** + **Railway
  Variables** (§A6.2, §B1) — they must never live in a local file.
- [ ] **Lemon Squeezy** billing store, variants, webhook (§A4).
- [ ] Deploy the **API → Railway** (staging + prod services) (§B1).
- [ ] Deploy the **frontends → Vercel** (staging + prod) (§B2).
- [ ] Point **`get-maida.com`** at everything via Cloudflare (§C).
- [ ] Verify domain in Resend, flip `EMAIL_FROM` to `@get-maida.com` (§C6).
- [ ] Production go‑live (§D).

---

## 0 · What you are deploying

Maida is a pnpm + Turborepo monorepo with **one backend and three frontends**:

| App | Path | What it is | Runtime |
|-----|------|------------|---------|
| **API** | `apps/api` | Fastify server: REST, auth (RS256 JWT), booking engine, **WebSocket** live feed (`/ws`), and an in‑process **background worker** (emails, maintenance) | Long‑running Node process |
| **Web** | `apps/web` | Diner site — browse, book, manage reservations | Static SPA (Vite/React) |
| **Dashboard** | `apps/dashboard` | Restaurant‑owner dashboard — service board, tables, billing | Static SPA |
| **Admin** | `apps/admin` | Internal admin panel (TOTP‑protected) | Static SPA |

Shared packages: `packages/db` (Prisma schema + client), `packages/api-client`,
`packages/types`, `packages/ui`.

**Backing services the API needs:** PostgreSQL (Supabase), Redis (Upstash),
transactional email (Resend), billing (Lemon Squeezy). Cloudflare sits in front
of everything for DNS, TLS, CDN, WAF, bot protection and Turnstile.

```
                     ┌──────────── Cloudflare (DNS · TLS · CDN · WAF · Turnstile) ────────────┐
 diner  ─▶ get-maida.com            ─▶ Web SPA        (Vercel)                                 │
 owner  ─▶ dashboard.get-maida.com  ─▶ Dashboard SPA  (Vercel)                                 │
 admin  ─▶ admin.get-maida.com      ─▶ Admin SPA      (Vercel)                                 │
 all    ─▶ api.get-maida.com        ─▶ API + /ws + worker (Railway) ─┬─ Postgres  (Supabase)   │
                                                                     ├─ Redis     (Upstash)    │
                                                                     ├─ Email     (Resend)     │
                                                                     └─ Billing   (Lemon Sqzy) │
                     └────────────────────────────────────────────────────────────────────────┘
```

**Why the API cannot be “serverless / free”:** it holds long‑lived WebSocket
connections and runs a persistent BullMQ worker + Redis pub/sub subscriber. That
requires an always‑on process — serverless functions and free tiers that sleep
after inactivity will drop WebSockets and stall the worker. This is the one place
a small paid host is justified (Railway, §B1).

---

## 1 · Cost summary — read this first

| Service | Purpose | Plan | Recurring cost |
|---------|---------|------|----------------|
| **Domain** `get-maida.com` | already owned | your registrar | ~$10–12/yr |
| Cloudflare | DNS, TLS, CDN, WAF, Bot Fight, Turnstile | **Free** | $0 |
| Supabase | PostgreSQL (test + prod) | **Free** (2 projects) | $0 |
| Upstash | Redis (test + prod) | **Free** | $0 |
| Resend | Transactional email | **Free** (3 000/mo) | $0 |
| Lemon Squeezy | Owner subscriptions | Pay‑as‑you‑sell (~5% + fees) | $0 fixed |
| **Vercel** | Web + Dashboard + Admin hosting | see note ↓ | $0–20/mo |
| **Railway** | API + WebSocket + worker | Hobby **$5/mo** ($5 usage incl.) | ~$5/mo |
| GitHub | Repo + Actions CI/CD | **Free** | $0 |

**Vercel + commercial use.** You chose Vercel for the frontends. Vercel's free
**Hobby** tier is **non‑commercial per its Terms** — a paid SaaS should be on
**Vercel Pro ($20/mo)**. You can launch on Hobby to validate, but budget Pro
before you take real paying customers. (If you ever want $0 frontends,
Cloudflare Pages is free and commercial‑OK — but this guide follows your Vercel
choice.)

**Bottom line at launch:** domain (~$1/mo amortised) + Railway (~$5/mo) +
Vercel (Hobby $0 now / Pro $20 later). Everything else is free tier.

---

## 2 · Test vs Production — the golden separation

You run **two of everything**: a **TEST** stack you can freely break, and a
**PRODUCTION** stack you never touch by hand. This is what guarantees a test run
can never create or delete rows in real customer data.

| | TEST / staging stack | PRODUCTION stack |
|--|--|--|
| Supabase project | `maida-test` | `maida-prod` |
| Upstash database | `maida-test` | `maida-prod` |
| Used by | `pnpm dev`, `pnpm test`, `pnpm e2e`, the **staging** deploy | Only the deployed **prod** Railway API + real users |
| Credentials live in | local `.env` / `.env.test` **and** the `staging` GitHub environment | **Railway (api‑prod) Variables + the `production` GitHub environment ONLY** — never in a file on your machine |
| Safe to wipe? | Yes — disposable | **Never** |

### The one rule that makes this foolproof
**Production credentials never live in a file on your computer.** They exist only
in Railway's `api-prod` *Variables* and in the GitHub `production` environment.
Your local `.env` / `.env.test` point *only* at the TEST stack. If prod creds
aren't on your machine, no local command can reach production — full stop.

Since you kept your six test + six prod values in a **note**, transcribe them:
- **TEST** values → local `.env.test` (for `pnpm test`) **and** the GitHub
  `staging` environment secrets (§A6.2).
- **PROD** values → the GitHub `production` environment secrets **and** Railway
  `api-prod` Variables (§B1). **Do not** put prod values in any local file, then
  you can delete that note once they're in both places.

### The wall is enforced in code
- `pnpm test` / `pnpm e2e` load **`.env.test`** and refuse to start unless it
  sets **`TEST_DATABASE=true`** (`apps/api/vitest.config.ts`,
  `scripts/e2e/preload-env.ts`).
- Production (Railway `api-prod`) never sets `TEST_DATABASE`, so even if prod
  credentials were somehow loaded, the destructive suites abort.
- CI spins up a throwaway Postgres + Redis each run and sets the gate itself — it
  never sees your real databases. (CI passes these vars through Turbo's strict
  env mode via `turbo.json`'s `passThroughEnv`.)

### Never point these at production
`pnpm test` · `pnpm e2e` · `pnpm db:seed` · `pnpm db:reset` · `pnpm db:dev-reset`.
The only DB commands you ever run against production are `db:migrate:deploy`
(schema) and `db:export` (backup).

---

## 3 · Git branch & deploy model

Two long‑lived branches, each bound to one environment:

| Branch | Environment | How it deploys | Backing stack |
|--------|-------------|----------------|---------------|
| **`staging`** | `staging` | **Auto** — every push runs CI then deploys (`deploy-staging.yml`) | `maida-test` Supabase + Upstash |
| **`main`** | `production` | **Manual** — Actions → *Deploy · Production* → type `DEPLOY` → reviewer approves (`deploy-prod.yml`) | `maida-prod` Supabase + Upstash |

**Day‑to‑day flow (professional GitFlow‑lite):**

```
feature/xyz  ──PR──▶  staging  ──(auto‑deploys to staging, you smoke‑test)──▶  PR ──▶  main  ──(manual prod deploy)──▶ 🚀
```

1. Branch off `staging`: `git switch staging && git switch -c feature/xyz`.
2. Open a PR into `staging`. CI (`Lint · Typecheck · Test · Build`) must pass.
3. Merge → `staging` auto‑deploys; verify on the staging URLs.
4. When happy, open a PR `staging → main`. CI must pass; merge (squash or rebase —
   merge commits are disabled for a linear history).
5. Trigger **Deploy · Production** manually and approve the reviewer gate.

`main` is protected: no direct pushes, PR required, CI required, admin‑enforced.
Do all work on `staging` or feature branches.

---

## 4 · Environment variable reference

The API validates its environment on boot (`apps/api/src/env.ts`) and
`pnpm check-env` (`scripts/check-env.ts`) enforces the production rules. Populate
every **Required** var.

### API (`apps/api`) — set in Railway + the GitHub environment secrets

| Variable | Required | Where to obtain it |
|----------|----------|--------------------|
| `DATABASE_URL` | ✅ | Supabase → Project → **Connect** → **Transaction** pooler (port **6543**). Append `?pgbouncer=true&connection_limit=10`. *(You have this for test + prod.)* |
| `DIRECT_DATABASE_URL` | ✅ | Same page → **Session** pooler (port **5432**). Migrations only. *(You have this for test + prod.)* |
| `REDIS_URL` | ✅ | Upstash → your database → **`rediss://…`** URL. *(You have this for test + prod.)* |
| `JWT_PRIVATE_KEY` | ✅ | Generated locally (§A5). RS256 PKCS#8 PEM. Secret. *(Generated.)* |
| `JWT_PUBLIC_KEY` | ✅ | Generated alongside the private key. *(Generated.)* |
| `CORS_ORIGIN` | ✅ | Comma‑separated frontend origins, no trailing slash. Must **not** contain `localhost` in prod. Prod value in §C7. |
| `RESEND_API_KEY` | ✅ | Resend → **API Keys**. Secret (`re_…`). *(You have this.)* |
| `EMAIL_FROM` | ✅ | Until the domain is verified: `onboarding@resend.dev`. Prod: `noreply@get-maida.com` (after §C6). |
| `LEMON_SQUEEZY_API_KEY` | ✅ | Lemon Squeezy → **Settings → API**. Secret. |
| `LEMON_SQUEEZY_STORE_ID` | ✅ | Lemon Squeezy → **Settings → Stores** → numeric Store ID. |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | ✅ | Lemon Squeezy → **Settings → Webhooks** → signing secret (§A4.3). Secret. |
| `LS_VARIANT_STARTER` / `_PRO` / `_PREMIUM` | ✅ | Each variant's numeric Variant ID (§A4.2). |
| `NODE_ENV` | ✅ | `production` on Railway. |
| `CF_ORIGIN_SECRET` | Prod ✅ | `openssl rand -hex 32`. **≥32 chars**, must match the Cloudflare Transform Rule (§C4). Secret. |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Optional | Cloudflare → **Turnstile** → widget → **Secret Key**. Unset = registration bot check skipped. |
| `WEB_URL` | Default | Diner app URL (reset/verify emails). Prod: `https://get-maida.com`. |
| `DASHBOARD_URL` | Default | Owner app URL. Prod: `https://dashboard.get-maida.com`. |
| `BCRYPT_ROUNDS` | Default 12 | Leave at 12 in prod. |
| `PORT` | Default 3001 | Railway sets this; leave default otherwise. |
| `QUEUE_NAME` | Default | `booking_events`. Leave as‑is. |
| `RUN_WORKER_IN_PROCESS` | Default `true` | Keep `true` — one service (worker inside the API). |
| `AUDIT_LOG_RETENTION_DAYS` | Default 365 | Min 30. |
| `ALERT_WEBHOOK_URL` | Optional | Slack‑compatible incoming webhook for critical alerts. |
| `R2_*` (account/key/secret/bucket/public‑url) | Optional | Cloudflare R2 for logo uploads. Unset = local disk (fine for dev; set R2 for prod since Railway is stateless). |

### Frontends — build‑time vars in Vercel

| Variable | Apps | Where to set |
|----------|------|--------------|
| `VITE_API_URL` | web, dashboard, admin | The API's public URL, e.g. `https://api.get-maida.com` (prod) / your staging Railway URL. Leave **blank in local dev** (the Vite proxy forwards `/api` → `localhost:3001`). |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | web only | Cloudflare → **Turnstile** → widget → **Site Key** (public). Dev test key `1x00000000000000000000AA` always passes. |

### Deploy credentials (GitHub Secrets — for the workflows)

| Secret | Where to obtain |
|--------|-----------------|
| `PROD_RAILWAY_TOKEN` / `STAGING_RAILWAY_TOKEN` | Railway → **Account Settings → Tokens** (or a project token). |
| `VERCEL_TOKEN` | Vercel → **Settings → Tokens**. |
| `VERCEL_ORG_ID` | `vercel whoami --json`, or `.vercel/project.json` after first `vercel link`. |
| `VERCEL_PROJECT_ID_WEB_PROD` / `_WEB_STAGING` / `_DASHBOARD_PROD` / `_DASHBOARD_STAGING` | Vercel → each Project → **Settings → General → Project ID**. |

The full per‑environment secret list is in **§A6.2**.

---

# PART A · Provision backing services

Everything here works on free platform URLs. Most of Part A is **already done**
(status box at top) — the remaining work is Lemon Squeezy (§A4) and loading your
credentials into GitHub/Railway (§A6.2, §B1).

## A1 · Supabase — PostgreSQL  ✅ (done: test + prod projects exist)

For reference / if you re‑provision:
1. **New project** (region close to your users). Save the DB password.
2. **Connect** → copy two connection strings per project:
   - **Transaction pooler** (port **6543**) → `DATABASE_URL`. **Append**
     `?pgbouncer=true&connection_limit=10` (Prisma prepared statements break on
     the transaction pooler without it — `check-env` blocks the deploy if you
     forget).
   - **Session pooler** (port **5432**) → `DIRECT_DATABASE_URL` (migrations).
3. URL‑encode the password if it contains `@ : / ? # [ ] ! $ * &` (`@`→`%40`).
4. Apply the schema to **each** DB (run once per project, before its first deploy):
   ```bash
   DATABASE_URL="<direct-url>" DIRECT_DATABASE_URL="<direct-url>" \
     pnpm --filter @restaurant/db db:migrate:deploy
   ```
5. **Never** run `pnpm db:seed` against prod (it inserts demo data).
6. Free tier has **no automated backups** — use `pnpm db:export` (uses
   `DIRECT_DATABASE_URL`) or budget Supabase Pro ($25/mo) once you have customers.

## A2 · Upstash — Redis  ✅ (done: test + prod databases exist)

1. Type **Regional**, same region as Railway.
2. Copy the **`rediss://…`** URL → `REDIS_URL`.
3. **Eviction policy → `noeviction`** (console → your DB → *Configuration*). The
   default `allkeys-lru` silently evicts rate‑limit counters and the JWT
   deny‑list — `check-env` fails prod if it is not `noeviction`. **Verify this on
   your prod database now.**

## A3 · Resend — email  ✅ (done: API key exists; domain verify later in §C6)

Until `get-maida.com` is verified in Resend, keep `EMAIL_FROM=onboarding@resend.dev`
(sandbox mode only delivers to your own account email — expected). Real sending
to any address requires §C6.

## A4 · Lemon Squeezy — owner billing  ⬅ still to do

The platform bills **restaurant owners** (STARTER / PRO / PREMIUM). Diners and
admins are never charged. Lemon Squeezy is a Merchant of Record (handles VAT).

### A4.1 · Store & API key
1. [ ] Activate a store (business/payout details as LS requires).
2. [ ] **Settings → Stores** → **Store ID** → `LEMON_SQUEEZY_STORE_ID`.
3. [ ] **Settings → API** → create a key → `LEMON_SQUEEZY_API_KEY`.

### A4.2 · Three subscription variants
One subscription product, three variants matching `apps/api/src/lib/plan.ts`:

| Plan | Restaurants | Bookings/mo | Env var |
|------|-------------|-------------|---------|
| STARTER | 1 | 200 | `LS_VARIANT_STARTER` |
| PRO | 5 | 1 000 | `LS_VARIANT_PRO` |
| PREMIUM | Unlimited | Unlimited | `LS_VARIANT_PREMIUM` |

- [ ] For each: **open the variant → copy its numeric Variant ID** → set the var.

### A4.3 · Webhook
The API exposes **`POST /webhooks/lemon-squeezy`** (no JWT — HMAC‑SHA256 verified,
registered before the Cloudflare origin guard so LS reaches it).

1. [ ] **Settings → Webhooks → Add** → URL
   `https://api.get-maida.com/webhooks/lemon-squeezy`
   (local testing: `ngrok http 3001`; staging: your staging API URL).
2. [ ] Copy the **signing secret** → `LEMON_SQUEEZY_WEBHOOK_SECRET`.
3. [ ] Enable exactly these events (all consumed by `webhook.routes.ts`):
   `subscription_created`, `subscription_updated`, `subscription_cancelled`,
   `subscription_resumed`, `subscription_expired`, `subscription_payment_success`,
   `subscription_payment_failed`, `subscription_payment_recovered`.

## A5 · RS256 JWT keys  ✅ (done: test + prod pairs generated)

Never reuse dev keys in prod (you generated separate pairs — good). To regenerate:
```bash
node -e "const{generateKeyPairSync}=require('crypto');const{privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});console.log(privateKey);console.log(publicKey);"
```
Multi‑line PEMs stored in GitHub Secrets / Railway keep their real newlines; the
app also normalises literal `\n` on boot. **Store from a file** to preserve
newlines: `gh secret set PROD_JWT_PRIVATE_KEY --env production < prod-private.pem`.

## A6 · GitHub — repo settings, environments & secrets

### A6.1 · Branch protection & environments  ✅ (done)
Already configured:
- [x] `main` protected — PR required, required check **`Lint · Typecheck · Test ·
  Build`** (the CI job's real name — there are **no** separate `lint`/`test`
  checks), strict/up‑to‑date, linear history, conversation resolution,
  force‑push & deletion blocked, **admin enforcement on**.
- [x] Environments **`staging`** and **`production`** exist.
- [x] **`production`** requires **one reviewer** (you) and only **protected
  branches** (i.e. `main`) may deploy to it. `prevent_self_review` is off so you
  can approve your own prod deploys.

> Emergency bypass (only if CI is broken and you must ship): temporarily remove
> protection with `gh api -X DELETE repos/majidifounder/maida/branches/main/protection`,
> push, then re‑apply it. Prefer fixing CI.

### A6.2 · Secrets & variables (Settings → Secrets and variables → Actions)
These names are exactly what the deploy workflows read. Set them with the `gh`
CLI (values never touch your shell history in the prompt form). **Now is when you
move your note's values into GitHub.**

**Repository‑level (shared by both environments):**
```bash
for s in VERCEL_TOKEN VERCEL_ORG_ID \
         VERCEL_PROJECT_ID_WEB_STAGING VERCEL_PROJECT_ID_DASHBOARD_STAGING \
         VERCEL_PROJECT_ID_WEB_PROD    VERCEL_PROJECT_ID_DASHBOARD_PROD; do
  gh secret set "$s" --repo majidifounder/maida
done
```

**`staging` environment (uses your TEST Supabase/Upstash):**
```bash
for s in STAGING_RAILWAY_TOKEN STAGING_DATABASE_URL STAGING_DIRECT_DATABASE_URL; do
  gh secret set "$s" --env staging --repo majidifounder/maida
done
gh variable set STAGING_URL --env staging --repo majidifounder/maida \
  --body "https://api-staging-XXXX.up.railway.app"   # fill after B1
```

**`production` environment (uses your PROD Supabase/Upstash):**
```bash
for s in PROD_RAILWAY_TOKEN PROD_DATABASE_URL PROD_DIRECT_DATABASE_URL PROD_REDIS_URL \
         PROD_CORS_ORIGIN PROD_EMAIL_FROM PROD_RESEND_API_KEY \
         PROD_LEMON_SQUEEZY_API_KEY PROD_LEMON_SQUEEZY_STORE_ID PROD_LEMON_SQUEEZY_WEBHOOK_SECRET \
         PROD_LS_VARIANT_STARTER PROD_LS_VARIANT_PRO PROD_LS_VARIANT_PREMIUM PROD_CF_ORIGIN_SECRET; do
  gh secret set "$s" --env production --repo majidifounder/maida
done
# JWT PEMs must come from a file to keep their newlines:
gh secret set PROD_JWT_PRIVATE_KEY --env production --repo majidifounder/maida < prod-private.pem
gh secret set PROD_JWT_PUBLIC_KEY  --env production --repo majidifounder/maida < prod-public.pem
gh variable set PRODUCTION_URL --env production --repo majidifounder/maida \
  --body "https://api.get-maida.com"
```

Notes:
- `PROD_CF_ORIGIN_SECRET` must be **≥32 chars** or prod `check-env` fails
  (`openssl rand -hex 32`).
- The staging deploy only *reads* `STAGING_RAILWAY_TOKEN` + the two staging DB
  URLs + Vercel repo secrets. The API's own runtime env (JWT, Redis, Resend,
  Lemon Squeezy…) for **staging** lives in **Railway `api-staging` Variables**,
  not GitHub. For **prod**, the same runtime env lives in Railway `api-prod`
  Variables **and** the `production` secrets above (the prod workflow's
  `check-env` gate reads them).
- Verify at any time: `gh secret list --env production --repo majidifounder/maida`.

## A7 · Local verification before any deploy

```bash
pnpm install
pnpm lint          # 0 errors
pnpm typecheck     # 0 errors
pnpm test          # full suite green (needs .env.test → TEST stack)
pnpm build         # all apps build
```

`pnpm test` / `pnpm e2e` load **`.env.test`** and refuse to run without
`TEST_DATABASE=true` (§2). First‑time: `cp .env.test.example .env.test`, fill in
your **TEST** Supabase + Upstash creds (or a local Postgres + `pnpm redis:up`),
then `pnpm --filter @restaurant/db db:migrate:deploy` against the test DB. CI
needs none of this — it spins up its own ephemeral Postgres + Redis.

- [ ] `.env.test` exists, points at TEST databases only, `pnpm test` green.
- [ ] No production URL appears in `.env`, `.env.test`, or any local file.

---

# PART B · Deploy (staging first, then production)

## B1 · API → Railway

Railway runs the always‑on API + WebSocket + worker and matches the bundled
`deploy-*.yml` workflows. Create **one project** with **two services**:
`api-staging` and `api-prod` — the workflows deploy by these exact names via
`railway up --service <name>`.

### B1.1 · Create the project & services
1. [ ] Railway → **New Project → Deploy from GitHub repo** → select `maida`.
2. [ ] For the service, set **Root Directory = `apps/api`**. Build/start come from
   the app's `package.json` (`pnpm build` → `node dist/index.js`).
3. [ ] Rename this service **`api-staging`**. Then **+ New → Empty/GitHub service**
   in the same project, same root dir, and name it **`api-prod`**.

### B1.2 · Set each service's Variables (this is where creds live)
Railway → service → **Variables**. Add every API var from §4.

- **`api-staging`** → your **TEST** Supabase/Upstash values (from your note),
  `NODE_ENV=production`, `RUN_WORKER_IN_PROCESS=true`. **Do not** set
  `TEST_DATABASE` here.
- **`api-prod`** → your **PROD** Supabase/Upstash values, prod JWT pair, prod
  Resend/Lemon Squeezy/CF_ORIGIN_SECRET, `NODE_ENV=production`,
  `RUN_WORKER_IN_PROCESS=true`.

> Keep the worker in‑process (`RUN_WORKER_IN_PROCESS=true`) so you run **one**
> service, not two. Split it out only when email volume demands it.

### B1.3 · Tokens & first deploy
4. [ ] Railway → **Account Settings → Tokens** → create a token → GitHub Secret
   `STAGING_RAILWAY_TOKEN` (and a second for `PROD_RAILWAY_TOKEN`).
5. [ ] Grab each service's public URL (Railway → service → **Settings → Networking
   → Generate Domain**). Put the staging one in `STAGING_URL`, and `api.get-maida.com`
   goes to `api-prod` later (§C).
6. [ ] Migrate each DB once before its first real deploy (§A1 step 4) — the API
   image never migrates at boot; the workflows run `db:migrate:deploy` for you on
   each deploy, but the very first schema apply is safest done by hand.

## B2 · Frontends → Vercel

The workflows deploy **web** and **dashboard** to Vercel. **admin** is not in the
workflows — deploy it as a fourth (manual) project or add a step.

Build settings per app:

| Setting | web | dashboard | admin |
|---------|-----|-----------|-------|
| Root directory | `apps/web` | `apps/dashboard` | `apps/admin` |
| Build command | `pnpm install && pnpm --filter @restaurant/web build` | `…dashboard build` | `…admin build` |
| Output dir | `apps/web/dist` | `apps/dashboard/dist` | `apps/admin/dist` |

### B2.1 · Create the projects
The workflows use **separate Project IDs for staging vs prod**. You have two
options:

- **Simple (recommended): one Vercel project per app**, and set *both* the
  `_STAGING` and `_PROD` secrets to the **same** Project ID. Staging deploys as a
  Vercel **Preview**, prod as **Production** — the workflow already passes
  `--environment=preview` for staging and `--prod` for production. → 2 projects
  (web, dashboard) + admin.
- **Isolated: four projects** (`web-staging`, `web-prod`, `dashboard-staging`,
  `dashboard-prod`) if you want fully separate staging/prod frontends.

1. [ ] Create the project(s) → **Import Git Repository** → `maida`.
2. [ ] Each: set Root Directory + Build command + Output dir from the table.
3. [ ] Add env var **`VITE_API_URL`** (and `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`
   for **web** only). Vite bakes these in at **build time** → redeploy after any
   change.
4. [ ] Capture the deploy secrets into GitHub (§A6.2):
   ```bash
   vercel login
   vercel whoami --json            # → VERCEL_ORG_ID
   # In each project: Settings → General → Project ID → the matching secret
   ```

> **Admin app** is not automated: host it as a fourth Vercel project (or a
> Cloudflare Pages project) and add its URL to `CORS_ORIGIN`.

## B3 · Deploy

- **Staging (automatic):** push to **`staging`** → `deploy-staging.yml` runs the
  full CI gate (lint, typecheck, test on ephemeral Postgres+Redis), builds,
  migrates the staging DB, then deploys API→Railway (`api-staging`) and
  web+dashboard→Vercel (preview).
- **Production (manual):** Actions → **`Deploy · Production`** → **Run workflow** →
  type `DEPLOY` → approve the required‑reviewer gate → it runs the gate +
  `check-env`, migrates the prod DB, deploys `api-prod` + prod frontends.

> A push to `staging` before the secrets exist will pass the CI/build portion and
> **fail at the Railway/Vercel deploy steps** (no token) — that is expected. Set
> the secrets (§A6.2), then push again.

## B4 · Verify a deploy

```bash
curl https://<api-url>/health          # {"status":"ok","environment":"production"}
curl https://<api-url>/health/ready    # {"status":"ok","checks":{"database":"ok","redis":"ok"}}
```

- [ ] `/health` → 200; `/health/ready` → `database: ok`, `redis: ok`.
- [ ] Set `VITE_API_URL` on the frontends to the API URL and redeploy them.
- [ ] Register → verify email → login → create restaurant → add table → book →
  confirmation shows; owner dashboard **updates live** (WebSocket); cancel → the
  row/table state updates.
- [ ] `GET /` → 404 (expected: the API has no homepage).

---

# PART C · Custom domain (get-maida.com) + Cloudflare hardening

| Host | Points to |
|------|-----------|
| `get-maida.com` / `www` | Web SPA (Vercel) |
| `dashboard.get-maida.com` | Dashboard SPA (Vercel) |
| `admin.get-maida.com` | Admin SPA (Vercel) |
| `api.get-maida.com` | API (`api-prod` on Railway) |

## C1 · Add get-maida.com to Cloudflare
1. [ ] `dash.cloudflare.com` → **Add a site** → `get-maida.com` → **Free** plan →
   switch your registrar's nameservers to Cloudflare's. Wait for **Active**.

## C2 · DNS records
Add a CNAME per host pointing at each host's target (Vercel/Railway give you a
custom‑domain target):

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `@` / `www` | Vercel web target | **Proxied** 🟠 |
| CNAME | `dashboard` | Vercel dashboard target | **Proxied** 🟠 |
| CNAME | `admin` | Vercel admin target | **Proxied** 🟠 |
| CNAME | `api` | Railway `api-prod` target | **Proxied** 🟠 |

- [ ] Also add each custom domain **inside the host** (Vercel → project → Domains;
  Railway → service → Settings → Domains) so it issues the certificate.
- [ ] `dig api.get-maida.com` returns Cloudflare IPs (104.x / 172.x), not origin.

## C3 · TLS + WebSockets
- [ ] **SSL/TLS → Overview → Full (strict)**.
- [ ] **Edge Certificates →** Always Use HTTPS **on**, Min TLS **1.2**.
- [ ] **Network → WebSockets → On** (required for the `/ws` live feed).

## C4 · Origin secret (block direct‑to‑origin)
1. [ ] `openssl rand -hex 32` → `CF_ORIGIN_SECRET` in Railway `api-prod` **and**
   the `production` secret `PROD_CF_ORIGIN_SECRET`.
2. [ ] **Rules → Transform Rules → Modify Request Header → Create**: when `true`,
   **Set** header `X-CF-Origin-Secret` = *(same hex)*.
3. [ ] Redeploy `api-prod`. The `cloudflareOnly` guard now rejects any request
   that didn't come through Cloudflare (webhook + health routes are exempt).

## C5 · Turnstile, WAF, bots
1. [ ] **Turnstile → Add widget** (domains: your web hosts, mode Managed). Site
   Key → `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` (web → redeploy); Secret Key →
   `CLOUDFLARE_TURNSTILE_SECRET_KEY` (API → redeploy).
2. [ ] **Security → WAF → Rate limiting rules:** `/auth/register` POST 5/IP/hr →
   Block; `/auth/login` POST 10/IP/15min → Block.
3. [ ] **WAF → Managed rules →** Cloudflare Managed Ruleset + OWASP Core (PL2).
4. [ ] **Security → Bots → Bot Fight Mode → On**.
5. [ ] **Security → Settings → Security Level: High** for launch.

## C6 · Resend — verify get-maida.com
1. [ ] Resend → **Domains → Add domain** → `get-maida.com`.
2. [ ] Add the SPF / DKIM / DMARC records into **Cloudflare DNS** (mail records =
   **DNS only / grey cloud**).
3. [ ] After it verifies: `EMAIL_FROM=noreply@get-maida.com` in Railway `api-prod`
   + the `PROD_EMAIL_FROM` secret → redeploy.

## C7 · Point everything at get-maida.com
- [ ] `CORS_ORIGIN` = `https://get-maida.com,https://www.get-maida.com,https://dashboard.get-maida.com,https://admin.get-maida.com` — no localhost, no trailing slashes. (Railway `api-prod` + `PROD_CORS_ORIGIN`.)
- [ ] `WEB_URL=https://get-maida.com`, `DASHBOARD_URL=https://dashboard.get-maida.com`.
- [ ] `VITE_API_URL=https://api.get-maida.com` on all three frontends → redeploy.
- [ ] Update the Lemon Squeezy webhook URL to `https://api.get-maida.com/webhooks/lemon-squeezy`.
- [ ] Run the pre‑deploy gate:
   ```bash
   NODE_ENV=production pnpm check-env
   ```
  It verifies every required var, blocks `localhost` in `CORS_ORIGIN`, enforces
  `pgbouncer=true`, the `CF_ORIGIN_SECRET` length, and the Upstash eviction policy.

---

# PART D · Production go‑live

- [ ] All of Part A, B, C complete; `pnpm check-env` passes with prod values.
- [ ] Run **`Deploy · Production`** (type `DEPLOY`, approve the reviewer gate).
- [ ] `curl https://api.get-maida.com/health/ready` → all `ok`.
- [ ] Full end‑to‑end on the real domain (register with Turnstile → book → email
  arrives → live dashboard update → cancel → owner subscribes via Lemon Squeezy →
  webhook upgrades the plan in `/subscriptions/me`).
- [ ] STARTER owner is blocked from a 2nd restaurant until upgraded (plan gate).
- [ ] Announce. 🎉

---

# PART E · Post‑deploy verification

| Check | How | Expected |
|-------|-----|----------|
| API live | `curl …/health` | `status: ok` |
| DB + Redis | `curl …/health/ready` | `checks: {database: ok, redis: ok}` |
| CORS | Load a frontend, open Network tab | No CORS errors; requests hit `api.get-maida.com` |
| Auth | Register → verify → login | Session persists; `/auth/me` returns the user |
| Booking | Book a slot | 201; appears in *My Reservations* and the owner board |
| Real‑time | Owner board open while a diner books | Row appears without refresh (WebSocket) |
| Email | Book / cancel | Diner + owner receive mail (verified domain) |
| Billing | Owner checkout → pay → webhook | `/subscriptions/me` shows the new plan; log shows `subscription_created`; re‑send → *duplicate — skipping* (idempotent) |
| Plan gate | STARTER owner, 2nd restaurant | 403 `Plan limit reached` |
| Origin lock | `curl https://<railway-origin>/health` | Blocked / times out (Cloudflare‑only) |
| Admin | Login at `admin.get-maida.com` | Email + password + TOTP → stats load |
| Rate limits | 6 rapid `/auth/register` | 429 after the 5th (edge) / 3rd (server) |

---

# PART F · Troubleshooting & common mistakes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Refusing to run tests: TEST_DATABASE is not "true"` | No `.env.test`, or (in CI) an env var not passed through Turbo strict mode | Locally: `cp .env.test.example .env.test`, fill **TEST** creds. In CI: the var must be in `turbo.json` `test.passThroughEnv` **and** set in the workflow step. Guard working as designed (§2). |
| CI red at **Set up job / Prepare actions** | An action pinned to a non‑existent SHA | Pin to a real commit SHA for the version (this repo's original SHAs were fabricated — fixed). |
| CI red at **Audit dependencies** with `410` | npm retired the legacy `pnpm audit` endpoint | Non‑blocking now (warning only); Dependabot is the advisory gate. |
| API won't boot, exits immediately | Missing required env var | Host logs — `env.ts` prints which var failed. Run `pnpm check-env`. |
| `prepared statement "s0" already exists` | `DATABASE_URL` on port 6543 without `pgbouncer=true` | Append `?pgbouncer=true&connection_limit=10`. |
| `P1001: can't reach database` during migrate | Migrating via the pooled URL | Use `DIRECT_DATABASE_URL` (session pooler, 5432). |
| Rate limits / logins behave randomly | Upstash eviction policy `allkeys-lru` | Set **`noeviction`**. |
| `Not allowed by CORS` | Origin missing from `CORS_ORIGIN`, or a trailing slash | List every origin exactly, no trailing slash, no `localhost` in prod. |
| Refresh logs you out | Refresh cookie needs HTTPS + real domains | Fine in prod over HTTPS. |
| WebSocket never connects in prod | Cloudflare WebSockets off, or the Railway service asleep | Enable **Network → WebSockets**; Railway stays on. |
| Turnstile missing / `TURNSTILE_TOKEN_MISSING` | Web missing site key or API missing secret | Set both, redeploy both. Leave both unset to disable. |
| Emails never arrive | Domain not verified in Resend | Complete §C6; set `EMAIL_FROM` to `@get-maida.com`. |
| Plan doesn't update after paying | Webhook URL/secret wrong, or events not subscribed | Verify LS webhook URL + secret; confirm all 8 events; check logs for `subscription_*`. |
| Direct origin IP reachable | `CF_ORIGIN_SECRET` / Transform Rule mismatch | Header value and env var must match exactly; redeploy API. |
| Logos vanish after redeploy | Local‑disk storage on stateless Railway | Configure Cloudflare **R2** (`R2_*`) for prod. |
| Prod deploy "does nothing" | It's manual‑only | Actions → *Deploy · Production* → Run → type `DEPLOY`. |

**Common mistakes to avoid**
- **Putting a production URL/secret in a local file** (`.env`, `.env.test`). Prod
  creds live only in Railway `api-prod` + GitHub `production` secrets (§2).
- Running `pnpm test` / `e2e` / `db:seed` / `db:reset` against a production DB.
- Reusing dev JWT keys or the dev `CF_ORIGIN_SECRET` in prod.
- Forgetting to redeploy a **frontend** after changing a `VITE_*` var.
- Pushing directly to `main` (it's protected — work on `staging`/feature branches).
- Leaving Vercel on free Hobby for a commercial product (ToS) — Vercel Pro.

---

# PART G · Rollback procedures

| What broke | Rollback |
|------------|----------|
| **Bad API release** (Railway) | Railway → service → **Deployments** → last good → **Redeploy/Rollback**. |
| **Bad frontend** (Vercel) | Vercel → Deployments → **promote** the previous good build to Production. |
| **Bad DB migration** | Restore a Supabase backup (Pro) or your latest `pnpm db:export`. Prisma has no auto down‑migration — ship a forward migration that reverts, re‑run `db:migrate:deploy`. |
| **Leaked secret** | Rotate at the source, update Railway + GitHub Secret, redeploy. For a JWT key, generate a new pair (invalidates all sessions). |
| **Bad merge on `main`** | Revert the PR on GitHub; `main` history is linear so `git revert` is clean. |
| **Total outage** | `/health/ready` to isolate DB vs Redis; check provider status pages; roll the API back first. |

> **Before any prod change:** take a fresh `pnpm db:export` and note the deployed
> release IDs on each host for a known‑good rollback target.

---

## Appendix · Quick command reference

```bash
# One-time test-env setup (§2) — points the suites at your TEST databases
cp .env.test.example .env.test                   # fill in TEST Supabase + Upstash creds
pnpm --filter @restaurant/db db:migrate:deploy   # against the TEST db

# Local dev
pnpm install
pnpm redis:up                                    # local Redis via Docker (or use Upstash test)
pnpm dev                                          # all apps (turbo) — uses .env (TEST stack)
pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Database (test locally; prod only via CI / with prod DIRECT_DATABASE_URL exported)
pnpm --filter @restaurant/db db:migrate:deploy   # apply migrations (uses DIRECT_DATABASE_URL)
pnpm db:export                                    # backup to ./backups
NODE_ENV=production pnpm check-env                # pre-deploy env validation

# Branch flow
git switch staging && git switch -c feature/xyz  # start work
#   → PR into staging (auto-deploys) → PR staging→main → Deploy · Production

# GitHub secrets (values prompted, hidden)
gh secret set <NAME> --env staging    --repo majidifounder/maida
gh secret set <NAME> --env production --repo majidifounder/maida
gh secret list        --env production --repo majidifounder/maida

# Admin bootstrap (after first deploy)
#   UPDATE users SET role='ADMIN', "emailVerifiedAt"=now() WHERE email='you@get-maida.com';
#   then log in at admin.get-maida.com → scan the TOTP QR → enter the 6-digit code
```
