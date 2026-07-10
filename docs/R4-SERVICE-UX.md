# R4 — The Service Experience

*UX philosophy and design record for the Maida owner dashboard's service view.
Written 2026-07-10. Visual identity is governed by [maida-brand-guidelines.md](../maida-brand-guidelines.md) (v3.0, monochrome) — this document covers behavior: how the product must feel and why each interaction works the way it does. Read both before touching the dashboard.*

---

## 1. The user, the moment, the constraint

The service view is used by **a host standing up, mid-service, being interrupted every forty seconds** — a phone ringing, a party of four in the doorway, a table lingering over dessert with the next booking twelve minutes out. Every design decision below is tested against that person, not against a product manager at a desk.

Three consequences fall out immediately:

1. **The screen is glanced at, not read.** Information must be scannable in under a second: fixed-width times, one line per party, status legible as shape + word, never color alone.
2. **Every interaction competes with a human being standing in front of the host.** Anything that takes three taps where one would do loses to the paper book.
3. **Trust is binary.** The first time the screen shows a stale table state or eats an action silently, the host goes back to pen and paper and never returns. The interface must *never* leave "did that work?" unanswered.

## 2. Perceived performance

**Principle: the interface has already done it.** Latency is hidden behind truthfulness about what *will* be true.

- **Optimistic by default where correctness allows.** Seat, free-table, cancel, no-show mutate the local cache the instant the button is pressed — the row's badge flips under the host's finger. The server round-trip happens behind that certainty. If it fails (rare: a 409, a network drop), the row visibly reverts and a danger toast explains in plain words. The failure case is louder than the success case, which is correct: success is the default and deserves no ceremony.
- **Extend is *not* optimistic** — it can legitimately conflict with the next booking on the table, so it acknowledges with the button's inline working state and confirms with a toast. Optimism is a correctness decision, not a style.
- **Day navigation feels like flipping a paper book.** The adjacent days are prefetched in the background the moment a day renders; pressing ← or → is almost always an instant cache hit. Revisiting any recently-seen day is instant (15s staleness, refreshed silently).
- **Skeletons appear exactly once** — on the very first load of a day with no cached data, shaped like the real rows so nothing reflows when data lands. They are never shown for refreshes, background updates, or revisits. A skeleton that appears on every interaction teaches the user the app is slow; one that appears only on cold start teaches them it's fast.
- **Spinners are almost extinct.** Buttons carry their own small inline indicator while keeping their label and width (no layout jump, no vanished intent). The page-level spinner survives only for truly indeterminate rare waits.

## 3. Feedback: answering "did that work?" before it's asked

- **The row is the receipt.** For lifecycle actions, the visible state change of the row (badge flips to Seated, row moves to Finished) *is* the confirmation. No toast repeats what the eye already saw — that would train the host to ignore toasts.
- **Toasts are reserved for what the eye couldn't see:** a dialog's outcome after it closes ("Seated at T4 + T5" — which the auto-assigner chose), an *online* booking arriving from outside ("New booking — party of 6"), and every error. Errors persist 5s; acknowledgements 2.5s.
- **Toast styling is monochrome** (white surface, mist hairline, ink text); only the state icon carries semantic color. A toast is an acknowledgement, not a celebration.
- **Live-arrival flash:** a row that wasn't there a moment ago pulses once with Fog (1.2s) and settles. It says "this just arrived" without demanding anything. If a refetch brings ≥5 new rows (initial sync, reconnect), nothing flashes — flashing everything is flashing nothing.

## 4. Destructive actions: confirm inline, never modally — and why not undo

The brief prefers undo over confirmation, and that is the right instinct. It is **deliberately not implemented here**: cancelling or no-showing emails the guest immediately and the API has no reverse transitions. An "Undo" chip that cannot un-send an email is a lie, and lying to a stressed host is the fastest way to lose them.

Instead: **two-step inline arming.** The first press turns the quiet ghost button into a Danger-styled restatement of the consequence ("Cancel booking?") in place — same position, no modal, no focus theft. A second press within 4 seconds executes; focus loss or timeout disarms. This is one extra tap only for destructive acts, zero for everything else, and the host's eyes never leave the row.

*Follow-up recorded:* when reinstatement endpoints exist server-side (un-cancel within a grace window, before notification dispatch), `ConfirmableAction` is the seam where undo replaces arming.

## 5. Modals: two, and only two

A modal is justified only when the host is *initiating* something with multiple inputs — walk-in and phone booking. Both follow the same physics: focus trapped, Escape closes, focus returns to the opener, initial focus on the first meaningful field, one 150ms fade (the modal should feel like it was already there; motion that "arrives" costs attention).

- **Walk-in** is the highest-pressure flow in the product, so it has exactly one required decision: party size, prefilled to 2, adjusted via 44px steppers and one-tap common sizes (2/4/6/8). Name is optional ("Sara — red coat"). Submit seats the party immediately and the toast names the auto-picked table. Failure ("no table free") explains and offers the two real options: free a table or change the size.
- **New booking** reads in the order a phone conversation happens: name → party → when → notes. A slot conflict never dead-ends: the server's `suggestedNextAvailableAt` becomes a one-tap **"Book 8:15 PM instead"** inside the error itself. The error message is the brand's: *"That slot's already taken."*

## 6. Information architecture of the day

- **Today is grouped by operational relevance, not chronology alone:** *Seated now* (the floor), *Up next* (the queue), *Finished* (collapsed to a count — done work is noise until someone asks for it, but stays one tap away with cancelled/no-show rows visible for accountability).
- **Other days are a simple chronological book** — planning mode, not operating mode.
- **The summary line answers the manager's first question without a click:** "14 bookings · 42 covers", live connection state, and the timezone every time is rendered in.
- **Times are restaurant-local, always.** An owner checking from home sees service-floor time. The timezone is stated quietly in the header so there is never a doubt.
- **Search is instant and client-side** over the loaded day (name, email, table) — matching how hosts think ("the Dubois table", "who's on T4"). No search button, no debounce spinner; the list *is* the result. Cross-day search is a future, server-side concern.
- **Pagination does not exist for the host.** A day loads up to 100 covers-worth of rows in one request (the API limit was raised for exactly this). A restaurant that regularly exceeds that will get virtualization before it gets page buttons — page buttons in a service book are an admission of failure.

## 7. Contextual actions: the row knows what's legal

Buttons appear only when the action is possible *for that row right now* — the host is never shown a button that will be rejected:

- Scheduled + today → **Seat** (the one primary-dark action per row), Cancel; **No-show** appears only after the booked time has passed (marking a no-show early is a mis-tap, not a decision).
- Seated → **Extend** (+15/+30/+60 — a menu, not a form) and **Free table** (guests left early; releases the interval for rebooking).
- Finished rows fade to 60% and carry no actions — except a display-completed row whose *raw* status is still SCHEDULED (guest never came, the display layer retired it): it keeps **Mark no-show** so the guest's record stays honest. The API's `rawStatus` field was added for precisely this.

## 8. Real-time philosophy

- **WebSocket first, polling as the safety net** (60s interval, focus refetch). The host must be able to trust the screen without touching it; the reservation book self-heals even if the socket silently dies.
- **Connection state is honest but calm:** a small "Live" chip (green dot + word) or "Reconnecting…" (amber dot + word) — color paired with text per brand rule, no flashing, no error modal for something the client is already fixing itself (the socket reconnects with a fresh token automatically, including across the 15-minute token expiry).
- **Remote events surface as row changes + one quiet toast for genuinely external news** (a diner booking online). Events the host caused are never toasted — they watched them happen.

## 9. Keyboard, focus, and hands

Hosts at a stand develop muscle memory. Single-key shortcuts — **W** (walk-in), **N** (new booking), **T** (today), **←/→** (days), **/** (search) — active only when not typing and no modal is open; never combined with modifiers, never overriding the browser. A quiet hint row at the foot of the page teaches them passively; it never nags. Focus is managed with intent: modals trap and return it; `:focus-visible` shows the Ink ring on every interactive element for keyboard users without haunting mouse users.

## 10. Empty states, errors, and voice

Every empty state names *what will fill it* and offers the next action: "No reservations yet today. Online bookings appear here the moment a guest confirms." — never a dead end, never an apology, never a cartoon. Errors say what happened and what to do, in the brand's honest-helpful register ("That didn't go through — the book is unchanged."). No jargon, no error codes at the surface, none of the banned corporate vocabulary.

## 11. Motion & accessibility

- Motion budget: 100–150ms color/opacity transitions, one arrival pulse, one chevron rotation. **Nothing moves that isn't communicating a state change.** `prefers-reduced-motion` collapses all of it.
- Contrast per brand WCAG table (Ink/Charcoal/Slate on Paper all ≥ AA); status = color + icon + label everywhere; all icon-only controls carry `aria-label`; sections are labelled regions; toasts and inline errors use `role=alert`/`status`.
- Touch targets on the critical path (steppers, primary actions) ≥ 44px — the tablet at the stand is the primary device.

## 12. What was deliberately NOT built (and where it goes next)

| Not built | Why | Next step |
|---|---|---|
| Undo for cancel/no-show | Server has no reverse transitions; emails fire immediately — undo would lie | Reinstatement endpoints + delayed notification dispatch, then swap arming → undo in `ConfirmableAction` |
| Floor-plan / table-grid visualization | A list the host can scan beats a map the host must learn; zero spatial data exists yet | Timeline-per-table view once table CRUD carries positions |
| Override-booking UI (explicit tables + times) | Rare power action; API exists; the dialog would tax every common case | "Advanced" section in New booking, fed by a table-availability picker |
| Manual table pick on walk-in | Auto-assign (best-fit) is right >90% of the time; choice would slow the doorway moment | Optional "choose table" expander showing free tables at now |
| Offline queueing of actions | Wrong to fake writes against a booking engine that guards conflicts at the DB | Read-only offline snapshot + clear "reconnecting, book may be stale" banner |
| Cross-day guest search | Needs a server endpoint; belongs with Guest CRM (R10) | Search endpoint over guests, wired into the same search box |

## 13. Self-critique — "what would still frustrate the busiest restaurant?"

Honest answers, ranked, all fed back into the roadmap:

1. **No table-occupancy overview.** The list says *who*; it doesn't show *which tables are free right now* at a glance. The walk-in auto-assigner knows — the host can't see it. (→ R4.1: free-tables strip fed by the day's holds.)
2. **Seated rows don't show remaining time.** "T4 — 25 min left" would preempt the most common mental math in the room. The data (endsAt) is already on the client. (→ R4.1, trivial.)
3. **No-show recovery:** marking no-show releases the table, but nothing suggests offering the slot to a waitlist — because there is no waitlist yet (R17).
4. **A second device can race the first** (two hosts seat the same walk-in twice). The exclusion constraint makes it harmless at the DB, but the UX should absorb it more gracefully than a 409 toast.
5. **The 100-row day** has no virtualization; a festival-scale service would scroll heavily. Acceptable until a real customer proves otherwise.

---

*Any change to the service surface must be defensible against §1's host. If a proposal adds a click, a wait, or a question to the doorway moment, it needs to buy that cost back somewhere the host can feel.*
