# PLATFORM MASTER PLAN — Maida

*Written 2026-07-10, derived entirely from source code in this repository (including the then-uncommitted "Phase 17" working tree). File-level system documentation lives in [PLATFORM_REVIEW.md](PLATFORM_REVIEW.md); this document assumes that baseline and goes further: it judges the business, the product, and the architecture, and lays out the path to market leadership. Nothing here defers to existing decisions.*

> **Execution log (updated 2026-07-10, same day):** Phase A is largely done and committed to `main`:
> **R1** Phase 17 committed; `lsUpdatedAt` webhook ordering guard wired (transactional, stale events dropped, test-covered); admin plan override now sets `status: ACTIVE` (comps actually work).
> **R2** New `@restaurant/api-client` workspace package (single-flight refresh, 401→refresh→replay, proactive refresh + focus recovery, session-death only on server rejection; 14 unit tests). All three SPAs consume it via their old import paths; the dashboard WebSocket reconnects with a fresh token on close 4001. **The 15-minute session death is fixed.**
> **R3** WeeklySchedulePanel (per-day multi-window editor, overnight, closures) shipped in the dashboard; config panel no longer sends open/close (schedule-wipe footgun closed); server rejects overlapping same-day windows; diner app consumes `serviceWindows[]`, `bookable`/`notice`, and the authoritative `offersCustomReservations` flag; until-close now caps at the *containing* window on split-service days.
> **R5** CI runs the full integration suite against ephemeral Postgres 16 + Redis 7 with migrations and generated keys.
> **R6** Maintenance worker (BullMQ schedulers): reservation status reconciliation + hold release every 5 min (keeps the partial GiST index small), daily refresh-token purge and audit-log retention (`AUDIT_LOG_RETENTION_DAYS`). Adjacent-day availability-cache invalidation fixed.
> **R7 (part)** Day-of reminder emails (24h/2h lead, cancel-safe, ICS calendar attachment on confirmations). *Email verification at signup is still open.*
> **R4 (2026-07-10, later the same day)** — the dashboard service view shipped: `/restaurants/:id/service` built to `maida-brand-guidelines.md` v3.0 (monochrome system, DM type, status = color+icon+label), with the full UX charter in `docs/R4-SERVICE-UX.md`. Day book grouped by operational relevance, walk-in + phone-booking dialogs (409 → one-tap "book the suggested time"), optimistic lifecycle actions with two-step inline arming for destructive ones (undo deliberately deferred until reinstatement endpoints exist — documented), free-tables-now strip, time-left on seated rows, keyboard shortcuts, adjacent-day prefetch, WS + 60s poll safety net. Supporting API: `rawStatus` exposed, day-list limit → 100. Detail page is now pure settings. Dashboard fully de-blued. R4 self-critique (§13 of the UX doc) feeds R4.1: table-occupancy overview refinements, waitlist tie-in, multi-device race UX.
> **R7b/R8/R15 (2026-07-10, same day)** — Email verification shipped: gates booking (diners) and restaurant creation (owners), never the session; 24h single-use links, resend banners in both apps, grandfathered existing accounts, zero-extra-query enforcement, integration-tested. Billing coherence shipped: trial = full PRO for 14 days; EXPIRED = locked like an expired trial (free-forever loophole closed, existing-reservation management retained); quota exhaustion shows diners a neutral message and emails the owner once/month the moment bookings start bouncing. Edge hardening shipped: CF-Connecting-IP only trusted with proven Cloudflare provenance (x-cf-origin-secret, timing-safe); check-env blocks prod deploys missing CF_ORIGIN_SECRET or pgbouncer=true on the transaction pooler.
> **Still open:** search fan-out precompute (R15 remainder), web/admin brand rollout, R4.1 service-view items, R9 widget/SSR page (next wedge milestone). **Founder decisions pending:** the pricing-axis change to flat per-location tiers (requires new Lemon Squeezy products — see §11/R8; everything code-side that didn't change price points is done), and applying the two pending migrations to the dev DB (`pnpm db:migrate`: service schedule + email verification).
> **Operator action required:** the new migration is not yet applied to the dev database — run `pnpm db:migrate` (it was permission-gated for the agent). The API integration suite needs it locally; CI is self-contained.

---

## 1. Executive Summary

Maida is a multi-tenant restaurant reservation SaaS: restaurant owners subscribe (€29/€79/€199 via Lemon Squeezy), configure tables/hours/turn times, and take reservations; diners book free through a consumer web app. The engineering core — availability computed by real time-interval overlap against discrete physical tables, with double-booking made impossible by a PostgreSQL GiST exclusion constraint — is **architecturally correct and better than most early-stage competitors build**. The security posture (RS256 + rotation, admin TOTP, threat detection, constant-time auth, strict headers) is top-decile for this stage.

**But the product, as scoped today, is a "reservation link," not a restaurant operating system.** It is missing the four things restaurants actually pay premium prices for:

1. **Service-floor operations** — there is no way for a host to run a Friday night on it (no walk-in UI, no timeline/floor view, no pagination past the 20 oldest reservations).
2. **No-show protection** — no deposits, no card guarantee, no reminders. This is the #1 monetizable pain in the industry, and Maida's "informational fees" don't touch it.
3. **Guest intelligence** — no guest profiles, visit history, tags, or notes. Reservations reference a platform user or a bare `guestName` string.
4. **Distribution** — the booking flow only exists inside Maida's own consumer app, which has no reviews, no photos beyond a logo, no SEO (client-rendered SPA), and no reason for diners to visit. Meanwhile there is no embeddable widget for the restaurant's own website and no Reserve-with-Google integration — the two channels that actually feed independent restaurants.

**The verdict up front:** the codebase is a strong foundation and should *not* be rebuilt — but the *vision must pivot*. Maida cannot win a demand-side marketplace war against OpenTable, TheFork, and Google. It **can** win the B2B game for independent restaurants and small groups: direct-channel bookings (widget + Google), floor operations, no-show economics, and guest CRM, at a fair flat price. That is the path this document designs. With the pivot and 12–18 months of focused execution, this can be a leading platform in a defensible segment; without it, it will be a demo-quality booking site with excellent plumbing.

---

## 2. What the Platform Is Today

### 2.1 System in one paragraph

pnpm/Turborepo monorepo, TypeScript throughout. One Fastify 5 API (`apps/api`) with Prisma 5 → Supabase Postgres, ioredis → Upstash, BullMQ → Resend emails, WebSocket live-updates to the owner dashboard. Three React 18 + Vite SPAs: `web` (diner), `dashboard` (owner), `admin` (internal, TOTP-gated). Billing via Lemon Squeezy webhooks. Deploy intent (from workflows/checklist): Railway (API) + Vercel (SPAs) + Cloudflare in front. Full detail: [PLATFORM_REVIEW.md](PLATFORM_REVIEW.md) Part 1.

### 2.2 The engine (the crown jewel)

- Atomic bookable units = physical tables (`dining_tables`) plus owner-predefined combinations (FLEXIBLE mode, plan-gated).
- Every reservation writes one hold row per table (`reservation_tables`) carrying its `[startsAt, endsAt)` interval; a GiST `EXCLUDE` constraint over `(tableId, tstzrange)` where `releasedAt IS NULL` makes overlapping holds impossible *by construction* — no application locking, no race windows. Conflicts surface as SQLSTATE 23P01 → HTTP 409 with a `suggestedNextAvailableAt`.
- Durations from party-size turn-time rules; timezone math via a dependency-free `Intl` implementation; availability walked in 15-minute steps over per-weekday service windows, Redis-cached 300 s.
- As of the Phase 17 working tree: per-weekday multi-window schedules with overnight support (`service_periods`), blackout dates (`restaurant_closures`), and — finally — *server-side* enforcement that bookings fall inside opening hours.

This is the same architectural shape the mature players converged on. Keep it. Everything in this plan builds *on* it, not around it.

### 2.3 Where the working tree actually stands (important)

The repo contains uncommitted Phase 17 work that resolves most of the audit's P0s. A new team must know what is done vs. half-done vs. untouched:

| Area | Status in working tree |
|---|---|
| Weekly schedule + closures + overnight windows, server-side window check | ✅ Backend done (API endpoints exist), **no owner UI, diner UI unaware of multi-window days** |
| Cross-tenant `tableIds` validation; staff/walk-in hardening | ✅ Done |
| Email timezone correctness; walk-in ghost emails removed | ✅ Done |
| Auth returns 503 (not 401) on Redis/DB outage | ✅ Done |
| Race-safe refresh rotation | ✅ Done (server side) |
| Diner abuse guards (365-day horizon, overlap block, 20-active cap, 12/min rate limit); quota excludes CANCELLED/NO_SHOW; advisory-lock exact quota | ✅ Done |
| Suggestion scan efficiency (1 query/day, 14-day scan) | ✅ Done |
| Prisma error → 4xx mapping (bad UUIDs, unique/check violations) | ✅ Done |
| Custom-reservation gating unified (`offersCustomReservations` server flag) | ✅ Done — **diner UI still infers from fees** |
| Lapsed owners can manage existing reservations; unbookable restaurants signal `bookable:false` | ✅ Done — **diner UI doesn't render the notice yet** |
| Alerting (`ALERT_WEBHOOK_URL`), worker split-out (`RUN_WORKER_IN_PROCESS`), fatal-error hooks | ✅ Done |
| **Frontend 15-minute session death** (no 401→refresh→retry, WS terminal on close 4001) | ❌ **Untouched — still the worst live bug** |
| **Lemon Squeezy out-of-order webhook guard** | ⚠️ **Half-done: `lsUpdatedAt` column migrated but no code reads or writes it** |
| Search-with-availability fan-out (~3×100 queries, anonymous, uncached) | ❌ Open |
| Owner reservation list (20 oldest, no pagination, browser-tz, no walk-in/override/extend UI) | ❌ Open |
| `CF-Connecting-IP` trusted unconditionally; `CF_ORIGIN_SECRET` optional | ❌ Open |
| PgBouncer `?pgbouncer=true` undocumented/unvalidated | ❌ Open |
| CI runs the test suite with no database → integration tests cannot pass in CI | ❌ Open |
| No status reconciliation (rows stay SCHEDULED/SEATED forever; display-layer lies) | ❌ Open |
| No cleanup jobs (refresh_tokens, audit_logs, released holds grow unboundedly) | ❌ Open |

**First action for any team: commit Phase 17** (it is coherent and reviewed here), then finish its two loose ends (session refresh, `lsUpdatedAt` wiring) before anything new.

---

## 3. Product Vision

### 3.1 What the vision is today (implicit in the code)

A two-sided mini-marketplace: diners browse/search restaurants on Maida's own site and book; owners pay monthly for the privilege of being bookable. Plan tiers gate *operational capacity* (tables, reservations/month, combinations).

### 3.2 Why that vision fails

- **Demand-side cold start.** A marketplace is only worth joining if diners are there. Diners have zero reason to visit Maida: no reviews, no photos (one logo), no editorial content, no loyalty points, no SEO surface at all (the diner app is a client-rendered SPA — Google sees an empty div; there isn't even a slug-based public URL endpoint despite slugs existing in the schema). OpenTable spent two decades and billions building diner demand; TheFork burns discount programs to hold it; Google gives it away inside Maps. Competing here as a bootstrapped entrant is strategically hopeless.
- **Quota pricing punishes success.** Charging by reservations/month makes the product more expensive precisely when it's delivering value, and creates the perverse failure mode the code had to defend against: hostile bookings burning an owner's quota so *real* diners see "the owner needs to upgrade" (a message that leaks a restaurant's billing status to the public — trust-destroying).
- **The paying customer's core need is unserved.** Owners pay to (a) fill seats they wouldn't have filled, (b) not get burned by no-shows, (c) run service smoothly. Today Maida offers (a) only via its own empty marketplace, (b) not at all, (c) partially in the API but not in the UI.

### 3.3 What the vision should become

**"The reservation and guest platform for independent restaurants — bookings from the restaurant's own channels, zero double-bookings, fewer no-shows, and a guest book that compounds."**

Concretely, the product becomes four surfaces on the same engine:

1. **Direct-channel booking**: an embeddable JS widget + a hosted, server-rendered public booking page per restaurant (`book.maida.app/{slug}`) + **Reserve with Google** feed. The restaurant's Instagram bio, website, and Google Maps listing all funnel into Maida's engine. The diner marketplace app is *demoted* to a nice-to-have directory built on the same public pages — not the strategy.
2. **Service OS (the dashboard, rebuilt around the floor)**: today-first timeline/floor view, one-tap walk-in/seat/move/free-early, waitlist, pacing controls. Must be operable on a tablet by a host during rush.
3. **No-show economics**: card-guarantee/deposits via Stripe (Maida never touching restaurant revenue changes from principle to *option* — deposits are the single strongest premium-tier feature in this industry), plus automated reminder emails/SMS with confirm/cancel links.
4. **Guest CRM**: guest profiles per restaurant (dedup by phone/email), visit history, tags (VIP, allergy, regular), notes, no-show record — the data moat that makes churn painful.

Pricing shifts from quota tiers to **flat per-location tiers** (see §5.4). The 10-year arc — chains, POS integrations, enterprise — extends naturally from this wedge (§15).

---

## 4. Business Analysis

### 4.1 Market

- ~15M restaurants worldwide; ~1M in Europe (the EUR pricing suggests Europe is the beachhead), the large majority independents with 1–3 locations — exactly the segment underserved by OpenTable's pricing and SevenRooms' enterprise sales motion.
- Realistic obtainable segment for a direct-channel-first product: independents that already get demand (from location, Instagram, Google) and need *plumbing*, not *marketing*. That's a much larger and cheaper-to-win pool than "restaurants that need OpenTable's diner network."
- Willingness to pay clusters at €40–€150/location/month for booking + no-show protection; deposits/prepayments carry transaction economics on top (Stripe fee + margin).

### 4.2 Competition

| Competitor | Strength | Weakness Maida can exploit |
|---|---|---|
| OpenTable | Diner network, brand | Per-cover fees resented; heavy; independents feel milked |
| TheFork (EU) | EU diner network | Discount-culture damages restaurant margins; owner tools weak |
| SevenRooms | Deep CRM/ops, enterprise | Expensive, sales-led; unreachable for independents |
| Resy | Brand, quality UX | US-centric, Amex-owned priorities |
| Google (Reserve with) | The actual demand pipe | Not a management system — it *needs* partners like Maida |
| Zonal/ResDiary/Quandoo etc. | Regional footholds | Dated UX, slow product velocity |
| **Squarespace/Wix bookings, generic tools** | Cheap | No real table/interval engine — Maida's core is strictly better |

Maida's honest differentiators today: correctness-by-construction engine, modern stack/velocity, price point. None of those are *visible to a restaurant owner yet*. The pivot makes them visible.

### 4.3 Business risks (beyond code)

- **Single founder/operator risk** is visible in the repo itself (Windows dev box holding production-grade `.env`, backups of real data in `backups/`, admin promotion via local scripts). Acceptable now; must be institutionalized before real restaurants depend on it (secrets manager, runbooks, second operator).
- **Lemon Squeezy** (merchant of record) is fine for SaaS fees but cannot do restaurant-side deposits — Stripe Connect becomes necessary for the no-show product; running both is added complexity that should be planned, not stumbled into.
- **Regulatory**: GDPR is unavoidable in the EU beachhead — there is currently no data-export, no right-to-erasure flow (soft-delete ≠ erasure), no consent tracking, no DPA. Not launch-blocking for a pilot; blocking for scale (§9.5).
- **Chargeback/dispute exposure** arrives with deposits — needs policy design, not just code.

---

## 5. Restaurant Operations Analysis (would a real restaurant survive on this?)

Stress-test: a 25-table bistro, Friday 19:30, one host on a tablet.

1. **Walk-in party of 4 arrives.** API supports walk-ins (`POST .../walk-in`, seats immediately, validated tables). The dashboard has **no walk-in button**. The host seats them physically; online availability still shows the table free; a double-booking *at the host stand* (not in the DB) follows. **Fail.**
2. **Host needs to see tonight's book.** The reservation list shows page 1 of 20, ordered by `startsAt` ascending **with no date filter in the UI** — i.e., the 20 *oldest reservations ever*. **Fail.**
3. **Table 12 lingers over dessert; 20:00 booking on it.** No table-move, no re-seat, no "running late" state. `extend`/`free-early` exist in the API — **no UI. Fail.**
4. **Dashboard has been open since 17:00.** Access token died at 17:15; WebSocket closed with code 4001 and never reconnects; every mutation 401s until a hard refresh. **Fail — and this one is a code bug, not a missing feature.**
5. **A 6-top no-shows.** Owner can mark NO_SHOW (exists ✅). The diner suffers no consequence, no strike, and the restaurant recovered nothing. **Economic fail.**
6. **Saturday brunch has different hours.** Phase 17 backend supports it — **no UI to configure it.** The owner would have to craft `PUT /restaurants/:id/schedule` by hand. **Fail until UI ships.**
7. **The kitchen wants max 30 covers per 15 minutes.** No pacing concept anywhere: if 8 tables are free at 19:00, 8 parties can book 19:00. The kitchen gets slammed, food quality craters, the restaurant blames Maida. **Design gap in the engine (fixable — see §11.2).**
8. **Phone rings with a booking for next month.** Staff booking API exists ✅ — no UI. **Fail.**

Conclusion: the *engine* would survive Friday night; the *product* would be abandoned by 19:45. The highest-ROI work in the entire company is the dashboard service view.

---

## 6. Journey Reviews

### 6.1 Diner journey

Good bones: party-size → time (7-day parallel availability scan, quick picks, 409-with-suggestion rebooking) → optional custom duration → confirm. Genuine care is visible (until-close bookings, `wasCapped` messaging, restaurant-tz rendering in the flow).

Broken/missing: session dies mid-flow at 15 min (P0-1, loses the selected slot on redirect); MyBookings renders times in *browser* tz (inconsistent with the flow); no modify/reschedule (cancel + race to rebook); no reminders, no .ics attachment, no add-to-calendar; no guest checkout (account required — a large conversion killer for widget bookings; the schema already allows `dinerId: null`, the policy just needs to embrace it with email/phone verification); scan dates computed from browser-UTC "today" (wrong day near midnight); no waitlist when full; quota-exhaustion message exposes the owner's billing to the public.

### 6.2 Owner journey

Onboarding (register → trial → create restaurant → tables → hours) is coherent and plan-gating is honest. But: trial limits (25 res/mo, 5 tables) are *below* evaluation threshold for a real restaurant (a busy weekend exceeds it — the trial teaches the product fails at volume); no onboarding checklist/sample data; no import from a spreadsheet/competitor; the service view fails as in §5; billing UX is solid (comparison, cancel/resume, trial banner) — genuinely fine.

### 6.3 Staff journey

Does not exist. One login = the owner. Real restaurants: host stand shares a device, manager ≠ owner, servers see today only. No roles, no per-restaurant staff accounts, no PIN-switch. This blocks any restaurant with employees — most of them (§9.1).

### 6.4 Admin/support journey

Admin app is read-mostly but real (stats, users, ban, plan override, audit logs, feedback). Missing for a support org: impersonation ("view as owner"), reservation search across tenants, refund/comp tooling, feature flags, admin plan override that actually fixes `status` (comping a TRIALING user to PRO today leaves them on trial limits — known bug).

---

## 7. SWOT

**Strengths** — exclusion-constraint engine (correct under concurrency, rare at this stage); modern typed monorepo with real integration + e2e suites; security maturity; timezone rigor (post-Phase 17); clean modular monolith that maps 1:1 to the domain; fast iteration cadence visible in git history.

**Weaknesses** — no service-floor UX; no distribution channels; email-only comms; no guest CRM; no payments/deposits; single-account tenancy; English/EUR-only mismatch; SPA-only (zero SEO); the 15-minute session bug; ops maturity (secrets on a dev laptop, CI can't run tests, no staging validation visible).

**Opportunities** — Reserve with Google is an open door for exactly this product; independents in the EU are underserved between "too cheap to be real" and "enterprise-priced"; deposits/no-show protection is monetizable immediately; the engine could power adjacent verticals later (any capacity-scheduling business).

**Risks** — incumbent bundling (Google/TheFork racing down-market); founder bus-factor; a public double-booking or wrong-time-email incident before P0-1 ships destroys word-of-mouth; Supabase/Upstash/Railway free-tier ceilings hit mid-growth; deposits bring fraud/chargeback exposure.

---

## 8. Missing Capability Inventory

Priorities: **P0** = blocks charging real restaurants; **P1** = blocks scale/retention; **P2** = blocks enterprise/long-term. Complexity: S/M/L/XL.

### 8.1 Product & operations

| Capability | Why | Pri | Cx |
|---|---|---|---|
| Dashboard service view: today-first timeline per table, walk-in/seat/no-show/extend/free-early/move, pagination, restaurant-tz | §5 — the product is unusable in service without it; API mostly exists | **P0** | M |
| Schedule & closures UI (backend shipped in Phase 17) | Owners can't reach the feature | **P0** | S |
| Reminder emails + confirm/cancel links + .ics | Single biggest no-show reducer; trivial vs. value | **P0** | S |
| Embeddable booking widget + SSR public booking page per restaurant | Distribution wedge (§3.3) | **P0** | M–L |
| Guest CRM: `guests` table per restaurant (phone/email dedup), visit history, tags, notes | Retention moat; also fixes walk-in/staff bookings referencing bare strings | **P1** | M |
| Deposits / card-guarantee (Stripe), no-show fees | Premium-tier revenue engine | **P1** | L |
| SMS/WhatsApp notifications (Twilio et al.) | Restaurants and diners live on phones; email open rates don't cut it | **P1** | M |
| Waitlist (when full: join, auto-offer on cancellation — the pub/sub plumbing already exists) | Converts lost demand; visible value | **P1** | M |
| Pacing: max covers/new-parties per interval; per-restaurant slot granularity (15/30/60) | Kitchen protection; §5 item 7 | **P1** | M |
| Modify/reschedule reservation (atomic book-then-release) | Diners cancel+rebook and lose slots today | **P1** | M |
| Reserve with Google integration | Free demand for every customer; strong sales pitch | **P1** | L |
| Owner analytics: covers, utilization by table/hour, no-show rate, source mix | Justifies price; data already in the schema | **P1** | M |
| Special dates with different hours (holiday hours, not just closures) | Real calendars need it | **P2** | S |
| Events/ticketing (prepaid tasting menus) | Natural deposit extension | **P2** | L |
| POS integrations (Lightspeed, Square, Toast) | The long-term moat; spend data → CRM | **P2** | XL |

### 8.2 Multi-tenancy & enterprise

| Capability | Why | Pri | Cx |
|---|---|---|---|
| Staff accounts & roles per restaurant (OWNER / MANAGER / HOST), invitation flow | Most restaurants have employees; single-login is disqualifying | **P1** | M–L |
| Organization entity above restaurants (groups/chains), roll-up reporting, per-org billing | Required before any 2+ location customer; retrofitting later is much worse | **P1** (model now, UI later) | M |
| SSO/SAML, SCIM | Enterprise checkbox | P2 | L |
| White-label (custom domain booking pages, brand theming) | Groups demand it; also a pricing lever | P2 | M |
| Public API + API keys + webhooks (outbound) | Integrators; enterprise procurement asks | P2 | M |

### 8.3 SaaS platform

| Capability | Why | Pri | Cx |
|---|---|---|---|
| Wire `lsUpdatedAt` guard in the webhook upsert (column exists, unused!) | Billing state can regress on out-of-order delivery **today** | **P0** | S |
| Fix admin plan override to set a coherent `status` | Comping users silently doesn't work | **P0** | S |
| Decide + implement EXPIRED policy (churned-paid currently keeps free Starter service forever, strictly better than paying for Starter once trial rules are compared) | Revenue integrity; currently incoherent vs. trial | **P0** (decision) / S (code) | S |
| Dunning surface (PAST_DUE banner, grace countdown) | Involuntary churn recovery | P1 | S |
| Feature flags / per-tenant entitlements beyond plan enum | Safe rollout of everything above | P1 | M |
| In-app announcements/changelog; email lifecycle (trial d7/d12) | Activation & conversion | P2 | S |
| Referral/annual pricing | CAC leverage | P2 | S |

### 8.4 Security (remaining — baseline is strong)

| Item | Why | Pri | Cx |
|---|---|---|---|
| **Frontend 401→refresh→retry + proactive refresh + WS re-auth on 4001** | The 15-minute session death is *experienced as* the platform being broken | **P0** | S–M |
| Email verification at signup; require verified email to book | Abuse guardrails assume identity; today identities are free | **P0** | S–M |
| Trust `CF-Connecting-IP` only from Cloudflare CIDRs / make `CF_ORIGIN_SECRET` mandatory in prod | All rate limits/bans are spoofable if origin reachable | **P1** | S |
| Key rotation story for RS256 (kid header, JWKS) | Currently a single static keypair in env | P2 | M |
| Per-account (not just per-IP) login limiting | CGNAT lockout + credential-stuffing both mishandled by pure-IP keys | P2 | S |
| Secrets manager + laptop hygiene (no prod `.env` on dev machines), backup encryption | §4.3 | **P1** | S (process) |
| GDPR: DSR export/erasure endpoints, retention policy for audit logs & PII in `guestName`/notes, DPA template | EU beachhead | P1 | M |

### 8.5 Reliability, monitoring, scalability

| Item | Why | Pri | Cx |
|---|---|---|---|
| Error tracking (Sentry) + uptime probe on `/health/ready` + log drain; BullMQ dead-letter alerting (alert.ts is a good start — needs a destination and runbooks) | Unattended system; today failures are pino lines on one box | **P0** | S |
| CI databases (Postgres+Redis service containers) so the integration suite actually runs; block deploy on it | Tests exist but CI is vacuous — the suite literally cannot pass without `DATABASE_URL` | **P0** | S |
| Status reconciliation job (SCHEDULED/SEATED → COMPLETED after `endsAt`) | DB analytics/filters lie forever; `deriveDisplayStatus` papers over it per-response | **P0** | S |
| Retention/cleanup jobs: expired refresh tokens, old audit logs, released holds (protect the hot GiST index) | Unbounded growth degrades the exclusion index — the one index that must stay fast | **P1** | S |
| Booking idempotency keys | Mobile retry → duplicate reservations at different tables | **P1** | S |
| `?pgbouncer=true&connection_limit` enforced by check-env; booking-burst load test against the pooler | The classic Supabase+Prisma prepared-statement incident is otherwise guaranteed | **P1** | S |
| Horizontal-scale prep: WS connection registry → Redis, sticky-free pub/sub fan-out, worker already separable | Single-instance assumptions are documented; make them optional before traffic forces it | P2 | M |
| Availability search precompute (per-restaurant "next available" flags maintained on mutation) instead of 100× fan-out on anonymous requests | P1-2: a handful of concurrent searches exhausts the pool | **P1** | M |
| DB backups: move from JSON scripts to PITR verification + restore drills | `scripts/export-backup.ts` is not a disaster-recovery strategy | **P1** | S (process) |
| Multi-region/read-replica story | 10-year concern, not now — the modular monolith + Postgres scales past 10⁵ restaurants with pooling, caching, and the above | P2 | — |

### 8.6 Developer experience

| Item | Why | Pri | Cx |
|---|---|---|---|
| Generate shared types from zod/Prisma (delete hand-written `packages/types` drift risk); OpenAPI spec → typed clients | Three SPAs hand-mirror API types today | P1 | M |
| Local full-stack via docker-compose (Postgres too, not just Redis) + seeded demo tenant | Onboarding an engineer today requires a Supabase project | P1 | S |
| Remove dead code: retired slot-model aliases, `admin/bookings` naming, `load-test.ts` stale comments, empty `packages/ui`/`config` | Confuses every new reader | P2 | S |
| Preview environments per PR | Product velocity with UI-heavy roadmap | P2 | M |

---

## 9. Deep Technical Reviews

### 9.1 Database — verdict: **strong core, wrong edges; evolve, don't replace**

Keep: UUIDs, citext email, timestamptz(3), the exclusion constraint, soft deletes, snapshot fee columns, append-only audit shape, `service_periods`/`restaurant_closures` (Phase 17 modeling is right, including overnight-as-`close<=open` and closures-suppress-starts semantics).

Change:
- **Introduce `organizations`** (owner → org member) and hang restaurants + subscriptions off the org, not the user. This is the single most important schema decision to make *early*: subscription-per-user is already the wrong shape (an owner's plan gates *all* their restaurants jointly; a sold restaurant can't change hands; a second manager can't exist). Migration is straightforward now (1 org per owner backfill) and brutal in two years.
- **Introduce `guests`** (per-restaurant, nullable link to platform user, phone/email, notes/tags) and point `reservations.guestId` at it; `guestName` becomes a fallback.
- `turn_time_rules` allows overlapping bands silently (first-match by `minPartySize asc`); add an overlap check or explicit priority.
- Prisma cannot express the exclusion constraint (fine — raw migration), but the migration history still carries the retired slot-model detour; squash before the next team reads it.
- No RLS in production (app-layer only). Acceptable for a single API surface; revisit when a public API or analytics warehouse reads the DB directly.
- Add missing operational indexes when the service view ships (e.g., `reservations(restaurantId, startsAt)` exists ✅; will need `(restaurantId, status, startsAt)` for the floor filters).

### 9.2 Reservation/availability engine — verdict: **right foundation; needs pacing, granularity, and a capacity concept**

- Correctness: post-Phase 17, genuinely solid — window enforcement server-side, tables validated, races handled at the constraint, quota exact under an advisory lock.
- **Pacing is the missing engine concept** (§5 item 7). Model: per-restaurant `maxCoversPerInterval` / `maxPartiesPerInterval`; enforce inside `createReservationWithHolds` (count within the tx under the same advisory lock — cheap) and in `computeAvailabilityTimes` (in-memory against the day occupancy it already loads).
- 15-min step is hardcoded (`AVAILABILITY_STEP_MINS`); make it per-restaurant (15/30/60).
- Best-fit = smallest max capacity; fine as default, but owners will want table-priority (keep windows for walk-ins, fill bar first). A per-table `bookingPriority` sortkey is a cheap 80% solution.
- Combinations with deactivated member tables remain bookable (P2-7) — filter combos with inactive members in `loadBookableUnits`.
- Cache invalidation misses the adjacent day for windows crossing midnight — now *more* likely with overnight periods; invalidate both local dates touched by `[startsAt, endsAt)`.
- The old `serviceWindowBounds`-based helpers in `service-hours.ts` and any callers should be retired to one source of truth (`service-schedule.ts`).
- The `web` SPA still assumes a single contiguous window per day and computes scan dates in browser-UTC — must consume `serviceWindows[]` and restaurant-local dates.

### 9.3 API — verdict: **good; standardize and open up**

Consistent module pattern (routes/schema/service), zod at the boundary, 422 details, honest error taxonomy post-`mapPrismaError`. To do: version the API (`/v1`) *before* the widget/public API exists; publish OpenAPI (generate from zod); idempotency keys on booking; cursor pagination (offset today); a public slug-lookup endpoint (slugs exist, no route uses them — the SSR booking page needs it); replace the in-body refresh-token return (cookie is enough; body copy widens exposure).

### 9.4 Backend architecture — verdict: **modular monolith is correct; keep it for years**

Do not microservice. The seams are already clean (modules, worker separable, pub/sub). What must change is *deployment posture*, not architecture: worker as its own process in prod (env flag exists — flip it), health-checked, plus the reliability items in §8.5. Bcryptjs (pure JS, event-loop-blocking ~200 ms/login) → native `argon2id` when convenient.

### 9.5 Frontend — verdict: **the weakest layer; concentrated effort needed**

Three competent CRUD SPAs sharing no code (`packages/ui` is empty while Button/Input/Card are triplicated — either fill the package or delete it). The critical items: the shared fetch wrapper with 401→refresh→retry + proactive refresh (P0-1); restaurant-tz formatting *everywhere* (one shared `formatInRestaurantTz` util); the dashboard service view (§8.1); consuming the Phase 17 payloads (`serviceWindows`, `bookable`, `offersCustomReservations`) that the server now sends and the clients ignore. The diner surface should be re-founded as SSR (Next/Remix/Astro) *when the public booking page ships* — don't retrofit the SPA; build the booking page right and let the SPA wither.

### 9.6 Infrastructure & deployment — verdict: **sane for stage; harden the gaps**

Railway+Vercel+Supabase+Upstash+Cloudflare is a reasonable v1. Gaps: CI test databases (P0); `pgbouncer=true` (P1); staging actually exercised (deploy workflows exist; nothing proves staging runs); Cloudflare origin lockdown made mandatory; secrets out of laptops; uptime/error monitoring external to the box. Cost posture is excellent (<€100/mo until real traffic) — the platform's cost curve is dominated by Postgres and Resend/Twilio volume, both linear and fine.

---

## 10. Technical Debt Register (beyond the open findings)

1. Hand-written `packages/types` drifting from Prisma/zod (three consumers).
2. Plan limits duplicated client-side (`plan-limits.ts`) — server already sends `planComparison`; delete the copy.
3. Retired slot-model residue: migration history, `@deprecated` aliases, `load-test.ts` comments, `admin` "bookings" naming.
4. `deriveDisplayStatus` (presentation-layer status lies) — delete once the reconciliation job exists.
5. Legacy `openMinutes/closeMinutes` now redundant with `service_periods` — keep one release for fallback, then drop columns and the fallback branch in `loadRestaurantSchedule`.
6. Tests hit whatever DB `.env` points at (developer machines share the dev DB) — point vitest at a dedicated ephemeral DB locally too.
7. WS URL built from `window.location.host` while REST honors `VITE_API_URL` — breaks split-origin deploys silently.
8. Registration auto-login consumes a login rate-limit slot (shared-IP onboarding trap).

---

## 11. Assumptions That Should Be Challenged (and my rulings)

| Assumption baked into the code | Ruling |
|---|---|
| Diners must have accounts to book | **Reject.** Guest checkout with verified email/phone; accounts optional. Schema already permits it. |
| Maida never touches restaurant money | **Reject as dogma.** Keep for v1; deposits via Stripe are the premium tier (§3.3). The *informational fee* concept can stay as the no-payment fallback. |
| Reservations/month is a fair pricing axis | **Reject.** Flat per-location tiers; quotas only as soft abuse ceilings (10× normal), never diner-visible. |
| Trial stricter than Starter | **Reject.** Trial = full Pro for 14 days (evaluation must include the features you want them to buy); keep table caps if needed. |
| Churned-paid (EXPIRED) keeps free Starter service | **Reject.** Align with trial-expiry: read + manage existing bookings, no new online bookings, clear dunning path. |
| One login per restaurant business | **Reject.** Staff roles (§8.2). |
| Email is a sufficient notification channel | **Reject.** SMS/WhatsApp for diners; email for receipts. |
| The diner marketplace is the demand strategy | **Reject.** Widget + Google + SSR pages (§3.3). |
| 15-minute global slot granularity | **Challenge.** Per-restaurant setting. |
| Best-fit-only table assignment | **Challenge.** Priority ordering per table. |
| Single API instance forever | **Keep for now**, with the Redis-backed WS registry as the prepared exit. |
| Modular monolith | **Keep.** Explicitly re-affirmed. |

---

## 12. Performance Bottlenecks (ranked)

1. **Search-with-availability fan-out** (anonymous, ~300 queries/request, 100-restaurant hard cap) — precompute/caching required before any marketing push.
2. **Prepared-statement failures under PgBouncer** without `pgbouncer=true` — a latent production incident, not a perf tune.
3. Interactive booking transactions (15 s maxWait/20 s timeout) pin pooled connections; acceptable at low volume, needs pool sizing + load test.
4. Bcryptjs on the event loop (login bursts stall the process).
5. Redis fail-fast client (no retry, 2 s timeouts) converts blips into 503 storms — right *direction* (fail fast + 503) but needs a small in-process grace cache for the deny list.
6. Availability cache is fine (300 s + invalidation); extend it to the search path and it covers 90% of read load.

---

## 13. Consolidated Recommendation Table (the plan)

| # | Recommendation | Pri | Impact | Cx | Depends on |
|---|---|---|---|---|---|
| R1 | Commit Phase 17; wire `lsUpdatedAt` in webhook upsert; fix admin plan override status | P0 | Billing integrity | S | — |
| R2 | Frontend session refresh (401→refresh→retry, proactive, WS 4001 re-auth) | P0 | Every user, every 15 min | M | — |
| R3 | Schedule/closures owner UI + diner multi-window rendering + `bookable` notice | P0 | Unlocks shipped backend | S–M | R1 |
| R4 | Dashboard service view (today-first list/timeline, walk-in/staff/override/extend/free-early/move UI, pagination, restaurant tz) | P0 | Product usable in service | M–L | R2 |
| R5 | CI test databases; monitoring stack (Sentry + uptime + alert destination + runbook); worker split in prod | P0 | Trustworthy releases/ops | S | — |
| R6 | Status reconciliation + retention/cleanup jobs (needs a scheduler — BullMQ repeatable jobs already available) | P0 | Data truth, index health | S | — |
| R7 | Reminders + confirm/cancel links + .ics; email verification at signup | P0 | No-show cut, abuse floor | S–M | — |
| R8 | Pricing restructure: flat per-location tiers, full-featured trial, EXPIRED=locked, quotas → invisible abuse ceilings | P0 | Revenue coherence | S code / M product | Decision |
| R9 | SSR public booking page + embeddable widget (+ guest checkout, idempotency keys, `/v1`, slug endpoint) | P1 | The distribution wedge | L | R2, R7 |
| R10 | Guest CRM v1 (`guests` table, dedup, tags/notes, visit history in dashboard) | P1 | Moat; walk-in data quality | M | R4 |
| R11 | Staff roles + `organizations` schema migration | P1 | Real businesses; enterprise path | M–L | — (schema early!) |
| R12 | SMS/WhatsApp channel; notification preferences | P1 | Ops-grade comms | M | R7 |
| R13 | Deposits/card-guarantee via Stripe; no-show fee flows | P1 | Premium revenue | L | R9, R10 |
| R14 | Pacing + per-restaurant granularity + table priority + combo-inactive fix + adjacent-day cache invalidation | P1 | Kitchen trust, engine polish | M | — |
| R15 | Search precompute; Cloudflare IP trust hardening; pgbouncer enforcement; booking-burst load test | P1 | Scale readiness | M | — |
| R16 | Owner analytics v1 (covers, utilization, no-show rate) | P1 | Price justification | M | R6 |
| R17 | Waitlist + modify/reschedule | P1 | Demand capture | M | R4 |
| R18 | Reserve with Google | P1 | Free demand | L | R9 |
| R19 | GDPR pack (export/erasure, retention, DPA), secrets manager, backup drills | P1 | EU scale legitimacy | M | — |
| R20 | Generated types/OpenAPI; shared UI package or deletion; dead-code purge; docker-compose full stack | P2 | Team velocity | M | — |
| R21 | White-label, public API keys/webhooks, SSO, POS integrations, multi-region | P2 | Enterprise decade | XL | R11 |

---

## 14. Implementation Strategy & Roadmap

**Guiding rule: nothing new ships while a P0 is open; the dashboard service view is the first "new" thing.**

- **Phase A — Stabilize (weeks 1–3):** R1, R2, R5, R6, R7-email-parts, R3. Exit: an owner tab stays alive all evening; CI is real; billing can't regress; the shipped schedule feature is reachable. *Ship to 2–3 pilot restaurants you can talk to weekly.*
- **Phase B — Operable (weeks 3–8):** R4, R8, R14-basics, R15-hardening. Exit: a host runs a full Friday service on a tablet without touching the API by hand. Pilot restaurants would be upset if you took it away — the only metric that matters at this stage.
- **Phase C — Wedge (months 2–5):** R9, R10, R12, R16, R17. Exit: >50% of pilot bookings arrive via widget/public page; guest book populated automatically; reminders cut measured no-shows. Begin charging the new flat pricing.
- **Phase D — Moat (months 4–9):** R13 (deposits), R11 (roles/orgs), R18 (Google), R19 (GDPR). Exit: premium tier sells on no-show protection; first 2–5 location group onboarded.
- **Phase E — Expand (months 9–18):** i18n/multi-currency (the EUR/USD/English incoherence resolved properly), R20 platform work, first POS integration, white-label; evaluate the consumer directory *only if* customer density in a city makes it free to win.

Team shape: this plan is executable by 2–3 engineers + the founder doing product/sales, precisely *because* the monolith and engine are already right. The single riskiest dependency is design/UX capacity for Phase B–C — hire or contract that first.

---

## 15. Ten-Year Architecture Posture

The current architecture survives ~3 orders of magnitude with only posture changes: pooled Postgres + read replicas + the exclusion constraint (per-table writes never contend globally); Redis-backed WS registry and N stateless API instances; worker fleet on BullMQ; availability precompute per restaurant-day (a naturally shardable keyspace); orgs/guests as first-class entities from Phase D. The moment to *re-architect* (dedicated availability service, event-sourced reservations, regional cells) is when a single Postgres writer saturates on hold-writes — at 15-minute granularity and realistic covers, that is >10⁶ reservations/day: not a Year-1..3 problem. Write it down, stop worrying about it.

---

## 16. Final Verdict

**Could this repository become the world's best restaurant reservation platform?**

The *engine* could. It is the correct kernel — the part competitors get wrong and the part that's hardest to retrofit. The security and code discipline around it are well beyond typical seed-stage work, and the Phase 17 trajectory (schedules, abuse guards, alerting) shows the team fixes the right things in the right order.

The *product and strategy* as currently aimed could not. A diner-marketplace with no demand engine, quota pricing that punishes success, no service-floor tooling, no no-show economics, and no guest memory would stall at hobbyist adoption regardless of engine quality.

**The company should hear:** keep the codebase, keep the monolith, keep the engine — and pivot the vision from "a place diners book" to "the direct-channel reservation and guest platform for independent restaurants." Fix the session bug and finish Phase 17 this week; make Friday night operable this month; ship the widget, reminders, and guest book this quarter; deposits and multi-user this year. Do that, and this is a credible path to category leadership in the independent segment — the segment the giants structurally can't serve well. Don't, and the best exclusion constraint in the industry will protect tables no one is booking.

---

*Cross-references: file-level system documentation and the full finding-by-finding audit are in [PLATFORM_REVIEW.md](PLATFORM_REVIEW.md). Working-tree status as of this writing is summarized in §2.3 — commit Phase 17 first.*
