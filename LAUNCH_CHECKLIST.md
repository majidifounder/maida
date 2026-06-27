# Launch Checklist

Work through this top to bottom. The list is split into two phases:

| Phase | When | What |
|-------|------|------|
| **A · Before you buy a domain** | Now | Infra, secrets, local checks, staging on default host URLs (`*.vercel.app`, `*.up.railway.app`) |
| **B · After you buy a domain** | Once you own `yourdomain.com` | DNS, Cloudflare, Resend verification, production URLs, go-live |

---

# Phase A · Before you buy a domain

Everything here can be completed while developing locally or using platform default URLs. No custom domain required.

---

## A1 · GitHub repository settings

- [ ] **Branch protection on `main`:** Settings → Branches → Add rule
  - Require pull request before merging ✓
  - Require status checks to pass: `lint`, `typecheck`, `test`, `build` ✓
  - Require branches to be up to date before merging ✓
  - Do not allow bypassing the above settings ✓
- [ ] **Environments created:** `staging` and `production` (Settings → Environments)
- [ ] **Required reviewers on `production` environment:** at least 1 person

---

## A2 · GitHub Secrets (Settings → Secrets and variables → Actions)

Set up accounts and tokens first. For `CORS_ORIGIN` and `EMAIL_FROM`, use your **Vercel/Railway default URLs** until you have a real domain (e.g. `https://my-app.vercel.app`).

### Staging environment secrets

- [ ] `STAGING_RAILWAY_TOKEN` — Railway API token for staging service
- [ ] `STAGING_DATABASE_URL` — Supabase pooled URL for staging project
- [ ] `STAGING_DIRECT_DATABASE_URL` — Supabase direct URL (port 5432) for staging
- [ ] `STAGING_REDIS_URL` — Upstash Redis URL for staging
- [ ] `STAGING_JWT_PRIVATE_KEY` — RS256 private key for staging (PKCS#8 PEM)
- [ ] `STAGING_JWT_PUBLIC_KEY` — RS256 public key for staging
- [ ] `STAGING_RESEND_API_KEY` — Resend API key
- [ ] `STAGING_EMAIL_FROM` — temporary: `onboarding@resend.dev` (Resend sandbox) until domain is verified
- [ ] `STAGING_CORS_ORIGIN` — temporary: comma-separated Vercel/Railway staging URLs (no trailing slashes)
- [ ] `STAGING_LEMON_SQUEEZY_WEBHOOK_SECRET` — Lemon Squeezy webhook signing secret (staging store or test mode)
- [ ] `STAGING_LEMON_SQUEEZY_API_KEY` — Lemon Squeezy API key
- [ ] `STAGING_LEMON_SQUEEZY_STORE_ID` — numeric store ID from LS dashboard
- [ ] `STAGING_LS_VARIANT_STARTER` — variant ID for STARTER plan
- [ ] `STAGING_LS_VARIANT_PRO` — variant ID for PRO plan
- [ ] `STAGING_LS_VARIANT_PREMIUM` — variant ID for PREMIUM plan
- [ ] `STAGING_WEB_URL` — temporary: Vercel staging URL for diner app (password reset + checkout return context)
- [ ] `STAGING_DASHBOARD_URL` — temporary: Vercel staging URL for owner dashboard

### Production environment secrets

- [ ] `PROD_RAILWAY_TOKEN` — Railway API token for production service
- [ ] `PROD_DATABASE_URL` — Supabase pooled URL (production project, port 6543)
- [ ] `PROD_DIRECT_DATABASE_URL` — Supabase direct URL (port 5432)
- [ ] `PROD_REDIS_URL` — Upstash Redis URL (production instance)
- [ ] `PROD_JWT_PRIVATE_KEY` — fresh RS256 private key for production
- [ ] `PROD_JWT_PUBLIC_KEY` — corresponding public key
- [ ] `PROD_RESEND_API_KEY` — Resend API key (production)
- [ ] `PROD_EMAIL_FROM` — temporary: `onboarding@resend.dev` until domain verified in Phase B
- [ ] `PROD_CORS_ORIGIN` — temporary: Vercel/Railway production URLs; update in Phase B
- [ ] `PROD_LEMON_SQUEEZY_WEBHOOK_SECRET` — Lemon Squeezy webhook signing secret (production store)
- [ ] `PROD_LEMON_SQUEEZY_API_KEY` — Lemon Squeezy API key (production)
- [ ] `PROD_LEMON_SQUEEZY_STORE_ID` — numeric store ID
- [ ] `PROD_LS_VARIANT_STARTER` — variant ID for STARTER plan
- [ ] `PROD_LS_VARIANT_PRO` — variant ID for PRO plan
- [ ] `PROD_LS_VARIANT_PREMIUM` — variant ID for PREMIUM plan
- [ ] `PROD_WEB_URL` — update in Phase B: `https://yourdomain.com`
- [ ] `PROD_DASHBOARD_URL` — update in Phase B: `https://dashboard.yourdomain.com`

### Vercel secrets (repository-level)

- [ ] `VERCEL_TOKEN` — Vercel personal access token
- [ ] `VERCEL_ORG_ID` — from `vercel whoami --json`
- [ ] `VERCEL_PROJECT_ID_WEB_STAGING` — from Vercel project settings (staging web)
- [ ] `VERCEL_PROJECT_ID_WEB_PROD` — from Vercel project settings (prod web)
- [ ] `VERCEL_PROJECT_ID_DASHBOARD_STAGING` — from Vercel project settings (staging dashboard)
- [ ] `VERCEL_PROJECT_ID_DASHBOARD_PROD` — from Vercel project settings (prod dashboard)

---

## A3 · Supabase (production project)

- [ ] New Supabase project created for production (separate from dev)
- [ ] Migrations applied: `DATABASE_URL=$PROD_DIRECT_DATABASE_URL pnpm --filter @restaurant/db db:migrate:deploy`
- [ ] Seed script reviewed — do NOT run the dev seed in production
- [ ] Database backups enabled (Supabase dashboard → Settings → Backups)
- [ ] Connection pooling confirmed (port 6543 in `DATABASE_URL`)

---

## A4 · Upstash (production instance)

- [ ] New Upstash Redis database created for production (separate from dev)
- [ ] Eviction policy: `noeviction` (not `allkeys-lru`) — rate limit keys must not be silently deleted
- [ ] Max memory confirmed sufficient for expected concurrent sessions

---

## A5 · RS256 keys (production)

Generate fresh keys for production — never reuse dev keys:

```bash
openssl genrsa -out prod-private.pem 4096
openssl rsa -in prod-private.pem -pubout -out prod-public.pem
# Copy contents into GitHub Secrets as PROD_JWT_PRIVATE_KEY / PROD_JWT_PUBLIC_KEY
# Then delete the local .pem files
rm prod-private.pem prod-public.pem
```

- [ ] 4096-bit keys generated (more secure than dev 2048-bit)
- [ ] Private key stored ONLY in GitHub Secret — never committed
- [ ] Public key confirmed to match private key

---

## A6 · Run all checks locally

```bash
# All 165 tests pass
pnpm --filter @restaurant/api test

# Load test passes (API must be running: pnpm --filter @restaurant/api dev)
pnpm load-test

# Typecheck clean
pnpm typecheck

# Build clean
pnpm build
```

- [ ] All 165 tests passed
- [ ] Load test passed (5×201, 15×409, slot.available = 0)
- [ ] Typecheck: 0 errors
- [ ] Build: 0 errors

> `pnpm check-env` requires all production env vars including `CORS_ORIGIN` — run it in Phase B once real URLs are set, or pass staging values manually for a dry run.

---

## A7 · First staging deploy (default platform URLs)

Deploy using Railway + Vercel default hostnames — no custom domain yet.

- [ ] Push to `main` → staging workflow runs (or trigger manually)
- [ ] API reachable at Railway URL (e.g. `https://xxx.up.railway.app`)
- [ ] Web reachable at Vercel preview URL
- [ ] Dashboard reachable at Vercel preview URL
- [ ] Set `VITE_API_URL` in Vercel to the Railway API URL for both frontends
- [ ] `GET <railway-url>/health` → `{ "status": "ok", "checks": { "database": "ok", "redis": "ok" } }`
- [ ] Register → login → create restaurant → add slots → book → confirm in dashboard (emails may only reach your Resend account email in sandbox mode)
- [ ] WebSocket: owner dashboard shows new booking without page refresh
- [ ] Cancel booking → available count updates

---

## A8 · Code-level security (already in repo — verify after deploy)

These are implemented in code; confirm they work on staging:

- [ ] Global rate limit: 100 req/min per real client IP
- [ ] Login rate limit: 5 attempts / IP / 15 min
- [ ] Register rate limit: 3 attempts / IP / hour
- [ ] `GET /` returns 404 (expected — API has no homepage; use `/health`)

---

## A9 · Lemon Squeezy — payment configuration

The platform bills restaurant **owners** via Lemon Squeezy (plans: STARTER / PRO / PREMIUM). Diners and admins are never charged through this flow.

### A9.1 · Create Lemon Squeezy account & store

1. Sign up at [lemonsqueezy.com](https://lemonsqueezy.com) and complete store activation (identity / payout details as required by LS).
2. **Settings → Stores** → copy your **Store ID** (numeric).
3. **Settings → API** → create an **API key** with permission to create checkouts.

- [ ] Lemon Squeezy store activated
- [ ] Store ID copied
- [ ] API key created and stored securely (never commit to git)

### A9.2 · Create subscription products (3 variants)

In **Products → New product**, create one subscription product (or three separate products — either works) with **three variants** matching your plan limits:

| Internal plan | Suggested name | Restaurant limit | Monthly booking limit (API) |
|---------------|----------------|------------------|----------------------------|
| STARTER | Starter | 1 | 200 |
| PRO | Pro | 5 | 1,000 |
| PREMIUM | Premium | Unlimited | Unlimited |

For each variant, open **Variants → copy Variant ID** (numeric). Map them to env vars:

| Env var | Value |
|---------|-------|
| `LS_VARIANT_STARTER` | Variant ID for Starter |
| `LS_VARIANT_PRO` | Variant ID for Pro |
| `LS_VARIANT_PREMIUM` | Variant ID for Premium |

- [ ] Three subscription variants created in Lemon Squeezy
- [ ] Variant IDs copied into `.env` (local) and GitHub Secrets (staging/prod)

### A9.3 · API environment variables (Railway / local `.env`)

Add all six to the API service (see `.env.example`):

```dotenv
LEMON_SQUEEZY_WEBHOOK_SECRET=your_webhook_signing_secret
LEMON_SQUEEZY_API_KEY=your_api_key
LEMON_SQUEEZY_STORE_ID=12345
LS_VARIANT_STARTER=100
LS_VARIANT_PRO=200
LS_VARIANT_PREMIUM=300
WEB_URL=http://localhost:5173
DASHBOARD_URL=http://localhost:5174
```

- [ ] All 6 Lemon Squeezy vars set on API (server refuses to start if any are missing)
- [ ] `WEB_URL` / `DASHBOARD_URL` set to match deployed frontend URLs in staging/prod

> **Admin note:** Admin accounts have no checkout flow. To change an admin password, use Supabase SQL — not Lemon Squeezy.

### A9.4 · Webhook endpoint

The API exposes **`POST /webhooks/lemon-squeezy`** (no JWT — protected by HMAC-SHA256 signature only).

**Important:** This route is registered **before** the Cloudflare origin guard so Lemon Squeezy servers can reach it without `X-CF-Origin-Secret`. Do not put the webhook URL behind a CF-only firewall rule that blocks non-CF clients on managed Railway unless LS traffic is proxied.

1. **Settings → Webhooks → Add webhook**
2. **URL:** `https://<api-host>/webhooks/lemon-squeezy`
   - Local dev: use [ngrok](https://ngrok.com) — `ngrok http 3001` → `https://xxxx.ngrok-free.app/webhooks/lemon-squeezy`
   - Staging: Railway URL — `https://xxx.up.railway.app/webhooks/lemon-squeezy`
   - Production: `https://api.yourdomain.com/webhooks/lemon-squeezy`
3. **Signing secret:** copy into `LEMON_SQUEEZY_WEBHOOK_SECRET`
4. **Subscribe to events:**
   - `subscription_created`
   - `subscription_updated`
   - `subscription_cancelled`
   - `subscription_resumed`
   - `subscription_expired`
   - `subscription_payment_failed`
   - `subscription_payment_success`
   - `subscription_payment_recovered`

- [ ] Webhook URL configured in Lemon Squeezy dashboard
- [ ] Signing secret matches `LEMON_SQUEEZY_WEBHOOK_SECRET` in API env
- [ ] All subscription events above are enabled

### A9.5 · Local smoke test (before staging)

```powershell
# Terminal 1 — API
pnpm --filter @restaurant/api dev

# Terminal 2 — ngrok (if testing webhooks locally)
ngrok http 3001

# Register/login as OWNER (not admin), then:
# GET subscription status
Invoke-RestMethod -Uri "http://localhost:3001/subscriptions/me" `
  -Headers @{ Authorization = "Bearer <owner-access-token>" }

# Create checkout session
Invoke-RestMethod -Uri "http://localhost:3001/subscriptions/checkout" `
  -Method POST -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer <owner-access-token>" } `
  -Body '{"plan":"PRO"}'
# → { "checkoutUrl": "https://..." }

# Complete checkout in browser → watch API logs for:
# [Webhook/LS] ✓ subscription_created — user <uuid> — sub <ls-id>

# Verify plan updated
Invoke-RestMethod -Uri "http://localhost:3001/subscriptions/me" `
  -Headers @{ Authorization = "Bearer <owner-access-token>" }
# → plan: "PRO", status: "ACTIVE"
```

**If checkout can't be completed locally:** confirm the webhook URL in LS dashboard points at your ngrok/Railway URL, then check API logs and Upstash Data Browser for keys matching `ls-event:*` after LS sends a test webhook.

**Plan limit check:**

- [ ] STARTER owner with 1 restaurant gets **403** on second `POST /restaurants` with `{ "error": "Plan limit reached", "upgrade": "/subscriptions/checkout" }`
- [ ] After upgrading to PRO via checkout, same owner can create more restaurants (up to plan cap)

### A9.6 · Staging payment smoke test

After A7 deploy and A9 webhook URL pointed at Railway staging:

- [ ] Owner logs into dashboard staging URL
- [ ] `GET /subscriptions/me` returns current plan + limits
- [ ] `POST /subscriptions/checkout` `{ "plan": "PRO" }` returns a valid `checkoutUrl`
- [ ] Test payment completed (LS test mode or real card in staging store)
- [ ] API logs show `[Webhook/LS] ✓ subscription_created`
- [ ] Supabase `subscriptions` row updated: `plan`, `status`, `lemonSqueezyId`, `renewsAt`
- [ ] Re-send same webhook from LS dashboard → log shows **Duplicate event — skipping** (idempotency)
- [ ] `subscription_expired` webhook (or manual test) downgrades plan to STARTER

---

# Phase B · After you buy a domain

Complete Phase A first. These steps require a registered domain (e.g. `yourdomain.com`) and cannot be fully done without it.

Suggested DNS layout (adjust to your preference):

| Subdomain | Points to |
|-----------|-----------|
| `yourdomain.com` or `www` | Vercel — diner web app |
| `dashboard.yourdomain.com` | Vercel — owner dashboard |
| `api.yourdomain.com` | Railway — API server |

---

## B1 · Buy and register the domain

- [ ] Domain purchased at registrar (Namecheap, Cloudflare Registrar, Google Domains, etc.)
- [ ] Decide subdomains: `api.`, `dashboard.`, `www.` (or apex only)

---

## B2 · Add domain to Cloudflare

1. Log in at [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a Site** → enter your domain → **Free plan** is sufficient.
2. Cloudflare shows two nameservers — replace your registrar's nameservers with these.
3. Wait for propagation (usually 5–30 minutes; up to 48 hours).
4. Confirm status shows **Active** in Cloudflare.

- [ ] Domain added to Cloudflare
- [ ] Nameservers updated at registrar
- [ ] Cloudflare dashboard shows domain as Active

---

## B3 · DNS records (orange cloud = proxied)

**DNS → Records → Add record** for each service:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `www` | Vercel DNS target | **Proxied** (orange cloud) |
| CNAME | `dashboard` | Vercel DNS target | **Proxied** |
| CNAME | `api` | Railway DNS target | **Proxied** |

Or use A records if your host provides an IP — always keep **Proxied** enabled for the API.

- [ ] All records created with orange cloud (proxied) enabled
- [ ] `dig yourdomain.com` returns Cloudflare IPs (104.x.x.x), **not** your origin server IP
- [ ] `dig api.yourdomain.com` returns Cloudflare IPs

---

## B4 · SSL / TLS

1. **SSL/TLS → Overview** → mode: **Full (strict)**
   - Requires a valid TLS cert on origin (Railway/Vercel provide this automatically).
2. **SSL/TLS → Edge Certificates** → enable **Always Use HTTPS** and **Automatic HTTPS Rewrites**
3. **SSL/TLS → Edge Certificates** → **Minimum TLS Version**: `TLS 1.2`

- [ ] Full (strict) enabled
- [ ] Always Use HTTPS enabled
- [ ] Minimum TLS 1.2 set

---

## B5 · Network — WebSockets

1. **Network → WebSockets** → toggle **On**

Required for the owner dashboard live booking feed (`/ws`).

- [ ] WebSockets enabled in Cloudflare

---

## B6 · WAF — edge rate limiting

**Security → WAF → Rate limiting rules → Create rule**

### Rule 1 — Block registration bots

| Field | Value |
|-------|-------|
| Rule name | `Block registration bots` |
| Expression | `http.request.uri.path eq "/auth/register" and http.request.method eq "POST"` |
| Characteristic | IP |
| Period | 1 hour |
| Requests | 5 |
| Action | Block (429) |

### Rule 2 — Block login brute-force

| Field | Value |
|-------|-------|
| Rule name | `Block login brute-force` |
| Expression | `http.request.uri.path eq "/auth/login" and http.request.method eq "POST"` |
| Characteristic | IP |
| Period | 15 minutes |
| Requests | 10 |
| Action | Block (429) |

- [ ] Registration WAF rule active (5/IP/hour at edge; server enforces 3/hour)
- [ ] Login WAF rule active (10/IP/15min at edge; server enforces 5/15min)

---

## B7 · WAF — Managed Rules

1. **Security → WAF → Managed rules** → enable **Cloudflare Managed Ruleset**
2. Enable **Cloudflare OWASP Core Ruleset** → Paranoia Level **PL2**

- [ ] Managed Ruleset enabled
- [ ] OWASP Core Ruleset enabled (PL2)

---

## B8 · Bot Fight Mode

1. **Security → Bots** → enable **Bot Fight Mode** (free) or **Super Bot Fight Mode** (Pro)

- [ ] Bot Fight Mode enabled

---

## B9 · Cloudflare Turnstile (bot check on registration)

1. Go to **Turnstile** in the Cloudflare sidebar → **Add Widget**
   - Name: `Restaurant Booking — Registration`
   - Domains: `yourdomain.com`, `www.yourdomain.com`
   - Widget Mode: **Managed**
2. Copy **Site Key** → set as `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` in Vercel (web app env)
3. Copy **Secret Key** → set as `CLOUDFLARE_TURNSTILE_SECRET_KEY` in Railway (API env)
4. Redeploy web + API after setting env vars

- [ ] Turnstile widget created with production domain(s)
- [ ] `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` set in Vercel (web)
- [ ] `CLOUDFLARE_TURNSTILE_SECRET_KEY` set in Railway (API)
- [ ] Registration form shows Turnstile widget in browser
- [ ] Registration without token returns `422 TURNSTILE_TOKEN_MISSING`:
  ```bash
  curl -s -X POST https://api.yourdomain.com/auth/register \
    -H 'Content-Type: application/json' \
    -d '{"email":"bot@test.com","password":"Test1234!","role":"diner"}'
  ```

---

## B10 · Transform Rule — origin secret header

Blocks direct access to your server IP (defense in depth with OS firewall in B12).

1. Generate a secret:
   ```bash
   openssl rand -hex 32
   ```
2. **Rules → Transform Rules → Modify Request Header → Create rule**
   - Rule name: `Inject origin secret`
   - When: **All incoming requests** (expression: `true`)
   - Then: **Set** → Header: `X-CF-Origin-Secret` → Value: *(paste the hex string)*
3. Set the same value as `CF_ORIGIN_SECRET` in Railway (API env)
4. Redeploy API

- [ ] Transform Rule created and active
- [ ] `CF_ORIGIN_SECRET` set in Railway (matches Transform Rule exactly)
- [ ] API redeployed with `NODE_ENV=production`

---

## B11 · Resend — verify sending domain

1. **Resend dashboard → Domains → Add domain** → enter `yourdomain.com`
2. Add the DNS records Resend provides (SPF, DKIM, DMARC) in **Cloudflare DNS**
   - Set mail-related records to **DNS only** (grey cloud) if Resend instructs you to
3. Wait for verification (usually minutes)

- [ ] Domain verified in Resend
- [ ] `PROD_EMAIL_FROM` updated to `noreply@yourdomain.com` (GitHub Secret + Railway)
- [ ] `STAGING_EMAIL_FROM` updated if using a staging subdomain
- [ ] Test email arrives on booking create/cancel (end-to-end)

---

## B12 · Update production URLs in secrets

Replace temporary Vercel/Railway URLs with real domains:

- [ ] `PROD_CORS_ORIGIN` = `https://yourdomain.com,https://www.yourdomain.com,https://dashboard.yourdomain.com,https://admin.yourdomain.com` (no localhost, no trailing slashes)
- [ ] `STAGING_CORS_ORIGIN` updated if using staging subdomains
- [ ] `VITE_API_URL` = `https://api.yourdomain.com` in Vercel (web + dashboard + admin)
- [ ] `WEB_URL` = `https://yourdomain.com` in Railway (API — reset emails + checkout context)
- [ ] `DASHBOARD_URL` = `https://dashboard.yourdomain.com` in Railway (API)
- [ ] Custom domains added in Vercel project settings for web and dashboard
- [ ] Custom domain added in Railway for API
- [ ] Lemon Squeezy webhook URL updated to `https://api.yourdomain.com/webhooks/lemon-squeezy`
- [ ] Production variant IDs confirmed in `LS_VARIANT_*` (may differ from test store)

Run pre-deploy check:

```bash
NODE_ENV=production pnpm check-env
```

- [ ] `pnpm check-env` passes with production values
- [ ] `CORS_ORIGIN` contains production domains only — NO `localhost`

---

## B13 · OS firewall — block non-Cloudflare traffic (production server)

Run on your **production Linux server** (Railway bare metal / VPS). This is the primary defence against direct origin access.

```bash
# 1. SSH first — do NOT enable ufw without this
sudo apt install -y ufw
sudo ufw allow 22/tcp comment 'SSH'

# 2. Default policy
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 3. Allow Cloudflare IPv4 on HTTPS (verify list at https://www.cloudflare.com/ips-v4)
for cidr in \
  173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
  141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
  197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 \
  104.24.0.0/14 172.64.0.0/13 131.0.72.0/22; do
    sudo ufw allow from "$cidr" to any port 443 proto tcp comment 'Cloudflare'
done

# 4. Allow Cloudflare IPv6 (https://www.cloudflare.com/ips-v6)
for cidr in \
  2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 \
  2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32; do
    sudo ufw allow from "$cidr" to any port 443 proto tcp comment 'Cloudflare IPv6'
done

# 5. Enable
sudo ufw enable
sudo ufw status verbose
```

> **Note:** If API is on Railway (managed), ufw may not apply — Railway handles network isolation. Use this for VPS/self-hosted origins. The `cloudflareOnly` plugin (B10) is your fallback on managed hosts.

- [ ] ufw configured (self-hosted) OR Railway managed network confirmed
- [ ] `curl -k --max-time 5 https://<server-ip>/health` → connection refused / timeout (direct IP blocked)
- [ ] `curl https://api.yourdomain.com/health` → `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`

---

## B14 · Security Level & DDoS

1. **Security → Settings** → **Security Level**: `High` at launch (lower to `Medium` once traffic is stable)
2. **Security → DDoS** → confirm **HTTP DDoS Attack Protection** is enabled (default on all plans)

- [ ] Security Level set to High for launch
- [ ] DDoS protection confirmed enabled

---

## B15 · Staging smoke test (custom domain)

After DNS and Cloudflare are active on staging subdomains (optional) or production:

- [ ] `GET https://api.yourdomain.com/health` → 200, database + redis ok
- [ ] Register → Turnstile passes → account created
- [ ] Booking confirmation email arrives (Resend, verified domain)
- [ ] Owner dashboard WebSocket updates without refresh
- [ ] Cancel booking → email + slot count correct
- [ ] Owner subscription checkout → payment → plan upgrades in `/subscriptions/me`
- [ ] STARTER owner blocked from creating 2nd restaurant until plan upgraded

---

## B16 · Production go-live

- [ ] All Phase A items complete
- [ ] All Phase B items complete (B1–B15)
- [ ] Staging smoke test passed on real domain
- [ ] Production deploy triggered (`deploy-prod.yml` with manual approval)
- [ ] `GET https://api.yourdomain.com/health` returns 200
- [ ] End-to-end flow repeated on production
- [ ] Owner can subscribe via Lemon Squeezy checkout; webhook syncs plan to database
- [ ] Announce 🎉

---

## Quick reference — what needs a domain?

| Task | Phase |
|------|-------|
| GitHub branch protection & secrets | A |
| Supabase + Upstash production | A |
| RS256 keys | A |
| Local tests + load test | A |
| Staging on `*.vercel.app` / `*.railway.app` | A |
| Lemon Squeezy store, variants, webhook, checkout smoke test | A |
| Cloudflare proxy + WAF + Turnstile | **B** |
| Resend domain verification | **B** |
| Lemon Squeezy production webhook + live payments | **B** |
| `CORS_ORIGIN` / `EMAIL_FROM` / `WEB_URL` / `DASHBOARD_URL` with real URLs | **B** |
| OS firewall + origin secret verification | **B** |
| Production go-live | **B** |

---

## Admin Panel (`apps/admin`)

- [ ] `pnpm --filter @restaurant/admin build` succeeds with 0 TypeScript errors
- [ ] Admin account in DB: `UPDATE users SET role = 'ADMIN' WHERE email = 'admin@yourdomain.com';`
- [ ] First login at http://localhost:5175 — QR code → scan authenticator → 6-digit code → dashboard
- [ ] Subsequent login — email + password + TOTP code (no QR)
- [ ] Dashboard stats load from `/admin/stats`
- [ ] Users: ban/unban test user; plan change for owner (STARTER → PRO)
- [ ] Restaurants, bookings, subscriptions, audit logs pages load with pagination
- [ ] `CORS_ORIGIN` includes admin panel URL in production
- [ ] `VITE_API_URL` set in Vercel for `apps/admin` (separate project from web/dashboard)
- [ ] Admin panel deployed to Vercel (port 5175 in dev)
