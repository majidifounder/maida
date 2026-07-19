# Living Specifications

*Modular, per-subsystem specifications. Each file is the **maintained contract** for one
subsystem: what it is for, what must stay true, where new code belongs, and what commonly
goes wrong. Derived from verified source (via [01](../01-system-map.md)–[04](../04-candidate-invariants.md)),
not from legacy prose docs. Authority = code; when a spec and the code disagree, the code
wins **and the spec must be fixed in the same change** — that is what "living" means, and
the [drift guard](../DRIFT-GUARD.md) enforces it.*

## Contract every spec follows

| Section | Meaning |
|---|---|
| **Purpose / Responsibilities** | What the subsystem is for; what it owns |
| **Architecture (stable)** | Truths a change must not silently break — treat as load-bearing |
| **Boundaries** | What this subsystem may/may not import or be imported by; trust boundaries |
| **Verified invariants** | INV-x rows owned by this subsystem, each with its guard test |
| **Implementation details (volatile)** | Current mechanics that MAY change freely if invariants keep holding |
| **Extension points — where new code belongs** | The sanctioned way to add behavior |
| **Evolution guidance** | How existing code should evolve; intentionally flexible areas |
| **Common mistakes** | Errors past reviews found or that the structure invites |
| **Open findings** | Known defects/gaps — backlog IDs, never silently fixed in passing |
| **Anchors** | `path:line`/symbol references backing every claim |

## Specs

| Spec | Subsystems (from [01 §1](../01-system-map.md)) |
|---|---|
| [platform.md](platform.md) | S1 composition root, middleware chain, env, Redis substrate, deployment contract |
| [auth-session.md](auth-session.md) | S6 auth module, JWT, cookies, authenticate plugin |
| [reservation.md](reservation.md) | S8 reservation module + S5 engine (booking, lifecycle, holds) |
| [availability.md](availability.md) | S7 restaurant/config module, availability cache, search |
| [billing.md](billing.md) | S9 subscription/plans/Lemon Squeezy webhooks |
| [notifications.md](notifications.md) | S12 email, S2/S3 workers, queue, pub/sub, S13 WebSocket |
| [admin.md](admin.md) | S10 admin module + TOTP |

Cross-cutting registries: [../INVARIANTS.md](../INVARIANTS.md) (invariant → guard-test map),
[../BACKLOG.md](../BACKLOG.md) (all open findings), [../DRIFT-GUARD.md](../DRIFT-GUARD.md)
(how spec↔code sync is enforced).
