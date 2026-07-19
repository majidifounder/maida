# Spec · Platform (Composition, Middleware, Env, Redis, Deployment Contract)

> Owns: `apps/api/src/index.ts`, `apps/api/src/env.ts`, `apps/api/src/lib/{redis,logger,cloudflare,threat-detector,handle-route-error}.ts`,
> `apps/api/src/plugins/cloudflareOnly.ts`, `packages/db`, `packages/types`, CI/deploy workflows
> Related: every other spec — this is the substrate they run on

## Purpose

Compose the single Fastify process, validate its environment, own the shared Redis/Prisma
substrate and the security middleware chain, and define the deployment contract the code
assumes.

## Architecture (stable — do not silently break)

1. **One process, one composition root.** `buildServer` (`index.ts:79`) registers
   everything; there is no gateway/mesh. **Middleware registration order is load-bearing**
   (raw `/health` → helmet → cors → cookie → rateLimit → sensible/multipart → UA block →
   IP ban → threat recorder → onSend headers → method-override block → route plugins,
   `index.ts:88-250`). Two hard rules with history:
   - the `onSend` hook must stay **async and return the payload** (`:210-224`; a sync
     version once hung every response — VALIDATION #1);
   - `/health` is answered at the raw `http.Server` layer (`serverFactory`, `:88-97`, D-3)
     so liveness can never block on Fastify/Redis.
2. **Layering law** (CI-F1): `routes → service → lib → db`; `lib/*` and `services/*`
   never import `modules/*`; the only cross-module edges point at `subscription.service`.
   Enforced structurally by the drift-guard layering check
   (`scripts/spec-drift-check.mjs`, runs in CI) — if it blocks you, your code is in the
   wrong layer; do not weaken the check.
3. **Env is validated at boot** (`env.ts:3-63`, `process.exit(1)` on failure); JWT PEMs get
   `\n` normalization. Every new env var goes through the `env.ts` schema — never
   `process.env.X` inline — and prod deploys additionally pass `check-env`
   (`scripts/check-env.ts`: pgbouncer flag, Upstash `noeviction` probe, `CF_ORIGIN_SECRET`).
4. **Redis is one shared keyspace with distinct correctness classes** (HC-1/SYS-2):
   security-authoritative (`deny:`, `login:*`, `ban:`), exactly-once (`ls-event:`,
   `notify:`), disposable cache (`restaurant:*:availability*`), plus `email_verify:`,
   `pwd_reset:`, `admin:totp:setup:`, `queue:rate:`, `threat:*`. **Rule: never mint a new
   key prefix at a call site without adding it to this list** and choosing an explicit TTL;
   assume `noeviction`. Client: fail-fast singleton with connection coalescing
   (`redis.ts:99-129`, D-4); pub/sub uses a dedicated subscriber client (D-6).
5. **Fail-open vs fail-closed is a deliberate per-concern decision** ([01 §8](../01-system-map.md)):
   auth revocation = fail-closed 503 (INV-5); rate limit, cache, queue, pubsub, notify,
   threat = fail-open. When adding a Redis-dependent feature, *choose and document* its
   class in the same PR.
6. **Trust chain**: `trustProxy:true` + `getRealIp` trusts `CF-Connecting-IP`, verified
   against `x-cf-origin-secret` only when `CF_ORIGIN_SECRET` is set (`cloudflare.ts:24-38`,
   H-1); `cloudflareOnly` is a no-op outside prod-with-secret (`cloudflareOnly.ts:28`).
   Use `getRealIp` for any IP-keyed logic (D-14 is the one legacy exception).
7. **Single-instance assumption is real** (SI-1..9/SYS-1): per-IP WS caps, pub/sub listener
   map, non-prod rate limiter are in-process. Until that changes, deploy exactly one API
   instance; any new in-process state deepens the constraint — prefer Redis.
8. **Deployment contract** (CI-E1/E2/E7, details in [06](../06-pipeline-review.md)):
   schema migrates **before** code deploys (workflows run `prisma migrate deploy`; the app
   never migrates at boot); runtime DB URL is pooled 6543 + `?pgbouncer=true`, migrations
   use `DIRECT_DATABASE_URL`; `railway up --detach` does not verify boot (PIPE-10) — treat
   green CI as "gate passed", not "prod healthy".
9. **Test composition gap (SYS-3, accepted debt):** `buildTestServer`
   (`__tests__/helpers/server.ts`) omits rate-limit/CORS-allowlist/helmet-CSP/threat/onSend/
   method-override/WS/admin. Anything you add to `buildServer` is **untested by default** —
   either add it to the test server too or note the gap against GT-3..GT-6.

## Boundaries

- `packages/db` exposes the Prisma singleton; `withUserContext` exists but is unused (RLS
  inactive, L-2/DC-3) — do not call it casually, activating RLS is a deliberate project
  (SYS-7).
- `packages/types` is hand-written and must mirror Prisma enums/zod shapes (HC-7) — update
  it in the same commit as any enum/shape change.
- Errors: throw `AppError` subclasses; map Prisma errors via `mapPrismaError`
  (`handle-route-error.ts:16-44`); route-level 422 shape is `{error:'Validation failed',
  details}` (CI-F2 — admin drifts, align opportunistically).

## Verified invariants (guards in [../INVARIANTS.md](../INVARIANTS.md))

| ID | Statement | Anchor |
|---|---|---|
| INV-5 | Auth infra failure → 503, never grant | `authenticate.ts:90-98` (owned by auth spec, enforced by this substrate) |
| D-3 | Liveness independent of framework/Redis | `index.ts:88-97` |
| CI-F1 | Downward-only layering | drift-guard layering check (`scripts/spec-drift-check.mjs`) + grep evidence [02 §1](../02-dependency-graph.md) |

## Implementation details (volatile)

Helmet directives, UA blocklist regexes, ban thresholds, rate-limit numbers, logger
redaction list (`logger.ts:5-19` — query strings NOT redacted, H-2), audit retention
defaults, Turnstile gating.

## Extension points — where new code belongs

- **New module**: `apps/api/src/modules/<name>/{routes,service,schema}.ts`, registered in
  `buildServer` **and** `buildTestServer`; cross-module imports only toward
  `subscription.service` unless this spec is amended.
- **New shared infra concern**: `apps/api/src/lib/` (no module imports), with its Redis
  prefixes registered in §4 and its failure class chosen per §5.
- **New env var**: `env.ts` schema + `.env.example` + (if prod-critical) `check-env`.
- **New workflow/CI step**: keep the gate order (lint→typecheck→test→build→check-env→
  migrate→deploy) and both deploy workflows in parity (PIPE-6 is the known staging gap).

## Evolution guidance

- Intentionally flexible: middleware tuning values, header sets, logger config.
- De-singletoning (SYS-1) and the Redis key registry (SYS-2) are the sanctioned structural
  evolutions of this spec — when they land, rewrite §4/§7 here, not just the code.

## Common mistakes

- Registering a route plugin before the security middleware (order §1), or adding an
  onSend/onRequest hook that isn't async-returning.
- Reading `process.env` directly (bypasses boot validation) or adding a prod-critical var
  without `check-env`.
- Minting Redis keys inline without registering the prefix (§4) — the availability cache,
  deny-list, and idempotency keys all share one memory budget and eviction policy.
- Treating CI green as production health (PIPE-10) — the deploy is fire-and-forget.
- Adding in-process state (Maps, counters, caches) without recording the single-instance
  implication (SI list).

## Open findings (see [../BACKLOG.md](../BACKLOG.md))

SYS-1 (singleton), SYS-2 (keyspace), SYS-3 (test composition), SYS-4/5 (pipeline),
H-1 (IP trust), L-3 (CORS no-Origin), P2-12 (CORS 500), L-6 (health env leak),
M-4 (fail-open limits), P2-5 (bcryptjs), L-2 (RLS unused).

## Anchors

`index.ts:37-373` · `env.ts:3-68` · `redis.ts:5-149` · `cloudflare.ts:24-49` ·
`cloudflareOnly.ts:6-35` · `logger.ts:5-19` · `threat-detector.ts:5-38` ·
`handle-route-error.ts:16-44` · `packages/db/src/index.ts:6-22` · `railway.json` ·
`.github/workflows/*.yml` · `scripts/check-env.ts:61-83` · `docker-compose.yml`
