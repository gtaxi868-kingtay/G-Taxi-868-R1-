# The Grid — Design Law

This file was empty. That is why the travel vertical and the entire
commander layer grew their own look: 16 screens, no written standard to
point at. Everything here is extracted from `src/tokens.ts` and from the
two design files (`G-Taxi Rider App.dc.html`, `G-Taxi Driver App.dc.html`)
— nothing is invented.

**If a screen disagrees with this file, the screen is wrong.**

---

## 1. Naming

| Thing | Call it | Never |
|---|---|---|
| The network / product | **The Grid** | "G-Taxi 868" in-product |
| The house / company mark | G-Taxi 868 | — |
| What links the verticals | **G Connect** | "the ecosystem" |
| Merchants | **G Businesses** | "vendors", "partners" |
| Rider tiers | G-Level, G-Member | "loyalty points" |
| Travel vertical | G-Escape | "travel" |
| Marketplace | G-Market | "store" |

The product name carries **no area code**. 868 is the launch story and
the house mark, not the app name — the same product ships to Barbados
and Jamaica without a rebrand.

## 2. The four voices

One system, four identities. Each app owns a **metal** — that metal is
what money renders in. Never mix another app's metal in.

| App | Canvas | Accent | Metal | Feel |
|---|---|---|---|---|
| **Rider** | `#07070F` violet-black | `#34E6EC` cyan | **Platinum** `#CBD6DE` | Luxe Cool — glass over circuitry |
| **Driver** | `#08090D` graphite | `#34E6EC` cyan | **Gold** `#E6B450` | The earner's identity |
| **Merchant** | `#070C0B` teal-black | `#2DD4BF` teal | **Copper** `#C08552` | Commerce |
| **Admin** | `#0F172A` slate | `#8B5CF6` violet | — | Command |

Shared across all four: the ice palette (`#EAF3F6` text, muted at 55%,
faint at 40%), the glass system, the serif, and the motion curve.

## 3. The three hard rules

These come verbatim from `tokens.ts` and are the difference between
"on-brand" and "looks like our app".

**1. The signature gradient is a LIT EDGE, used ONCE per screen.**
A hairline, a route line, a selection edge. **Never a fill.** Rider's is
`['#6D28D9', '#34E6EC']`; driver's is `['#34E6EC', '#E6B450']`;
merchant's is `['#2DD4BF', '#C08552']`. Two lit edges on one screen and
the effect dies.

**2. Money renders in the metal.** Fares, balances, earnings, totals —
platinum on rider, gold on driver, copper on merchant. Never in the
accent, never in plain ice. This is how a user's eye finds the number
without reading.

**3. Display type is the serif.** Cormorant Garamond for anything that
carries weight — a fare, a destination, a headline. Body and UI are
Manrope; labels and data are Space Grotesk uppercase with wide tracking.

## 4. Type

| Role | Face | Notes |
|---|---|---|
| Display / values | `CormorantGaramond_500Medium` / `_600SemiBold` | Fares, destinations, headlines |
| Body / UI | Manrope 400–800 | Default |
| Labels / data / eyebrows | Space Grotesk 500–800 | UPPERCASE, tracking `2`–`2.5` |

Use `LUXE.tracking.micro` (2) for small caps labels, `.wide` (2.5) for
eyebrows. Never letterspace body copy.

## 5. Glass

```
fill:      rgba(255,255,255,0.045)   // LUXE.glassFill
border:    rgba(255,255,255,0.10)    // LUXE.glassBorder
hairline:  rgba(255,255,255,0.06)    // dividers, never a solid line
well:      #05060B                    // the deeper surface behind glass
```

Surfaces step: `SURFACE.base` → `containerLow` → `containerHigh` →
`containerHighest`. Step **one** level per nesting depth. Do not jump.

Glow is `#34E6EC` at 0.5 opacity, radius 18, zero offset — used on the
primary action only.

## 6. Motion

```
easing: [0.16, 1, 0.3, 1]              // ANIMATION.easing — the house curve
spring: { damping: 18, stiffness: 150, mass: 1 }
```

Every transition uses these. This is the single biggest lever on
"does it feel like Instagram or does it feel like a form" — a screen
that pops in with no easing reads as cheap regardless of how correct its
colours are.

Entrances stagger. Lists cascade. Nothing appears instantly except
error states, which must be immediate.

## 7. Z-index

Never write a magic number. Use the `Z` scale:

```
mapContent 1 → mapOverlay 10 → panel 20 → lockOverlay 30 →
locationConfirm 40 → sidebar 50 → modal 60 → toast 70 → offlineBanner 80
```

## 8. Money and region

Currency symbol and code come from `region_settings` (`currency`,
`currency_symbol`), never hardcoded. There are 9 hardcoded `TT$` and 17
hardcoded `'TTD'` in the tree today — every one is a bug, because the
same build ships to another island.

The split is **driver 80% / reserve 1.5% / platform 18.5%**, or driver
78% + commander 2% in a commander territory. `region_settings` is the
per-country source; `compute_ride_split` is the only place the maths
happens.

## 9. Never do this

- **Never hardcode a hex.** Import from `@gtaxi/design-system`. Of 97
  screens, 81 do; the 16 that don't are the travel vertical and the
  commander layer, and they are the reason this file exists.
- **Never state an outcome the database hasn't confirmed.** The rider
  design specifies a static "PAID SUCCESS" on the receipt. The code
  deliberately does **not** follow it — status is derived from
  `payment_status`, because a rider whose card declined was being told
  the payment succeeded. Where design and truth conflict, truth wins and
  the design gets updated.
- **Never leave a screen unreachable.** If it is registered in the
  navigator, something must open it. Five screens currently fail this.
- **Never use another app's metal.**

## 10. Depth parity

The rider design is 4,849 lines / 387 interactive states. The driver
design is 789 / 59 — roughly one sixth. That gap is why the driver app
feels thin, and it is a design debt before it is a code debt. New driver
work should be specified to rider depth, not built to the current
driver spec.
