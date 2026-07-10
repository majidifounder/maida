# Maida — Brand Guidelines
> Version 3.0 · Restaurant Reservation SaaS · July 2026
> Supersedes v2.0 — brand shifted to a monochrome (black / white / grey) visual system with restricted semantic color.

---

## 0. What changed in v3.0 (read first)

- **Visual language is now monochrome.** The entire UI — nav, buttons, backgrounds, cards, logo — lives on a neutral grayscale ramp. Blue (Ocean) and orange (Ember) are retired as brand colors.
- **Color is reserved for meaning only.** Green = success/positive states, Red = failure/destructive states, Amber = remarks/attention. Color never appears decoratively. If a color isn't communicating state a user must act on, it doesn't belong on screen.
- **Logo is now an "M" monogram**, not the table-and-chairs "T" mark. Two-tone grey-to-white on a black tile, with a single white dot in the valley of the M.
- Color/type tokens below replace all prior blue/ember values.

---

## 1. Brand Strategy

**Mission:** We simplify restaurant discovery and reservations for diners by giving owners real-time control over their tables, so every seat gets filled and no guest waits in the dark.

**Vision:** A world where dining out starts with certainty — guests arrive confident, restaurants prepare precisely.

**Value Proposition:**
For independent restaurant owners and diners who want a seamless, reliable booking experience, Maida is a reservation platform that eliminates double-bookings and last-minute no-shows. Unlike OpenTable or Resy, we are built for independent operators — not hotel chains — with real-time WebSocket updates and a flat, transparent subscription.

**Positioning Statement:**
Maida is the reservation platform for independent restaurants and the diners who love them — built for reliability, not friction.

**Key Messages:**
| Message | Audience Need | Proof Point |
|---|---|---|
| Zero double-bookings, guaranteed | Owners lose money on conflicts | DB-level exclusion constraint |
| Real-time table updates | Owners miss bookings mid-service | WebSocket push, zero refresh |
| Transparent flat pricing | Owners hate per-cover fees | Monthly SaaS subscription |
| One-tap booking for diners | Guests abandon complex flows | 3-step booking flow |
| Restaurant-first design | Generic tools feel like afterthoughts | Built for independent operators only |

**Elevator Pitches:**
- 10-second: "Maida is a reservation platform for independent restaurants — no double-bookings, real-time dashboard, flat monthly fee."
- 30-second: "Independent restaurant owners use Maida to manage bookings and availability from a live dashboard that updates the second a reservation is made. No per-cover fees, no outdated booking sheets, no double-bookings — ever."

---

## 2. Naming & Tagline

**Brand name:** Maida
*(Arabic word for "table" — cleared US trademark search with one unrelated Class 9 conflict; French/Moroccan registry clearance pending professional review before major brand spend.)*

**Domain:** getmaida.app

**Recommended tagline:** Reservations, made simple.

**Tagline variants:**
1. Category-defining — "Reservations, made simple." RECOMMENDED
2. Benefit-led — "Every table, always right."
3. Outcome-led — "Fill your restaurant. Delight your guests." (secondary/marketing use)
4. Challenger — "Reservations without the runaround."
5. Emotional — "Where every table has a story."

---

## 3. Voice & Tone

**Personality traits:**
- We are clear, not corporate
- We are warm, not casual
- We are confident, not arrogant
- We are precise, not technical
- We are direct, not blunt

| Context | Tone | Example phrase |
|---|---|---|
| Marketing / landing | Ambitious, benefit-led | "Turn every empty seat into a story." |
| Product UI | Calm, task-focused | "Booking confirmed. Your table is set for Friday at 7 PM." |
| Onboarding | Encouraging, step-by-step | "Let's set up your first restaurant — takes about 3 minutes." |
| Error states | Honest, helpful | "That slot's already taken. Pick another time?" |
| Pricing page | Transparent, confident | "One price. Unlimited bookings. No surprises." |
| Support / docs | Patient, specific | "To add a new availability slot, go to your restaurant, then Availability." |
| Social media | Conversational | "Built for the restaurant that cares more about the food than the spreadsheet." |

**Words we use:** confirm, available, reserve, manage, real-time, instant, simple, fill, precise

**Words we avoid:** seamless, leverage, revolutionary, synergy, best-in-class, disrupting, empower, unlock, utilize

---

## 4. Color System

The system has two layers: a **neutral ramp** that carries the entire interface, and a small set of **semantic colors** that are the only color allowed in the product.

### Neutral ramp — the entire UI

| Token | Name | Hex | Usage |
|---|---|---|---|
| --color-ink | Ink | #0F0F0E | Primary brand, nav, headings, body text, logo dark elements |
| --color-charcoal | Charcoal | #3A3A37 | Secondary text, dark surfaces, logo mid-tone |
| --color-slate | Slate | #6B6B66 | Muted text, icons, borders on dark |
| --color-stone | Stone | #9B9B95 | Placeholders, disabled states, subtle labels |
| --color-mist | Mist | #D8D6D0 | Input borders, dividers, hairlines |
| --color-fog | Fog | #EFEDE9 | Hover states, table rows, muted fills |
| --color-paper | Paper | #FAFAF9 | Page background, warm off-white canvas |
| --color-white | White | #FFFFFF | Cards, modals, panels |

### Semantic color — the only color in the product

Use these **only** to communicate state. Never as decoration, never as brand accent.

| Token | Hex | Text-on-light | Meaning |
|---|---|---|---|
| --color-success | #2E7D48 | #1B6E39 | Confirmed, seated, available, paid, positive |
| --color-danger | #C6403E | #9B2C2A | Cancelled, no-show, failed payment, delete, error |
| --color-notice | #B8792B | #8A5A1E | Remarks, trial ending, needs attention, warning |

Tinted backgrounds for badges/banners:
| Token | Hex |
|---|---|
| --bg-success | #EAF6EE |
| --bg-danger | #FBEBEA |
| --bg-notice | #FBF3E7 |

### WCAG Contrast
- Ink on Paper: 18.1:1 — AAA
- Charcoal on Paper: 9.4:1 — AAA
- Slate on Paper: 4.9:1 — AA
- Success #1B6E39 on white: 5.3:1 — AA
- Danger #9B2C2A on white: 6.4:1 — AA
- Notice #8A5A1E on white: 5.6:1 — AA

### Rule for status: never rely on color alone
Booking-status badges must pair color with an **icon and a text label**, so the system is legible in grayscale, for color-blind users, and at a dinner-rush glance:
- Confirmed → green + check icon + "Confirmed"
- Seated → neutral grey + armchair icon + "Seated"
- Scheduled → neutral grey + clock icon + "Scheduled"
- Cancelled → red + x icon + "Cancelled"
- No-show → red + user-x icon + "No-show"

---

## 5. Typography

### Primary Pairing: DM Serif Display + DM Sans

```
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500&family=DM+Mono:wght@400&display=swap');
```

| Role | Font | Weight | Desktop | Mobile |
|---|---|---|---|---|
| Display / H1 | DM Serif Display | 400 | 48px | 32px |
| H2 | DM Serif Display | 400 | 32px | 24px |
| H3 | DM Sans | 500 | 22px | 18px |
| H4 | DM Sans | 500 | 17px | 15px |
| Body | DM Sans | 400 | 16px | 15px |
| Small / caption | DM Sans | 400 | 13px | 13px |
| Mono | DM Mono | 400 | 13px | 12px |

Line heights: headings 1.15, body 1.7, captions 1.5

Alternative pairing: Plus Jakarta Sans (single family) for a modern sans-only feel.

---

## 6. Logo Direction — FINAL

**Status:** Finalized. Source asset received ("M" monogram, black rounded-square app-icon tile).

**Type:** Monogram mark — a stylized letter "M" for Maida.

**The mark:** A single geometric "M" built from thick rounded strokes. The M is split tonally: the left stroke and left diagonal are mid-to-dark grey (Charcoal), the right diagonal and right stroke are near-white (Paper/White), creating a light-catching diagonal transition across the letter. A single filled dot sits in the central valley of the M — an echo of the "plate on a table" idea from the earlier mark, and a nod to Maida's "table" meaning. Presented on an Ink (#0F0F0E) rounded-square tile.

**Why it works in monochrome:** The tonal split (dark M-stroke to light M-stroke) gives the mark depth and motion without any color, so it belongs natively to the grayscale system rather than reading as a desaturated version of a colored logo. The dot keeps a subtle brand signature.

**Colorways:**
- Primary — grey-to-white "M" + white dot on Ink tile (app icon, favicon, dark nav)
- Reversed — Ink-to-Charcoal "M" + Ink dot on Paper/white tile (light backgrounds, print, business cards)
- Solid mono — single-tone Ink "M" on Paper, or single-tone Paper "M" on Ink, for contexts where the tonal split can't reproduce (embroidery, single-color stamp, low-grade print)

**Required exports (confirm all exist before dev handoff):**
- [x] "M" monogram on Ink tile, PNG — received
- [ ] "M" monogram traced to SVG (vector) for crisp favicon/app-icon rendering at any size
- [ ] Reversed variant — dark M on light/transparent background, SVG + PNG
- [ ] Solid single-tone variant (Ink-only and Paper-only), SVG — for single-color reproduction
- [ ] Full lockup: "M" mark + "maida" wordmark, horizontal, SVG + PNG
- [ ] Favicon set: 16, 32, 48px (mark on Ink or transparent)
- [ ] Apple touch icon 180×180, PWA icons 192/512px (mark on Ink tile)
- [ ] OG image 1200×630px (mark + wordmark on Ink or Paper)

**Usage rules:**
- Clear space: minimum equal to the width of the M's dot on all four sides
- Minimum digital size: 24×24px (mark only), 120px wide (full lockup with wordmark)
- Favicon / browser tab: mark only
- App icon: mark centered on Ink rounded-square tile, per reference
- No rotation, no recoloring outside the approved grayscale colorways, no drop shadows in flat contexts, no stretching or distortion, no outline-only version, do not reintroduce blue or orange into the mark

---

## 7. Visual Language

| Element | Spec |
|---|---|
| UI style | Monochrome soft flat — white/paper cards on paper canvas, hairline borders, minimal shadow |
| Buttons | 8px radius |
| Cards | 12px radius |
| Modals | 16px radius |
| Badges | 9999px (pill) |
| Shadow — cards | 0 1px 3px rgba(15,15,14,0.06) |
| Shadow — modals | 0 20px 60px rgba(15,15,14,0.18) |
| Icons | Tabler Icons, outline, 1.5px stroke, 24px grid |
| Spacing scale | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64px |

**Button hierarchy (monochrome):**
- Primary → Ink fill (#0F0F0E), white text
- Secondary → white fill, Mist border, Ink text
- Destructive → white fill, Danger border, Danger text (red only because it's a destructive action — semantic, not decorative)

Landing page pattern: Hero (CTA pair) → Features (3 owner benefits) → Social Proof → Pricing → Final CTA

**Icon motifs (marketing site):** calendar-with-checkmark ("Easy booking"), table-and-chairs ("Better tables"), two-people ("Happier guests"), rising-bar-chart ("More bookings"). Outline style, Ink strokes, no color accent (monochrome).

---

## 8. Marketing Copy Pack

**Hero headline:** Reservations, made simple.

**Subheadline:** Maida gives independent restaurants a real-time booking dashboard — and diners a fast, reliable way to reserve a table. No double-bookings. No per-cover fees. No surprises.

**Primary CTA (owner):** List your restaurant — it's free for 14 days

**Secondary CTA (diner):** Find a table tonight

**Feature blocks:**
1. Real-time dashboard — New bookings appear the moment a guest confirms — no refresh, no lag, no missed reservations.
2. Zero double-bookings — Every reservation is locked at the database level. Two guests can't book the same slot — ever.
3. One flat monthly price — No per-cover commissions. No hidden fees. Keep every cent from every table you fill.

**Social proof:** "Trusted by 200+ independent restaurants who stopped paying cover fees."

**Pricing intro:** One plan. Unlimited bookings. Cancel any time. We charge a flat monthly subscription — not a cut of your covers. Your revenue stays yours.

**FAQ:**
Q: Why not just use a pen and paper?
A: You can — until two guests book the same table on a busy Friday. Maida makes conflicts technically impossible, and gives you a dashboard you can check from anywhere.

Q: What happens to my guests' data?
A: Diner data is yours. We store it securely, never sell it, and you can export or delete it at any time. GDPR-friendly by design.

Q: How long does setup take?
A: Under 10 minutes. Add your restaurant, set your availability slots, and you're live. No dev work, no integration headaches.

Q: What does "Maida" mean?
A: Maida is Arabic for "table" — the one thing every great meal starts with.

**Welcome email subject:** Your first table is waiting
**Preview text:** Add your restaurant and go live in under 10 minutes.

**X / Twitter bio:** Reservation software for independent restaurants. Real-time bookings, zero double-bookings, flat monthly price. No cover fees. Ever.

**LinkedIn:** Maida is a restaurant reservation platform built for independent operators. We give owners a real-time booking dashboard and diners a fast, friction-free way to reserve a table — with no per-cover commissions and no double-bookings, guaranteed.

---

## 9. Design Tokens

```css
/* ================================================
   Maida Design Tokens v3.0 — Monochrome
   Restaurant Reservation SaaS
   Neutral ramp carries the UI; color = meaning only
   ================================================ */

:root {
  /* Neutral ramp */
  --color-ink:            #0F0F0E;
  --color-charcoal:       #3A3A37;
  --color-slate:          #6B6B66;
  --color-stone:          #9B9B95;
  --color-mist:           #D8D6D0;
  --color-fog:            #EFEDE9;
  --color-paper:          #FAFAF9;
  --color-white:          #FFFFFF;

  /* Backgrounds */
  --bg-page:              #FAFAF9;
  --bg-surface:           #FFFFFF;
  --bg-muted:             #EFEDE9;
  --bg-success:           #EAF6EE;
  --bg-danger:            #FBEBEA;
  --bg-notice:            #FBF3E7;

  /* Text */
  --text-primary:         #0F0F0E;
  --text-secondary:       #3A3A37;
  --text-muted:           #6B6B66;
  --text-subtle:          #9B9B95;
  --text-on-dark:         #FAFAF9;
  --text-success:         #1B6E39;
  --text-danger:          #9B2C2A;
  --text-notice:          #8A5A1E;
  --text-link:            #0F0F0E;

  /* Borders */
  --border-default:       #D8D6D0;
  --border-strong:        #9B9B95;
  --border-focus:         #0F0F0E;

  /* Semantic status (meaning only, never decorative) */
  --color-success:        #2E7D48;
  --color-danger:         #C6403E;
  --color-notice:         #B8792B;

  /* Typography */
  --font-serif:           'DM Serif Display', Georgia, serif;
  --font-sans:            'DM Sans', system-ui, -apple-system, sans-serif;
  --font-mono:            'DM Mono', 'Courier New', monospace;

  /* Font sizes */
  --text-xs:              11px;
  --text-sm:              13px;
  --text-base:            16px;
  --text-lg:              18px;
  --text-xl:              22px;
  --text-2xl:             28px;
  --text-3xl:             36px;
  --text-4xl:             48px;

  /* Font weights */
  --font-regular:         400;
  --font-medium:          500;

  /* Spacing scale */
  --space-1:              4px;
  --space-2:              8px;
  --space-3:              12px;
  --space-4:              16px;
  --space-6:              24px;
  --space-8:              32px;
  --space-12:             48px;
  --space-16:             64px;

  /* Border radius */
  --radius-sm:            6px;
  --radius-base:          8px;
  --radius-md:            10px;
  --radius-lg:            12px;
  --radius-xl:            16px;
  --radius-full:          9999px;

  /* Shadows (neutral) */
  --shadow-sm:            0 1px 3px rgba(15,15,14,0.06), 0 1px 2px rgba(15,15,14,0.04);
  --shadow-md:            0 4px 12px rgba(15,15,14,0.08), 0 2px 4px rgba(15,15,14,0.05);
  --shadow-lg:            0 20px 60px rgba(15,15,14,0.18), 0 8px 24px rgba(15,15,14,0.08);

  /* Focus ring (Ink, monochrome) */
  --ring:                 0 0 0 3px rgba(15,15,14,0.20);

  /* Transitions */
  --transition-fast:      100ms ease;
  --transition-base:      150ms ease;
  --transition-slow:      250ms ease;

  /* Z-index */
  --z-dropdown:           100;
  --z-modal:              200;
  --z-toast:              300;

  /* Container */
  --container-sm:         640px;
  --container-md:         768px;
  --container-lg:         1024px;
  --container-xl:         1280px;
}

/* Tailwind extension for tailwind.config.ts:
   extend.colors.maida = {
     ink:      '#0F0F0E',
     charcoal: '#3A3A37',
     slate:    '#6B6B66',
     stone:    '#9B9B95',
     mist:     '#D8D6D0',
     fog:      '#EFEDE9',
     paper:    '#FAFAF9',
     success:  '#2E7D48',
     danger:   '#C6403E',
     notice:   '#B8792B',
   }
*/
```

---

## 10. Pre-Launch Brand Checklist

- [x] Domain chosen: **getmaida.app**
- [ ] Purchase getmaida.app; consider getmaida.com for redirect/email credibility
- [ ] Claim social handles (@getmaida or @maida) on X, Instagram, LinkedIn
- [ ] "M" monogram traced to SVG for crisp favicon/app-icon rendering
- [ ] Reversed (dark-on-light) and solid single-tone logo variants exported
- [ ] Full lockup (M mark + "maida" wordmark) exported as SVG + PNG
- [ ] Favicon set (16/32/48), Apple touch icon (180), PWA icons (192/512)
- [ ] Google Fonts loaded in apps/web, apps/dashboard, apps/admin
- [ ] Monochrome CSS tokens file added to all three frontend apps
- [ ] Tailwind config extended with maida grayscale + semantic scale
- [ ] Existing blue/ember values purged from all three SPAs (search: #2E6B8A, #E8603C, #1B3A4B, #F5F0E8)
- [ ] Status badges audited: every state pairs color with icon + label (never color alone)
- [ ] Landing page copy matches this brand kit voice
- [ ] Email templates (Resend) use monochrome palette + "maida" from-name
- [ ] OG image created: 1200×630px, monochrome
- [ ] Social bios updated on X, LinkedIn
- [ ] Professional trademark clearance for French + Moroccan registries before major brand spend
- [ ] Intent-to-use trademark application filed before public launch
- [ ] Rename executed across codebase, .env values, and PROJECT_CONTEXT.md (see checklist below)
- [ ] Brand guidelines shared with any future designer or collaborator

### Codebase rename + recolor checklist (Tablz/blue → Maida/monochrome)
*Reference for the Cursor prompt — tracked here so nothing is missed:*
- Brand name strings: Tablz → Maida across all apps, titles, OG tags, meta
- Package scope decision (`@restaurant/*` — keep or migrate to `@maida/*`)
- `EMAIL_FROM` and sender names in email.service.ts
- `CORS_ORIGIN` values referencing old domain names
- Color tokens: replace blue/ember hex (#2E6B8A, #E8603C, #1B3A4B, #F5F0E8) with monochrome ramp
- Tailwind config color scale (maida.* keys)
- Favicon + logo SVG components in all three apps → new M monogram
- Status-badge components: verify icon + label accompany every semantic color
- PROJECT_CONTEXT.md project name and brand references
- Test fixture emails/domains referencing old brand name

---

*Maida Brand Guidelines v3.0 — July 2026*
*Supersedes v1.0 (Tablz) and v2.0 (Maida, blue/ember). This is the single source of truth. Update whenever a brand decision changes.*
