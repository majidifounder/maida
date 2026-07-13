# Maida — Production Deployment Guide

A complete, start-to-finish guide to deploying the Maida restaurant‑reservation
platform to production. **No prior knowledge of the stack is assumed.** Follow
the parts in order; each step says exactly what to click, what to run, and where
to find every value.

> **Golden rule:** never commit a real secret. Everything sensitive lives in
> GitHub Actions Secrets and in each host's environment settings — never in the
> repo. `.env` is git‑ignored; only `*.env.example` files are committed.

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
                         ┌──────────────── Cloudflare (DNS · TLS · CDN · WAF · Turnstile) ────────────────┐
   diner   ─▶ yourdomain.com            ─▶ Web SPA        (Cloudflare Pages / Vercel)                      │
   owner   ─▶ dashboard.yourdomain.com  ─▶ Dashboard SPA  (Cloudflare Pages / Vercel)                      │
   admin   ─▶ admin.yourdomain.com      ─▶ Admin SPA      (Cloudflare Pages / Vercel)                      │
   all     ─▶ api.yourdomain.com        ─▶ API + /ws + worker (Railway / Fly.io) ─┬─ Postgres  (Supabase)  │
                                                                                  ├─ Redis     (Upstash)   │
                                                                                  ├─ Email     (Resend)    │
                                                                                  └─ Billing   (Lemon Sqzy)│
                         └───────────────────────────────────────────────────────────────────────────────┘
```

**Why the API cannot be “serverless / free”:** it holds long‑lived WebSocket
connections and runs a persistent BullMQ worker + Redis pub/sub subscriber. That
requires an always‑on process — serverless functions (Vercel/Netlify) and
free tiers that sleep after inactivity (Render free) will drop WebSockets and
stall the worker. This is the one place a small paid host is justified (see §1).

---

## 1 · Cost summary — read this first

Target: **the only unavoidable recurring cost is the domain.** Everything else
fits a free tier at launch / low traffic.

| Service | Purpose | Plan to use | Recurring cost |
|---------|---------|-------------|----------------|
| **Domain** | `yourdomain.com` | Cloudflare Registrar (at‑cost, no markup) | **~$10/yr — unavoidable** |
| Cloudflare | DNS, TLS, CDN, WAF, Bot Fight, Turnstile | **Free** | $0 |
| Supabase | PostgreSQL | **Free** (500 MB, 1 project) | $0 |
| Upstash | Redis | **Free** (256 MB, 500 k cmd/mo) | $0 |
| Resend | Transactional email | **Free** (3 000/mo, 100/day) | $0 |
| Lemon Squeezy | Owner subscriptions | Pay‑as‑you‑sell (~5% + fees per charge) | $0 fixed |
| Cloudflare Pages | Web + Dashboard + Admin hosting | **Free** (unlimited bandwidth, commercial OK) | $0 |
| GitHub | Repo + Actions CI/CD | **Free** | $0 |
| **API host** | Fastify + WebSocket + worker | Fly.io or Railway | **$0–5/mo — see below** |

### The two things that can cost money

1. **Domain — genuinely unavoidable (~$10–12/year).** No free domain is
   production‑appropriate. Buy it at **Cloudflare Registrar**, which sells at
   wholesale price with no renewal markup and no upsells.

2. **API host — the one paid service you may need.** Pick one:
   - **Fly.io (cheapest, recommended for lowest cost):** a single
     `shared-cpu-1x` / 256 MB machine costs **≈ $1.94/mo**, and Fly **does not
     invoice balances under $5**, so at launch traffic it is effectively **$0**.
     Keep the machine *always on* (do not enable auto‑stop — it kills
     WebSockets). Requires a card on file.
   - **Railway (simplest, what the repo’s CI/CD targets):** Hobby plan is
     **$5/mo** (includes $5 of usage), one‑click GitHub deploys, WebSockets work
     out of the box. Best if you want the bundled `deploy-*.yml` workflows to
     “just work”.
   - **Free alternatives and why they fall short:** Render’s free web service
     **sleeps after 15 min** (≈30 s cold start, WebSocket drops) — fine for a
     demo, not for a live booking platform. Koyeb’s free tier is single‑instance
     and capacity‑limited. Use these only for a throwaway preview.

   Keep the worker **in‑process** (`RUN_WORKER_IN_PROCESS=true`) so you run **one**
   API service, not two. Only split the worker into its own service once email
   volume justifies the second host.

> **Bottom line:** with Cloudflare Pages (frontends) + Fly.io (API, under the $5
> invoice floor) + all free tiers, your **only bill is the ~$10/yr domain**. If
> you prefer Railway’s turnkey pipeline, add **~$5/mo**.

### About Vercel (if you use the bundled workflows)

The committed GitHub Actions workflows deploy the frontends to **Vercel**.
Vercel’s free **Hobby** tier is **non‑commercial per its Terms** — a paid SaaS
should be on **Vercel Pro ($20/mo)**. To stay at $0, host the three SPAs on
**Cloudflare Pages** instead (free, commercial use allowed, unlimited
bandwidth). Both paths are documented in §B2. The rest of this guide is
host‑agnostic for the frontends.

---

## 2 · Create accounts (in this order)

Sign up for each before you start. All are free to create.

1. [ ] **GitHub** — you already have the repo here.
2. [ ] **Supabase** — <https://supabase.com> (PostgreSQL)
3. [ ] **Upstash** — <https://upstash.com> (Redis)
4. [ ] **Resend** — <https://resend.com> (email)
5. [ ] **Lemon Squeezy** — <https://lemonsqueezy.com> (billing; store activation
       needs business/payout details)
6. [ ] **Cloudflare** — <https://dash.cloudflare.com> (DNS/CDN/WAF/Turnstile/Pages/Registrar)
7. [ ] **API host** — **Fly.io** <https://fly.io> *or* **Railway** <https://railway.app>

You do **not** need the domain yet — Parts A and B run on default platform URLs.

---

## 3 · Environment variable reference

The API validates its environment on boot (`apps/api/src/env.ts`) and
`pnpm check-env` (`scripts/check-env.ts`) enforces the production rules. This is
the single source of truth — populate every **Required** var.

### API (`apps/api`) — set in the API host + GitHub Secrets

| Variable | Required | Where to obtain it |
|----------|----------|--------------------|
| `DATABASE_URL` | ✅ | Supabase → Project → **Connect** → **Transaction** pooler (port **6543**). Append `?pgbouncer=true&connection_limit=10`. |
| `DIRECT_DATABASE_URL` | ✅ | Same page → **Session** pooler (port **5432**). Used only for migrations. |
| `REDIS_URL` | ✅ | Upstash → your database → **`rediss://…`** connection URL. |
| `JWT_PRIVATE_KEY` | ✅ | Generate locally (see §A5). RS256 PKCS#8 PEM. Secret. |
| `JWT_PUBLIC_KEY` | ✅ | Generated alongside the private key. |
| `CORS_ORIGIN` | ✅ | Comma‑separated frontend origins, no trailing slash. Dev default provided. Must **not** contain `localhost` in prod. |
| `RESEND_API_KEY` | ✅ | Resend → **API Keys** → *Create API Key*. Secret (`re_…`). |
| `EMAIL_FROM` | ✅ | Sandbox: `onboarding@resend.dev`. Prod: `noreply@yourdomain.com` (after §C6 domain verification). |
| `LEMON_SQUEEZY_API_KEY` | ✅ | Lemon Squeezy → **Settings → API** → create key. Secret. |
| `LEMON_SQUEEZY_STORE_ID` | ✅ | Lemon Squeezy → **Settings → Stores** → numeric Store ID. |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | ✅ | Lemon Squeezy → **Settings → Webhooks** → your webhook’s signing secret (§A4.3). Secret. |
| `LS_VARIANT_STARTER` | ✅ | Lemon Squeezy → Product → **Variant → copy Variant ID** (Starter). |
| `LS_VARIANT_PRO` | ✅ | Same, Pro variant. |
| `LS_VARIANT_PREMIUM` | ✅ | Same, Premium variant. |
| `NODE_ENV` | ✅ | `production` in prod. |
| `CF_ORIGIN_SECRET` | Prod ✅ | `openssl rand -hex 32`. Must be ≥32 chars and match the Cloudflare Transform Rule (§C4). Secret. |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Optional | Cloudflare → **Turnstile** → widget → **Secret Key**. Unset = registration bot check skipped. |
| `WEB_URL` | Default | Diner app URL (used in reset/verify emails). Dev default `http://localhost:5173`. |
| `DASHBOARD_URL` | Default | Owner app URL. Dev default `http://localhost:5174`. |
| `BCRYPT_ROUNDS` | Default 12 | Leave at 12 in prod. |
| `PORT` | Default 3001 | The host usually sets this; leave default otherwise. |
| `QUEUE_NAME` | Default | `booking_events`. Leave as‑is. |
| `RUN_WORKER_IN_PROCESS` | Default `true` | Keep `true` to run one service (worker inside the API). |
| `AUDIT_LOG_RETENTION_DAYS` | Default 365 | Min 30. |
| `ALERT_WEBHOOK_URL` | Optional | Slack‑compatible incoming webhook for critical alerts. |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_PUBLIC_URL` | Optional | Cloudflare R2 for logo uploads. Unset = logos save to local disk (fine for dev; on a stateless host, set R2 for prod). |

### Frontends — set as build‑time vars in the frontend host

| Variable | Apps | Where to obtain / set |
|----------|------|-----------------------|
| `VITE_API_URL` | web, dashboard, admin | The API’s public URL, e.g. `https://api.yourdomain.com`. Leave **blank in local dev** (the Vite proxy forwards `/api` → `localhost:3001`). |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | web only | Cloudflare → **Turnstile** → widget → **Site Key** (public). Dev test key `1x00000000000000000000AA` always passes. |

### Deploy credentials (GitHub Secrets only — for the bundled workflows)

| Secret | Where to obtain |
|--------|-----------------|
| `PROD_RAILWAY_TOKEN` / `STAGING_RAILWAY_TOKEN` | Railway → **Account Settings → Tokens** (or a project token). |
| `VERCEL_TOKEN` | Vercel → **Settings → Tokens** (only if using Vercel). |
| `VERCEL_ORG_ID` | `vercel whoami --json`, or `.vercel/project.json` after first `vercel link`. |
| `VERCEL_PROJECT_ID_WEB_PROD` / `_WEB_STAGING` / `_DASHBOARD_PROD` / `_DASHBOARD_STAGING` | Vercel → each Project → **Settings → General → Project ID**. |

The full per‑environment secret list is in **§A6**.

---

# PART A · Provision backing services (no domain required)

Everything here works on free platform URLs. Do it first.

## A1 · Supabase — PostgreSQL

1. [ ] **New project** (region close to your users). Save the database password.
2. [ ] **Connect** (top bar) → copy two connection strings:
   - **Transaction pooler** (port **6543**) → `DATABASE_URL`. **Append**
     `?pgbouncer=true&connection_limit=10`.
     Prisma’s prepared statements break on the transaction pooler without
     `pgbouncer=true` — `check-env` blocks the deploy if you forget.
   - **Session pooler** (port **5432**) → `DIRECT_DATABASE_URL` (migrations).
3. [ ] URL‑encode the password if it contains `@ : / ? # [ ] ! $ * &` (e.g. `@`→`%40`).
4. [ ] Apply the schema (run from the repo root with the two URLs exported):
   ```bash
   DATABASE_URL="<direct-url>" DIRECT_DATABASE_URL="<direct-url>" \
     pnpm --filter @restaurant/db db:migrate:deploy
   ```
5. [ ] **Do NOT run the dev seed in production** (`pnpm db:seed` inserts demo data).
6. [ ] Free tier has **no automated backups**. Either accept manual backups
   (`pnpm db:export` uses `DIRECT_DATABASE_URL`) or budget for Supabase Pro
   ($25/mo) once you have real customers. Point‑in‑time backups are a real
   business‑continuity gap on free tier — note it, don’t ignore it.

## A2 · Upstash — Redis

1. [ ] **Create database** → type **Regional**, same region as the API host.
2. [ ] Copy the **`rediss://…`** URL → `REDIS_URL`.
3. [ ] **Eviction policy → `noeviction`** (Upstash console → your DB →
   *Configuration*). The default `allkeys-lru` will silently evict rate‑limit
   counters and the JWT deny‑list — `check-env` warns and fails prod if it is
   not `noeviction`.

## A3 · Resend — email (sandbox first, verify domain later)

1. [ ] **API Keys → Create** → `RESEND_API_KEY` (starts `re_`).
2. [ ] Until you own a domain, set `EMAIL_FROM=onboarding@resend.dev`. In sandbox
   mode Resend only delivers to **your own account email** — expected. Real
   sending to any address requires the domain verification in **§C6**.

## A4 · Lemon Squeezy — owner billing

The platform bills **restaurant owners** (plans STARTER / PRO / PREMIUM). Diners
and admins are never charged. Lemon Squeezy is a Merchant of Record, so it
handles sales tax/VAT for you.

### A4.1 · Store & API key
1. [ ] Activate a store (business/payout details as LS requires).
2. [ ] **Settings → Stores** → copy **Store ID** → `LEMON_SQUEEZY_STORE_ID`.
3. [ ] **Settings → API** → create a key → `LEMON_SQUEEZY_API_KEY`.

### A4.2 · Three subscription variants
Create one subscription product with three variants matching the code’s plan
limits (`apps/api/src/lib/plan.ts`):

| Plan | Restaurants | Bookings/mo | Env var |
|------|-------------|-------------|---------|
| STARTER | 1 | 200 | `LS_VARIANT_STARTER` |
| PRO | 5 | 1 000 | `LS_VARIANT_PRO` |
| PREMIUM | Unlimited | Unlimited | `LS_VARIANT_PREMIUM` |

- [ ] For each variant: **open the variant → copy its numeric Variant ID** → set
  the matching `LS_VARIANT_*`.

### A4.3 · Webhook
The API exposes **`POST /webhooks/lemon-squeezy`** (no JWT — verified by
HMAC‑SHA256 signature). It is registered **before** the Cloudflare origin guard
so Lemon Squeezy’s servers reach it without the origin secret.

1. [ ] **Settings → Webhooks → Add** →
   URL `https://<api-host>/webhooks/lemon-squeezy`
   (local: use `ngrok http 3001`; staging/prod: your API URL).
2. [ ] Copy the **signing secret** → `LEMON_SQUEEZY_WEBHOOK_SECRET`.
3. [ ] Enable exactly these events (all consumed by `webhook.routes.ts`):
   `subscription_created`, `subscription_updated`, `subscription_cancelled`,
   `subscription_resumed`, `subscription_expired`, `subscription_payment_success`,
   `subscription_payment_failed`, `subscription_payment_recovered`.

## A5 · Generate RS256 JWT keys (fresh per environment)

Never reuse dev keys in prod. From the repo root:

```bash
# Option A — OpenSSL
openssl genrsa -out prod-private.pem 4096
openssl rsa -in prod-private.pem -pubout -out prod-public.pem
# Paste each into the matching GitHub Secret / host env var, then delete:
rm prod-private.pem prod-public.pem

# Option B — Node (no OpenSSL), prints both keys:
node -e "const{generateKeyPairSync}=require('crypto');const{privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});console.log(privateKey);console.log(publicKey);"
```

- [ ] `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` set (in host env + GitHub Secrets).
- [ ] Private key stored **only** in secrets — never committed.
- [ ] In CI/host env, multi‑line PEMs may be stored with literal `\n`; the app
  normalises them on boot.

## A6 · GitHub — repo settings, environments & secrets

### A6.1 · Branch protection & environments
- [ ] Settings → **Branches** → protect `main`: require PR, require status checks
  `lint`, `typecheck`, `test`, `build`, require up‑to‑date, no bypass.
- [ ] Settings → **Environments** → create `staging` and `production`.
- [ ] On `production`, add **at least one required reviewer** (gates prod deploys).

### A6.2 · Secrets (Settings → Secrets and variables → Actions)
Only needed if you use the bundled workflows. Use platform default URLs for
`*_CORS_ORIGIN` / `*_EMAIL_FROM` / `*_WEB_URL` / `*_DASHBOARD_URL` until you own a
domain (Part C updates them).

**Repository‑level (shared):** `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID_WEB_STAGING`, `VERCEL_PROJECT_ID_WEB_PROD`,
`VERCEL_PROJECT_ID_DASHBOARD_STAGING`, `VERCEL_PROJECT_ID_DASHBOARD_PROD`
*(skip all Vercel secrets if hosting frontends on Cloudflare Pages).*

**`staging` environment:** `STAGING_RAILWAY_TOKEN`, `STAGING_DATABASE_URL`,
`STAGING_DIRECT_DATABASE_URL`, `STAGING_REDIS_URL`, `STAGING_JWT_PRIVATE_KEY`,
`STAGING_JWT_PUBLIC_KEY`, `STAGING_RESEND_API_KEY`, `STAGING_EMAIL_FROM`,
`STAGING_CORS_ORIGIN`, `STAGING_LEMON_SQUEEZY_WEBHOOK_SECRET`,
`STAGING_LEMON_SQUEEZY_API_KEY`, `STAGING_LEMON_SQUEEZY_STORE_ID`,
`STAGING_LS_VARIANT_STARTER`, `STAGING_LS_VARIANT_PRO`,
`STAGING_LS_VARIANT_PREMIUM`, `STAGING_CF_ORIGIN_SECRET`, `STAGING_WEB_URL`,
`STAGING_DASHBOARD_URL`.

**`production` environment:** same set with `PROD_` prefix, plus optional
`PROD_ALERT_WEBHOOK_URL`. (`PROD_CF_ORIGIN_SECRET` is **required** — prod
`check-env` fails without a ≥32‑char value.)

> The workflows also read a repo/environment **variable** (not secret)
> `PRODUCTION_URL` / `STAGING_URL` for the deploy summary — set them under
> Settings → Environments → *Variables*.

## A7 · Local verification before any deploy

```bash
pnpm install
pnpm lint          # 0 errors
pnpm typecheck     # 0 errors
pnpm test          # full suite green (needs a local Postgres + Redis; see below)
pnpm build         # all apps build
```

`pnpm test` needs Postgres + Redis. Start Redis with `pnpm redis:up` (Docker) and
point `DATABASE_URL`/`DIRECT_DATABASE_URL` at a scratch Postgres — or just rely
on the CI gate, which spins up ephemeral Postgres + Redis automatically.

- [ ] lint / typecheck / build clean; test suite green (locally or in CI).

---

# PART B · First deploy on default URLs (no domain yet)

Deploy to platform hostnames (`*.up.railway.app`, `*.pages.dev` / `*.vercel.app`)
and smoke‑test before touching DNS.

## B1 · API → Railway (or Fly.io)

### Option 1 — Railway (matches the bundled workflow)
1. [ ] New project → **Deploy from GitHub repo** → select this repo.
2. [ ] Service **Root Directory** = `apps/api`. Build/start come from the app’s
   `package.json` (`pnpm build` → `node dist/index.js`).
3. [ ] Add **all API env vars** from §3 (Railway → service → *Variables*). Set
   `NODE_ENV=production`, `RUN_WORKER_IN_PROCESS=true`.
4. [ ] Name the service **`api-staging`** (and later **`api-prod`**) — the
   workflows deploy by these exact names via `railway up --service <name>`.
5. [ ] Create a Railway API token → GitHub Secret `STAGING_RAILWAY_TOKEN` /
   `PROD_RAILWAY_TOKEN`.

### Option 2 — Fly.io (lowest cost)
```bash
curl -L https://fly.io/install.sh | sh      # or: brew install flyctl
fly auth login
cd apps/api
fly launch --no-deploy                       # creates fly.toml; pick a name + region
fly secrets set NODE_ENV=production RUN_WORKER_IN_PROCESS=true \
  DATABASE_URL="…" DIRECT_DATABASE_URL="…" REDIS_URL="…" \
  JWT_PRIVATE_KEY="…" JWT_PUBLIC_KEY="…" CORS_ORIGIN="…" \
  RESEND_API_KEY="…" EMAIL_FROM="onboarding@resend.dev" \
  LEMON_SQUEEZY_API_KEY="…" LEMON_SQUEEZY_STORE_ID="…" \
  LEMON_SQUEEZY_WEBHOOK_SECRET="…" LS_VARIANT_STARTER="…" \
  LS_VARIANT_PRO="…" LS_VARIANT_PREMIUM="…"
fly deploy
```
- [ ] In `fly.toml` keep **`min_machines_running = 1`** / **no auto‑stop** — an
  auto‑stopped machine kills the WebSocket feed and pauses the worker.

## B2 · Frontends → Cloudflare Pages (recommended, free) or Vercel

Each SPA is a static Vite build. Build settings per app:

| Setting | web | dashboard | admin |
|---------|-----|-----------|-------|
| Root directory | `apps/web` | `apps/dashboard` | `apps/admin` |
| Build command | `pnpm install && pnpm --filter @restaurant/web build` | `…dashboard build` | `…admin build` |
| Output dir | `apps/web/dist` | `apps/dashboard/dist` | `apps/admin/dist` |

### Option 1 — Cloudflare Pages (free, commercial OK)
1. [ ] Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → this repo.
2. [ ] Create **three** Pages projects (web, dashboard, admin) with the settings
   above. Framework preset: **Vite** (SPA fallback to `index.html`).
3. [ ] Add env var **`VITE_API_URL`** = your API URL (and, for **web** only,
   `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`). Redeploy after changing env vars —
   Vite bakes them in at build time.

### Option 2 — Vercel (bundled workflows; Pro plan for commercial use)
1. [ ] Create Vercel projects for **web** and **dashboard** (and a third for
   **admin** — it is *not* in the workflows, deploy it manually or add a step).
2. [ ] Each project: Root Directory = the app path, add `VITE_API_URL` (+ site key
   for web). Capture `VERCEL_ORG_ID` and each Project ID into GitHub Secrets.
3. [ ] Manual deploy command (per app), which is what CI runs:
   ```bash
   cd apps/web && vercel pull --yes --environment=preview --token=$VERCEL_TOKEN \
     && vercel build --token=$VERCEL_TOKEN \
     && vercel deploy --prebuilt --token=$VERCEL_TOKEN
   ```

> **Admin app:** neither workflow deploys `apps/admin`. Host it as a third
> Cloudflare Pages project (free) or a third Vercel project, and add its URL to
> `CORS_ORIGIN`.

## B3 · Migrate the staging/prod database

Schema must lead code — the API image never migrates at boot. The workflows do
this automatically; to run it by hand:

```bash
DATABASE_URL="<direct-url>" DIRECT_DATABASE_URL="<direct-url>" \
  pnpm --filter @restaurant/db db:migrate:deploy
```

## B4 · Trigger the deploy

- **Automated:** push to `main` → **`deploy-staging.yml`** runs the full CI gate
  (lint, typecheck, test on ephemeral Postgres+Redis), builds, migrates staging,
  then deploys API→Railway and web+dashboard→Vercel.
- **Manual prod:** Actions → **`Deploy · Production`** → Run workflow → type
  `DEPLOY` to confirm → passes the required‑reviewer gate → deploys.

## B5 · Verify the first deploy

```bash
curl https://<api-url>/health            # {"status":"ok","environment":"production"}
curl https://<api-url>/health/ready      # {"status":"ok","checks":{"database":"ok","redis":"ok"}}
```

- [ ] `/health` → 200; `/health/ready` → `database: ok`, `redis: ok`.
- [ ] Set `VITE_API_URL` on all three frontends to the API URL and redeploy them.
- [ ] Register → verify email → login → create restaurant → add a table → book →
  confirmation shows; owner dashboard **service board updates live** (WebSocket);
  cancel → the row/table state updates.
- [ ] `GET /` → 404 (expected: the API has no homepage).

---

# PART C · Custom domain + Cloudflare hardening

Requires a registered domain. Suggested layout:

| Host | Points to |
|------|-----------|
| `yourdomain.com` / `www` | Web SPA host |
| `dashboard.yourdomain.com` | Dashboard SPA host |
| `admin.yourdomain.com` | Admin SPA host |
| `api.yourdomain.com` | API host (Railway/Fly) |

## C1 · Buy the domain
- [ ] Register at **Cloudflare Registrar** (cheapest, no markup) — or any
  registrar, then move DNS to Cloudflare in C2.

## C2 · Add the site to Cloudflare + DNS
1. [ ] `dash.cloudflare.com` → **Add a site** → **Free** plan → follow to swap
   your registrar’s nameservers to Cloudflare’s. Wait for **Active**.
2. [ ] **DNS → Records** — add a CNAME per host pointing at the host’s target
   (Pages/Vercel/Railway/Fly give you a CNAME target or custom‑domain instructions):

   | Type | Name | Target | Proxy |
   |------|------|--------|-------|
   | CNAME | `www` (or `@`) | web host target | **Proxied** 🟠 |
   | CNAME | `dashboard` | dashboard host target | **Proxied** 🟠 |
   | CNAME | `admin` | admin host target | **Proxied** 🟠 |
   | CNAME | `api` | API host target | **Proxied** 🟠 |

3. [ ] Also add each custom domain **inside the host** (Pages/Vercel custom
   domains; Railway/Fly custom domain) so it issues the origin certificate.
4. [ ] `dig api.yourdomain.com` returns Cloudflare IPs (104.x / 172.x), **not**
   the origin IP.

## C3 · TLS + WebSockets
- [ ] **SSL/TLS → Overview → Full (strict)**.
- [ ] **Edge Certificates →** Always Use HTTPS **on**, Min TLS **1.2**.
- [ ] **Network → WebSockets → On** (required for the `/ws` live feed).

## C4 · Origin secret (block direct‑to‑origin)
1. [ ] `openssl rand -hex 32` → set as `CF_ORIGIN_SECRET` in the API host.
2. [ ] **Rules → Transform Rules → Modify Request Header → Create**: when
   `true` (all requests), **Set** header `X-CF-Origin-Secret` = *(same hex)*.
3. [ ] Redeploy the API with `NODE_ENV=production`. The `cloudflareOnly` guard now
   rejects any request that didn’t come through Cloudflare. (Webhook and health
   routes are intentionally exempt.)

## C5 · Turnstile, WAF, bots
1. [ ] **Turnstile → Add widget** (domains: your web hosts, mode Managed). Site
   Key → `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` (web host, then redeploy web);
   Secret Key → `CLOUDFLARE_TURNSTILE_SECRET_KEY` (API host, then redeploy API).
2. [ ] **Security → WAF → Rate limiting rules** (edge backup to server limits):
   - `/auth/register` POST — 5 / IP / hour → Block.
   - `/auth/login` POST — 10 / IP / 15 min → Block.
3. [ ] **WAF → Managed rules →** enable Cloudflare Managed Ruleset + OWASP Core
   (Paranoia **PL2**).
4. [ ] **Security → Bots → Bot Fight Mode → On**.
5. [ ] **Security → Settings → Security Level: High** for launch.

## C6 · Resend — verify your domain
1. [ ] Resend → **Domains → Add domain** → `yourdomain.com`.
2. [ ] Add the SPF / DKIM / DMARC records Resend shows into **Cloudflare DNS**
   (set these mail records to **DNS only / grey cloud**).
3. [ ] After it verifies, set `EMAIL_FROM=noreply@yourdomain.com` (API host +
   `*_EMAIL_FROM` secrets) and redeploy.

## C7 · Point everything at the real domain
- [ ] `CORS_ORIGIN` = `https://yourdomain.com,https://www.yourdomain.com,https://dashboard.yourdomain.com,https://admin.yourdomain.com` — **no localhost, no trailing slashes**.
- [ ] `WEB_URL=https://yourdomain.com`, `DASHBOARD_URL=https://dashboard.yourdomain.com` (API host + secrets).
- [ ] `VITE_API_URL=https://api.yourdomain.com` on all three frontends → redeploy.
- [ ] Update the Lemon Squeezy webhook URL to `https://api.yourdomain.com/webhooks/lemon-squeezy`.
- [ ] Run the pre‑deploy gate:
   ```bash
   NODE_ENV=production pnpm check-env
   ```
  It verifies every required var, blocks `localhost` in `CORS_ORIGIN`, enforces
  `pgbouncer=true`, the `CF_ORIGIN_SECRET` length, and checks the Upstash
  eviction policy.

---

# PART D · Production go‑live

- [ ] All of Part A, B, C complete; `pnpm check-env` passes with prod values.
- [ ] Run **`Deploy · Production`** (type `DEPLOY`, approve the reviewer gate).
- [ ] `curl https://api.yourdomain.com/health/ready` → all `ok`.
- [ ] Full end‑to‑end on the real domain (register with Turnstile → book → email
  arrives → live dashboard update → cancel → owner subscribes via Lemon Squeezy →
  webhook upgrades the plan in `/subscriptions/me`).
- [ ] STARTER owner is blocked from a 2nd restaurant until upgraded (plan gate).
- [ ] Announce. 🎉

---

# PART E · Post‑deploy verification checklist

| Check | How | Expected |
|-------|-----|----------|
| API live | `curl …/health` | `status: ok` |
| DB + Redis | `curl …/health/ready` | `checks: {database: ok, redis: ok}` |
| CORS | Load a frontend, open Network tab | No CORS errors; requests hit `api.yourdomain.com` |
| Auth | Register → verify → login | Session persists; `/auth/me` returns the user |
| Booking | Book a slot | 201; appears in *My Reservations* and the owner board |
| Real‑time | Owner board open while a diner books | Row appears without refresh (WebSocket) |
| Email | Book / cancel | Diner + owner receive mail (verified domain) |
| Billing | Owner checkout → pay → webhook | `/subscriptions/me` shows the new plan; log shows `subscription_created`; re‑sending the webhook logs *duplicate — skipping* (idempotent) |
| Plan gate | STARTER owner, 2nd restaurant | 403 `Plan limit reached` |
| Origin lock | `curl https://<origin-ip>/health` | Blocked / times out (Cloudflare‑only) |
| Admin | Login at `admin.yourdomain.com` | Email + password + TOTP → stats load |
| Rate limits | 6 rapid `/auth/register` | 429 after the 5th (edge) / 3rd (server) |

---

# PART F · Troubleshooting & common mistakes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| API won’t boot, exits immediately | Missing required env var | Check the host logs — `env.ts` prints exactly which var failed. Run `pnpm check-env`. |
| `prepared statement "s0" already exists` under load | `DATABASE_URL` uses port 6543 without `pgbouncer=true` | Append `?pgbouncer=true&connection_limit=10`. |
| `P1001: can't reach database` during migrate | Migrating via the pooled URL or IPv6‑only direct host | Use `DIRECT_DATABASE_URL` (session pooler, 5432). |
| Rate limits / logins behave randomly | Upstash eviction policy is `allkeys-lru` | Set **`noeviction`** in the Upstash console. |
| `Not allowed by CORS` in the browser | Frontend origin missing from `CORS_ORIGIN`, or a trailing slash | List every origin exactly, no trailing slash, no `localhost` in prod. |
| Login works but a page refresh logs you out | Refresh cookie (`__Host-refresh`) not stored — needs HTTPS + real domains, and all apps share one API host’s cookie | Fine in production over HTTPS; on `http://localhost` with different ports the cookie is shared across apps (one role at a time) — a test‑only artifact. |
| WebSocket never connects in prod | Cloudflare WebSockets off, or the API machine auto‑stopped | Enable **Network → WebSockets**; keep the Fly machine always‑on. |
| Turnstile widget missing / `TURNSTILE_TOKEN_MISSING` | Web missing `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`, or API missing the secret | Set both, redeploy both. Leave both unset to disable the check. |
| Emails never arrive | Domain not verified in Resend (sandbox only mails your own address) | Complete §C6; set `EMAIL_FROM` to the verified domain. |
| Owner’s plan doesn’t update after paying | Webhook URL/secret wrong, or events not subscribed | Verify the LS webhook URL + `LEMON_SQUEEZY_WEBHOOK_SECRET`; confirm all 8 events; check API logs for `subscription_*`. |
| Direct origin IP still reachable | `CF_ORIGIN_SECRET` / Transform Rule mismatch | The header value and the env var must match exactly; redeploy API. |
| Logos vanish after a redeploy | Local‑disk storage on a stateless host | Configure Cloudflare **R2** (`R2_*`) for prod. |
| Prod deploy “does nothing” | It’s manual‑only | Actions → *Deploy · Production* → Run → type `DEPLOY`. |

**Common mistakes to avoid**
- Running `pnpm db:seed` against production (inserts demo data).
- Reusing dev JWT keys or the dev `CF_ORIGIN_SECRET` in prod.
- Forgetting to redeploy a **frontend** after changing a `VITE_*` var (Vite bakes
  them in at build time).
- Leaving Vercel on the free Hobby plan for a commercial product (ToS) — use
  Cloudflare Pages or Vercel Pro.
- Enabling Fly auto‑stop (breaks WebSockets + worker).

---

# PART G · Rollback procedures

| What broke | Rollback |
|------------|----------|
| **Bad API release** (Railway) | Railway → service → **Deployments** → pick the last good one → **Redeploy/Rollback**. |
| **Bad API release** (Fly) | `fly releases` → `fly deploy --image <previous-image>` (or `fly releases rollback`). |
| **Bad frontend** (Pages/Vercel) | Pages/Vercel → Deployments → **promote** the previous good build to production. |
| **Bad database migration** | Restore from a Supabase backup (Pro) or your latest `pnpm db:export` dump. Prisma has no auto down‑migration — ship a new forward migration that reverts the change, and re‑run `db:migrate:deploy`. |
| **Leaked secret** | Rotate it at the source (Supabase/Upstash/Resend/LS/Cloudflare), update the host env + GitHub Secret, redeploy. For a JWT key, generate a new pair (this invalidates all sessions). |
| **Total outage** | Verify `/health/ready` to isolate DB vs Redis; check the provider status pages; roll the API back to the last good release first. |

> **Before any prod change:** take a fresh DB export (`pnpm db:export`) and note
> the currently‑deployed release IDs on each host so you have a known‑good
> rollback target.

---

## Appendix · Quick command reference

```bash
# Local dev (root)
pnpm install
pnpm redis:up                                   # local Redis via Docker
pnpm dev                                         # all apps (turbo)
pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Database
pnpm --filter @restaurant/db db:migrate:deploy   # apply migrations (uses DIRECT_DATABASE_URL)
pnpm db:export                                    # backup to ./backups
pnpm check-env                                    # pre-deploy env validation (NODE_ENV=production for full checks)

# Admin bootstrap (after first deploy)
#   UPDATE users SET role='ADMIN', "emailVerifiedAt"=now() WHERE email='you@yourdomain.com';
#   then log in at admin.yourdomain.com → scan the TOTP QR → enter the 6-digit code
```
