# Warden · design system (fusion A + B)

> **PROPOSAL.** Warden has no brand manual. Palette, type and voice below are a proposal
> made for the hackathon, not approved brand assets. This sheet fuses two explorations:
> **A** — the all-dark navy product UI (colour), and **B** — the *sitio-web-de-marca*
> brand pass (type, buttons, layout). Owner decision: all dark, A's colours, B's type,
> buttons and layout. No paper, cream or coral anywhere.

## Concept

**A private banker who walks shopping with you.** Calm, precise, never in a hurry.
The orb is the hero on a navy night stage; every decision sits on the same night,
one step lighter. One living colour — blue — marks the single most important action
on each screen. Trust tiers keep their own hues and always carry icon + word.

- Promise: "The agent that's safe to give your card to."
- Voice: short, active, plain English. Concrete first (what we checked), then the
  proof (signals and sources), then the outcome. No urgency, no sales language,
  no exclamation marks. CTAs say exactly what happens ("Check stores", "Buy from Best Buy · $249").

## Colour by role (from A)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0B0F1A` | Page. |
| `--stage` | `#10162A` | Orb stage (+ 7 % film grain). |
| `--surface` | `#141A2A` | Best pick, buy dialog, security sheet, Persona card, attack result. |
| `--surface-hover` | `#1B2338` | Hover on surfaces / outline buttons. |
| `--border` | `#263049` | Solid placeholder stripe. Hairlines are `--text` at 10 % / 28 %. |
| `--text` | `#E8ECF6` | Main text (16.2:1 on bg, 14.7:1 on surface). |
| `--muted` | `#9AA5C0` | Secondary text (7.8:1 bg, 7.0:1 surface). |
| `--accent` | `#5B8CFF` | Primary CTA plane, 10 px brand bar, active tab rule, selection. Text on it is `--on-accent` `#0B0F1A` (6.1:1) — never white (3.2:1). |
| `--accent-hover` | `#7AA2FF` | Hover plane (navy text 7.7:1). |
| `--accent-text` | `#8FB0FF` | Links, numbered /attack rows, focus ring (9.0:1 bg, 8.1:1 surface). |

### Trust tiers (A's hues; always icon + word)

| Tier | Stripe / text on dark | Chip fill / chip text |
|---|---|---|
| ✓ Trusted | `#22C55E` (8.4:1 bg, 7.6:1 surface) | `#15803D` / white 5.0:1 |
| ! Caution | `#F59E0B` (8.9:1 bg, 8.1:1 surface) | `#F59E0B` / navy `#0B0F1A` 8.9:1 (dark text on amber) |
| ✕ Blocked | `#EF4444` stripe; text `#F87171` (6.9:1 bg, 6.3:1 surface) | `#B91C1C` / white 6.5:1 |
| 🔒 Verify | `#8B5CF6` rule; text `#A78BFA` (7.0:1 bg, 6.4:1 surface) | `#6D28D9` / white 7.1:1 |

Blue (accent) is only ever an action, bar or rule — never a status. Best pick gets a
1 px trusted-green outline (45 %) on the surface plane.

### Contrast check (`razon()` from `sitio-web-de-marca/scripts/contraste.py`)

```
16.18  text #E8ECF6 / bg #0B0F1A        14.67  text / surface #141A2A
 7.76  muted #9AA5C0 / bg                 7.03  muted / surface      6.34  muted / surface-hover
 8.95  accent-text #8FB0FF / bg           8.11  accent-text / surface
 6.05  navy #0B0F1A on accent #5B8CFF     3.16  white on accent  (rejected)
 7.69  navy on accent-hover #7AA2FF
 8.40  trusted #22C55E / bg               7.61  trusted / surface
 8.91  caution #F59E0B / bg               8.07  caution / surface
 6.92  blocked-text #F87171 / bg          6.27  blocked-text / surface
 7.03  verify-text #A78BFA / bg           6.37  verify-text / surface
 5.02  white / #15803D   8.91 navy / #F59E0B   6.47 white / #B91C1C   7.10 white / #6D28D9
```

All text pairs ≥ 4.5:1.

## Type (proposal)

**Bricolage Grotesque** (variable, `@fontsource-variable/bricolage-grotesque`, OFL) —
one family; warm humanist grotesque with an optical-size axis. Hierarchy comes from
size, weight and tracking only:

| Role | Size | Weight · leading · tracking |
|---|---|---|
| `.titular` (one h1 per page) | clamp(1.9rem → 2.6rem) | 300 · 1.04 · −0.025em, opsz 72 |
| Store name / sheet title | 1.6–1.75rem | 320–340 · 1.1 · −0.02em |
| Prices | 3rem best / 1.5rem rows | 260–300, tabular-nums, small raised `$` |
| Explanation (lede) | 1.19rem | 320 · 1.5 |
| Body | 1.0625rem | 350 · 1.6 |
| `.etiqueta` / buttons | 0.75–0.8125rem | 520–560 · uppercase · 0.16–0.24em |

No bold headlines; nothing above 560.

## Space, shape, motion

- Mobile-first, 560 px column, 20 px gutters, 32–40 px between blocks.
- Flat rows on hairlines instead of stacked rounded cards; planes are square-cornered,
  only buttons and chips are pills. Touch targets ≥ 44 px (buttons 52–56 px).
- Signature moments: the orb on the navy stage, closed by a 72 % blue bar that grows
  to 100 % once results arrive; the Best-pick surface plane with its green outline.
- Motion: `--ease-lujo` (expo-out). Entrances 900–1100 ms, hovers 500–600 ms, staggered
  result rise. `prefers-reduced-motion` turns all of it off.
- Cancel and Confirm are the same size and weight; only the fill differs (outline vs blue).
