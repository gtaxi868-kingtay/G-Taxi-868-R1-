# Phase 1 — Progressive unlock system audit (2026-08-14)

## Summary

**The tracking/computation half is real and well-built. The enforcement
half does not exist anywhere. And the tracking half is itself only
half-wired — only rides actually get counted.** Three separate, precise
findings, all confirmed against real code and real data, not assumed.

## 1. What's real (better than expected)

A genuine two-gate progression system exists:

- **`rider_progression`** — real table: `total_rides`,
  `total_grocery_orders`, `total_laundry_orders`, `total_nfc_taps`,
  `wallet_ever_funded`, `escape_ever_booked`, `total_carnival_bookings`,
  `level`, `unlocked_verticals[]`.
- **`progression_config`** — real, already-populated threshold table (see
  §4 below — this answers the directive's "what unlocks at 5 rides"
  question; it isn't blank, it's already a staged design).
- **`vertical_settings`** — a genuine second, independent admin-controlled
  gate (enable/disable + percentage rollout per vertical), separate from
  what a rider has personally earned.
- **`record_rider_activity(p_rider_id, p_event_type, ...)`** — a real,
  correctly-idempotent (keyed on `ride_id` via `rider_activity_log`)
  function that increments the right counter per event type and
  evaluates level-ups. Well-written.
- **`get_rider_progress`** (edge function, powers the rider app's home
  screen) — a genuinely thoughtful **fail-safe** design: if
  `vertical_settings` can't be read, it keeps the rider's earned list
  rather than blanking their home screen, and it separately reports
  `withheld_by_admin` so the UI can say "temporarily unavailable" instead
  of silently vanishing a vertical the rider knows they earned.

This is real engineering, not vaporware. The problem is entirely on the
enforcement side.

## 2. What's not real: zero server-side enforcement, anywhere

Checked every real money-moving entry point directly (not inferred):

| Entry point | Checks `unlocked_verticals` / `rider_progression`? |
|---|---|
| `grocery/index.ts` (grocery checkout) | **No** |
| `travel/index.ts` → `secure_escape_booking` (G-Escape) | **No** |
| `rider_nfc_pay/index.ts` (NFC/laundry payment) | **No** |
| `merchant_nfc_charge/index.ts` | **No** |

**A rider at Level 1 today can call any of these directly — grocery
checkout, an escape booking, an NFC laundry payment — and nothing stops
them.** The only place `rider_progression` is read outside the
admin/reporting tools is `create_ride` (for dispatch *priority*, not
gating — rides are always available) and `complete_ride` (for a loyalty
fare-rate perk at level ≥2, also not a vertical gate). `get_rider_progress`
computes the honest unlock state for display — nothing downstream of the
UI enforces it. **This confirms the directive's core worry exactly: it's
a UI suggestion today, not a real gate.**

## 3. Even the tracking is only half-wired

This is a finding the directive didn't anticipate, and it matters as
much as the missing gate: `record_rider_activity` handles seven event
types (`ride_completed`, `grocery_order`, `laundry_order`, `nfc_tap`,
`wallet_topup`, `escape_booking`, `carnival_booking`) — but it is called
from **exactly one place in the entire codebase: `complete_ride`**, with
`ride_completed`. Nothing calls it for a grocery order, a laundry
payment, an NFC tap, a wallet top-up, or an escape booking.

**Real consequence:** even if the gate were added tomorrow, no rider
could ever organically progress past Level 2, because the inputs to
Levels 3–5 (`total_grocery_orders`, `total_laundry_orders`,
`wallet_ever_funded`, `escape_ever_booked`) are permanently stuck at
zero/false. The counter side needs wiring into `grocery/index.ts`,
`rider_nfc_pay`/laundry payment, and `travel/index.ts` just as much as
the gate does — they're the same piece of missing work, not two.

**Confirmed in real data, not inferred:** all 3 real `rider_progression`
rows in production are at Level 5, `unlocked_verticals` = all five
verticals — but `total_grocery_orders = 0` and `total_laundry_orders = 0`
on every one of them. `record_rider_activity`'s level-up loop only
advances one level per call and only when that specific level's
threshold is met — a level-5 row with zero grocery/laundry activity is
not a state that function can produce. These three rows almost certainly
got there by direct SQL/admin seeding, not real usage — meaning **no
rider has ever organically progressed through this system past Level 2,
even in the limited sense that's currently possible.**

## 4. What currently unlocks what (already decided, not blank)

Real `progression_config` data — contrary to the directive's framing
("define exactly what unlocks... flag it back"), **this is not an open
question, it's an already-made, staged design:**

| Level | Threshold | Unlocks |
|---|---|---|
| 2 | 15 rides | `grocery` |
| 3 | 5 grocery orders | `laundry_nfc` |
| 4 | 3 laundry orders | `gwallet_bonus` (a wallet perk, not a vertical) |
| 5 | wallet funded once | `g_escape` |

**Flagging back for confirmation anyway, per the standing instruction not
to assume a product decision:** is this staged 15→5→3→1 design still the
intended final shape, or draft/placeholder values? I'm treating it as
real config, not inventing new numbers, but you should confirm it's
current.

**Separately, `vertical_settings` (the admin gate) currently allows:**
`ride_hailing`, `grocery`, `laundry`, `merchant_delivery` (all 100%
rollout); blocks `caribbean_travel` (=`g_escape`), `carnival`, `events`,
`b2b_logistics` (all disabled, 0%). So even a rider who *did* earn
Level 5 today would have G-Escape withheld by the admin gate — the two
gates are currently in tension (progression promises it at Level 5, the
platform switch has it off).

## 5. The marketing site makes different promises than the backend

`apps/g868/index.html` — the actual public-facing marketing site —
states unlock thresholds that **do not match `progression_config` on a
single card**, and includes two verticals with no backing config row at
all:

| g868 site says | Real `progression_config` says |
|---|---|
| Market (grocery): **"5 rides"** | **15 rides** |
| Laundry: **"2 Market orders"** | **5 grocery orders** |
| Wallet bonus: **"1 Laundry order"** | **3 laundry orders** |
| Tap: "Unlocks with Laundry" | **No config row exists for "Tap"/NFC as its own unlock at all** |
| Food: "Available with Market" | **No config row exists for "Food" as its own unlock at all** |

Every numeric claim on the public site is wrong relative to what the
backend actually defines, and two of the six advertised unlocks aren't
backed by any real threshold — they're marketing copy with nothing
behind them. If this site is what real users see before signing up, it's
currently promising a faster, different path than the one that would
actually exist even after the gate is built.

## What Phase 3 needs to close (not done here — that's the next phase)

1. Server-side enforcement on `grocery/index.ts`, `travel/index.ts`
   (`secure_escape_booking`), `rider_nfc_pay`, `merchant_nfc_charge` —
   check `unlocked_verticals` (or call `get_rider_progress`'s underlying
   logic) before allowing the transaction, not just displaying it.
2. Wire `record_rider_activity` into those same four entry points with
   the correct event type, so the counters it already knows how to
   compute actually move.
3. Resolve the g868 marketing-site mismatch — either the numbers on the
   site need to change to match `progression_config`, or
   `progression_config` needs to change to match what's publicly
   promised. Product decision, not mine to pick.
4. Confirm whether the tension in §4 (progression says Level 5 unlocks
   G-Escape; `vertical_settings` has it switched off entirely) is
   intentional (G-Escape isn't ready yet, correctly withheld) or an
   oversight.
