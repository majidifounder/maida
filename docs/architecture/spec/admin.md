# Spec · Administration

> Owns: `apps/api/src/modules/admin/*`, `apps/api/scripts/admin-totp-setup.ts`,
> `scripts/promote-admin.ts` · SPA: `apps/admin` (prod-only deploy)
> Related: [auth-session.md](auth-session.md) (shared token infra, UD-2),
> [billing.md](billing.md) (plan override semantics)

## Purpose

Internal, TOTP-gated operator surface: inspect users/restaurants/reservations, ban users,
override subscription plans, and answer support questions — with a deliberately higher
authentication bar than the public product.

## Responsibilities

- `POST /admin/auth/login` (rate-limited 5/15 min): bcrypt (dummy-hash constant-time) →
  role must be ADMIN → TOTP verify, or first-login TOTP enrollment via QR + `pendingToken`
  (Redis `admin:totp:setup:{token}`, 10 min) (`admin.service.ts:28-101`).
- Read/list endpoints and mutations (ban = set `users.deletedAt`, plan override), all
  `[authenticate, requireRole('admin')]` (`admin.routes.ts:173+`).

## Architecture (stable — do not silently break)

1. **Admin is not a separate credential universe** (UD-2): it reuses `signAccessToken`/
   `signRefreshToken`, the same `refresh_tokens` table, the same deny-list. What
   distinguishes admin is the **role claim** + **TOTP** + tighter response discipline
   (refresh token cookie-only, omitted from body — `admin.routes.ts:104,159`). Any change
   to shared token infra ([auth-session.md](auth-session.md)) lands on admins too.
2. **Admin bootstrap is out-of-band by design**: promotion via `scripts/promote-admin.ts`,
   TOTP binding via script or the first-login enrollment path. The enrollment path is the
   documented M-2 exposure (self-enroll before a secret exists); treat any change to it as
   security-review-required.
3. **Ban is soft**: `deletedAt` doubles as the ban flag (`admin.service.ts:290`,
   `schema.prisma`); `authenticate`'s DB account check is what enforces it at request time.
4. **Plan override writes both `plan` and `status:'ACTIVE'`** (`admin.service.ts:347-351`,
   X-7) — an override must produce an operable owner; keep the pair atomic.
5. Enumeration hygiene: admin accounts are excluded from the public forgot-password flow
   (`auth.service.ts:433-438`).

## Boundaries

- Imports: `lib/{redis,jwt}`, `@restaurant/db` only. No other module may import
  `admin.service`; admin may read any tenant's data (that is its purpose) but only behind
  `requireRole('admin')`.
- The admin SPA deploys to production only (`deploy-prod.yml:194-205`) — there is no
  staging admin; account for that when changing admin-facing APIs.

## Verified invariants (guards in [../INVARIANTS.md](../INVARIANTS.md))

| ID | Statement | Anchor |
|---|---|---|
| — | Admin routes require `requireRole('admin')` — owner/diner tokens rejected | `admin.routes.ts:173` |
| — | Admin login requires ADMIN role + TOTP once enrolled (`window:1`) | `admin.service.ts:26,55-85` |
| X-7 | Plan override sets `status:'ACTIVE'` with the plan | `admin.service.ts:347-351` |

**Testing caveat (SYS-3):** `buildTestServer` does **not** register `adminRoutes`, so the
admin subsystem has no integration coverage today; the role-gate guard is expressed at the
JWT/role level in the guard suite, and full admin guards (GT-5) are blocked on unifying the
test composition. Do not claim test coverage for admin behavior until that lands.

## Implementation details (volatile)

QR provisioning format, pending-token TTL, list pagination shapes, the deprecated
`/admin/bookings` alias (DC-8), inconsistent 422 error shape vs other modules (CI-F2 —
align opportunistically when touching a route, do not mass-rewrite).

## Extension points — where new code belongs

- **New admin capability**: service function in `admin.service.ts` + route under
  `[authenticate, requireRole('admin')]`; every mutation writes an audit row (follow
  existing audit calls); destructive operations should be soft (mirror the ban pattern).
- **New admin role tier** (support vs superadmin): extend the `Role` enum and
  `requireRole` usage — do not build a parallel permission system.

## Evolution guidance

- Intentionally flexible: list/query shapes, dashboard payloads, audit verbosity.
- Closing M-2 (enrollment hardening) and CI-H3 (TOTP used-code cache) are the two known
  security evolutions; both live entirely inside `admin.service.ts` login/setup and should
  come with the GT-5 guard tests.

## Common mistakes

- Adding an admin route without `requireRole('admin')` because "it's registered under
  /admin" — the prefix is not a gate; the preHandler is.
- Returning the admin refresh token in a response body (the cookie-only discipline is
  deliberate).
- Hard-deleting users instead of the `deletedAt` soft-ban (breaks FK-heavy history and the
  authenticate-time enforcement point).
- Writing `plan` without `status` on overrides (regresses X-7 / P1-7).
- Assuming the test suite covers a new admin route — it does not (SYS-3), verify manually
  until GT-5 exists.

## Open findings (see [../BACKLOG.md](../BACKLOG.md))

M-2 (self-enroll + unthrottled setup route) · CI-H3 (TOTP replay within window) · CI-F2
(422 shape drift) · GT-5 (no admin integration coverage — blocked on SYS-3).

## Anchors

`admin.routes.ts:29-341` · `admin.service.ts:26-421` · `scripts/promote-admin.ts` ·
`apps/api/scripts/admin-totp-setup.ts` · `deploy-prod.yml:194-205` · guards:
`__tests__/guards/auth.guard.test.ts` (role gate)
