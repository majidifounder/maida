# Spec · Authentication & Session

> Owns: `apps/api/src/modules/auth/*`, `apps/api/src/lib/jwt.ts`, `apps/api/src/lib/cookies.ts`,
> `apps/api/src/plugins/authenticate.ts` · Client session: `packages/api-client/src/session.ts`
> Related: [platform.md](platform.md) (middleware order, Redis), [admin.md](admin.md) (shares token infra, UD-2)

## Purpose

Issue, verify, rotate, and revoke user credentials (diner/owner/admin), and gate every
authenticated route. Also owns registration, login lockout, password reset, and email
verification.

## Responsibilities

- Registration (`POST /auth/register` → 201 `{user}`, **no auto-login**) with optional
  Turnstile and best-effort email verification issue (`auth.service.ts:81`).
- Login with constant-time bcrypt against a dummy hash when the user is absent
  (`auth.service.ts:217-219`) and Redis-backed lockout (skipped when `NODE_ENV==='test'`).
- Token pair issue/refresh/revoke; password forgot/reset (enumeration-safe); verify-email.
- Request authentication + role gating for every other subsystem via
  `fastify.authenticate` / `fastify.requireRole` decorators (`plugins/authenticate.ts:23,113`).

## Architecture (stable — do not silently break)

1. **Two-token model.** RS256 access token (15 min, in response **body**, held in client
   memory only) + refresh token (7 d, only in the `__Host-refresh` HttpOnly/Secure cookie,
   also stored **hashed** in `refresh_tokens`). Both signed with the *same* keypair —
   which is why type discrimination (INV-3) is load-bearing.
2. **Verification is two-step**: JWT signature/type check (`lib/jwt.ts`), then per-request
   Redis deny-list + DB account check in `authenticate` — and that second step is
   **fail-closed**: infra failure → 503, never 401, never silent grant (INV-5).
3. **Rotation is race-safe by construction**: the old refresh row is consumed with
   `deleteMany({id})` + `count===0 → 401` *inside* the transaction (INV-4) — atomic
   single-use, not check-then-delete.
4. **Roles are exact strings** `diner|owner|admin` compared verbatim in `requireRole`
   (`authenticate.ts:113-123`). There is no hierarchy; do not invent one implicitly.
5. Logout deny-lists the access `jti` in Redis for its remaining TTL **and** revokes the
   refresh row (`auth.service.ts:344`). Password reset deletes **all** refresh rows in a tx
   (`auth.service.ts:494-511`) — but *not* live access tokens (open finding M-3).

## Boundaries

- May import: `lib/{redis,jwt,logger,cloudflare}`, `services/email.service`, `@restaurant/db`,
  `errors`, `env`. Must **not** import other `modules/*` (verified downward-only layering,
  [02 §1](../02-dependency-graph.md)).
- Other modules consume auth **only** through the request decorators
  (`request.user`, `request.emailVerified`) — never by importing `auth.service` (B-1).
- Trust boundary: everything before `authenticate` runs is untrusted; `request.user!.sub`
  is the only legitimate user identity (body-supplied user ids are never accepted).

## Verified invariants (see [../INVARIANTS.md](../INVARIANTS.md) for guard mapping)

| ID | Statement | Anchor |
|---|---|---|
| INV-3 | Token type confusion rejected both directions; algorithms pinned `['RS256']` | `lib/jwt.ts:48-59,69-77` |
| INV-4 | Refresh rotation is atomic single-use (`deleteMany` + count check in tx) | `auth.service.ts:311-316` |
| INV-5 | Auth never granted on infra failure — 503 after bounded retry (2×) | `authenticate.ts:19-20,63-98` |
| CI-H4 | `__Host-refresh` cookie: HttpOnly, Secure (always, even dev), Path=/ | `lib/cookies.ts:3-11` |

## Implementation details (volatile — may change if invariants hold)

Login lockout thresholds and Redis key names (`login:fail:`/`login:locked:`); bcrypt via
`bcryptjs` on the event loop (accepted finding P2-5); reset/verify token TTLs (1 h / 24 h);
the login route's use of `request.ip` instead of `getRealIp` (D-14 — an inconsistency, not
a contract); dummy-hash caching (`_dummyHash`, SI-8).

## Extension points — where new code belongs

- **New authenticated route (any module):** use `preHandler:[fastify.authenticate,
  fastify.requireRole('<role>')]`. Never re-verify JWTs manually; never read the
  Authorization header outside the plugin.
- **New credential flow** (e.g. magic link): new functions in `auth.service.ts` + routes in
  `auth.routes.ts`; single-use server-side state goes in Redis under a **new registered
  prefix** (see [platform.md](platform.md) → Redis keyspace rule); tokens must be single-use
  via atomic consume (`SET NX` / `GETDEL`), mirroring INV-4's pattern.
- **New claims:** add to both `signAccessToken` payload and the `JWTPayload` type
  (`packages/types`); consider deny-list interaction before extending TTLs.

## Evolution guidance

- Intentionally flexible: lockout policy, email templates, TTL values, Turnstile gating.
- If refresh-token **family reuse detection** is added (open L-5/CI-H2), build it on the
  existing rotation point (`auth.service.ts:295-316`) — the single place a stale token is
  observed.
- If access-token revocation on password reset is added (M-3/CI-H1), reuse the logout
  deny-list mechanism; do not invent a second revocation channel.

## Common mistakes

- Assuming a valid RS256 signature ⇒ valid access token — refresh tokens verify too;
  the `type`/`role` checks are the actual gate (INV-3).
- Returning 401 on Redis failure. 401 means *bad credential*; infra failure must stay 503
  (INV-5) or an outage logs every user out (historical P0-2).
- Putting the refresh token anywhere but the cookie (body/localStorage), or issuing it
  without hashing the stored copy.
- Adding a per-route rate limit keyed on `request.ip` — use `getRealIp` (D-14 is the one
  legacy inconsistency; do not copy it).
- Testing auth behavior and forgetting `NODE_ENV==='test'` disables lockout & threat
  detection (CI-F6) — a passing test may not exercise the guard at all.

## Open findings (do not fix in passing — see [../BACKLOG.md](../BACKLOG.md))

M-3/CI-H1 (reset leaves access tokens live) · L-5/CI-H2 (no reuse-family detection) ·
M-4 (lockout/rate-limit fail open) · H-2/P2-9 (WS token in query string) · D-14
(`request.ip` on login) · L-3 (CORS no-Origin allowed).

## Anchors

`apps/api/src/modules/auth/auth.routes.ts:21-299` · `auth.service.ts:29-511` ·
`apps/api/src/lib/jwt.ts:6-78` · `apps/api/src/lib/cookies.ts:3-11` ·
`apps/api/src/plugins/authenticate.ts:9-123` · `packages/api-client/src/session.ts` ·
guards: `apps/api/src/__tests__/guards/auth.guard.test.ts`
