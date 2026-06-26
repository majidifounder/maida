# Launch Checklist
<!-- Work through this top to bottom before going live. Check each box. -->

## 1 · GitHub repository settings

- [ ] **Branch protection on `main`:** Settings → Branches → Add rule
  - Require pull request before merging ✓
  - Require status checks to pass: `lint`, `typecheck`, `test`, `build` ✓
  - Require branches to be up to date before merging ✓
  - Do not allow bypassing the above settings ✓
- [ ] **Environments created:** `staging` and `production` (Settings → Environments)
- [ ] **Required reviewers on `production` environment:** at least 1 person

## 2 · GitHub Secrets (Settings → Secrets and variables → Actions)

### Staging environment secrets
- [ ] `STAGING_RAILWAY_TOKEN` — Railway API token for staging service
- [ ] `STAGING_DATABASE_URL` — Supabase pooled URL for staging project
- [ ] `STAGING_DIRECT_DATABASE_URL` — Supabase direct URL (port 5432) for staging
- [ ] `STAGING_REDIS_URL` — Upstash Redis URL for staging
- [ ] `STAGING_JWT_PRIVATE_KEY` — RS256 private key for staging (PKCS#8 PEM)
- [ ] `STAGING_JWT_PUBLIC_KEY` — RS256 public key for staging
- [ ] `STAGING_RESEND_API_KEY` — Resend API key
- [ ] `STAGING_EMAIL_FROM` — e.g. `noreply@staging.yourdomain.com`
- [ ] `STAGING_CORS_ORIGIN` — staging frontend URLs, comma-separated

### Production environment secrets
- [ ] `PROD_RAILWAY_TOKEN` — Railway API token for production service
- [ ] `PROD_DATABASE_URL` — Supabase pooled URL (production project, port 6543)
- [ ] `PROD_DIRECT_DATABASE_URL` — Supabase direct URL (port 5432)
- [ ] `PROD_REDIS_URL` — Upstash Redis URL (production instance)
- [ ] `PROD_JWT_PRIVATE_KEY` — fresh RS256 private key for production
- [ ] `PROD_JWT_PUBLIC_KEY` — corresponding public key
- [ ] `PROD_RESEND_API_KEY` — Resend API key (production)
- [ ] `PROD_EMAIL_FROM` — e.g. `noreply@yourdomain.com` (must be verified in Resend)
- [ ] `PROD_CORS_ORIGIN` — production frontend URLs only (no localhost)

### Vercel secrets (repository-level)
- [ ] `VERCEL_TOKEN` — Vercel personal access token
- [ ] `VERCEL_ORG_ID` — from `vercel whoami --json`
- [ ] `VERCEL_PROJECT_ID_WEB_STAGING` — from Vercel project settings (staging web)
- [ ] `VERCEL_PROJECT_ID_WEB_PROD` — from Vercel project settings (prod web)
- [ ] `VERCEL_PROJECT_ID_DASHBOARD_STAGING` — from Vercel project settings (staging dashboard)
- [ ] `VERCEL_PROJECT_ID_DASHBOARD_PROD` — from Vercel project settings (prod dashboard)

## 3 · Supabase (production project)

- [ ] New Supabase project created for production (separate from dev)
- [ ] Migrations applied: `DATABASE_URL=$PROD_DIRECT_DATABASE_URL pnpm --filter @restaurant/db db:migrate`
- [ ] Seed script reviewed — do NOT run the dev seed in production
- [ ] Database backups enabled (Supabase dashboard → Settings → Backups)
- [ ] Connection pooling confirmed (port 6543 in `DATABASE_URL`)

## 4 · Upstash (production instance)

- [ ] New Upstash Redis database created for production (separate from dev)
- [ ] Eviction policy: `noeviction` (not `allkeys-lru`) — rate limit keys must not be silently deleted
- [ ] Max memory confirmed sufficient for expected concurrent sessions

## 5 · Resend (email)

- [ ] Domain verified in Resend dashboard (DNS: SPF, DKIM, DMARC)
- [ ] `EMAIL_FROM` address matches verified domain
- [ ] Test email sent manually via `POST /bookings` end-to-end

## 6 · RS256 keys (production)

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
- [ ] Public key confirmed to match private key:
  `openssl rsa -in prod-private.pem -pubout | diff - prod-public.pem`

## 7 · Rate limiting

- [ ] `CORS_ORIGIN` contains production domains only — NO `localhost`
- [ ] Global rate limit (100 req/min) reviewed for expected traffic; adjust if needed
- [ ] Login rate limit (5 attempts / 15 min) confirmed active in production logs

## 8 · Run all checks locally

```bash
# All 148 tests pass
pnpm --filter @restaurant/api test

# Load test passes (API must be running)
pnpm load-test

# No missing env vars
NODE_ENV=production pnpm check-env

# Typecheck clean
pnpm typecheck

# Build clean
pnpm build
```

- [ ] All 148 tests passed
- [ ] Load test passed (correct 201/409 split, slot.available = 0)
- [ ] check-env passed with production values
- [ ] Typecheck: 0 errors
- [ ] Build: 0 errors

## 9 · Staging smoke test

After first staging deploy:

- [ ] `GET /health` → `{ "status": "ok", "checks": { "database": "ok", "redis": "ok" } }`
- [ ] Register a new account → confirm email arrives via Resend
- [ ] Create a restaurant → add slots → make a booking → confirm via owner dashboard
- [ ] WebSocket: owner dashboard shows new booking without page refresh
- [ ] Cancel booking → confirm available count updates

## 10 · Production go-live

- [ ] Staging smoke test passed
- [ ] DNS pointed to production services
- [ ] `GET https://api.yourdomain.com/health` returns 200
- [ ] End-to-end smoke test repeated on production
- [ ] Announce 🎉
