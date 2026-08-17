# G-Escape flight/hotel booking — production audit (2026-08-13)

**Production audit: 42/100, blocked, because the system has zero real
booking capability with either an airline or a hotel — everything past
"the group hit its target" still requires you to personally call and
book, exactly the pain point you raised.**

This isn't a bug-hunt result. It's an architecture finding: the code
that exists is well-built for what it does (capacity pooling, escrow,
payment capture, ride-transfer scheduling, admin approval workflow) —
but "what it does" stops at *detecting demand and collecting money*. No
code path anywhere calls a real airline or hotel booking API. Every
"confirmed" trip in the database represents an internal capacity
allocation, not a real reservation.

## Blockers — why you still have to call hotels and airlines

**1. There is no airline/hotel booking API integration at all, anywhere.**
`sync_flight_availability` and `sync_lodging_availability` only call
*search/shopping* endpoints (Amadeus `flight-offers`, Booking.com
`hotelAvailability`) to populate a pricing-reference cache
(`flight_cache`/`lodging_cache`) for admins deciding which routes to
open. Neither this repo nor any edge function ever calls a *booking* or
*reservation* endpoint against either provider — there's no PNR
creation, no room hold, nothing. `escape_packages` rows (the actual
sellable product) are hand-entered by an admin who has already secured
the real flight/hotel by some out-of-band means — the code never
questions where that arrangement came from.

**2. The flight sync hits Amadeus's TEST sandbox, not production.**
`sync_flight_availability/index.ts` calls
`https://test.api.amadeus.com/...` for both auth and flight-offers —
the sandbox endpoint returns synthetic test data, not real fares or
real seat availability, regardless of whether real credentials are
configured. Even the *pricing research* this function is meant to
support is currently working from fictional numbers.

**3. The hotel sync sends a malformed request — it has likely never
returned real data.** `sync_lodging_availability/index.ts` sets
`hotel_ids` to a country code (`'TT'`, `'BB'`, `'GD'`, `'AG'`), but
Booking.com's `hotelAvailability` endpoint expects actual hotel IDs from
a partner account, not a country. This is also the legacy
Connectivity/XML partner API, which only returns availability for
properties you already have a partnership with — it was never going to
support "search all hotels in Tobago" even with the parameter fixed.
CLAUDE.md's external-links list still points at the Booking.com
affiliate-program *signup* page, consistent with no real partner account
existing yet.

**4. The live confirmation path has no field for a real confirmation
number.** `flight_blocks` — the table riders actually book against —
has no `booking_reference`/`pnr`/`confirmation_code` column at all, only
`status`, `confirmed_at`, and a free-text `notes` field. The function
that flips a block to `CONFIRMED` and generates rider itineraries,
`execute_escape_group_confirmation`, takes a single parameter
(`p_flight_block_id`) — there's no argument for a real airline
confirmation code anywhere in its signature. It writes an `AVIATION`
itinerary leg with `reference_code` hardcoded to `NULL`. So even after
you personally call the airline and get a confirmation number, there is
no structured place in the live system to put it — nothing a rider's
in-app itinerary could ever show them.

**5. A real booking-reference field exists, but on the wrong flow, and
nothing reads it back.** The admin UI (`EscapeManagement.tsx`) does have
a "confirm with booking ref" action, which calls `admin_escape_action`
and does write into a real column, `escape_packages.charter_reference`.
But this action's participant-status updates operate on
`escape_group_participants` — the older system CLAUDE.md already flags
as disconnected from what riders actually book through
(`package_reservations`/`flight_blocks`). And `charter_reference` is
never read by `execute_escape_group_confirmation` or anything in the
rider-facing itinerary path — it's a write-only field today. Entering a
real confirmation number here currently has no effect on what a rider
sees.

**6. `admin_escape_action` exists as two different overloads
simultaneously**, one with `(uuid, text, text, text)` and one with
`(uuid, text, timestamptz, timestamptz, text, text)`. The admin UI's
exact call shape (`p_package_id, p_action, p_booking_ref, p_message`)
resolves to the first. Whether the second overload is dead code, a
migration in progress, or a real ambiguity risk for some other caller
wasn't fully traced — flagging per CLAUDE.md's own documented rule that
overload resolution needs confirming per-caller, not assumed.

## What's actually solid (short, because you asked for the risk, not reassurance)

- Capacity pooling, hold expiry, and payment capture (`secure_escape_booking`,
  `capture_escape_wallet_payment`, WiPay/Stripe fallback) are well-built.
- The tipping-point sweep (`escape_sweep_tipping_points`) is a genuinely
  good design: proposes a "book now" action to admin with a real 24-hour
  safety-net auto-release so nothing is lost to inaction. This is the
  right shape for the human-in-the-loop step — it just has nothing to
  write the resulting confirmation into.
- Escrow ledger, driver-transfer ride scheduling, and merchant/platform
  payout on confirmation (`execute_escape_group_confirmation`) are
  thorough and internally consistent.

## High-value fixes, in the order that unblocks the most

1. **Give `flight_blocks` real confirmation fields** — `booking_reference`,
   `confirming_airline`, maybe `pnr_locator` — and thread them through
   `execute_escape_group_confirmation` (or a preceding admin step) so a
   real confirmation number becomes part of the rider's itinerary. This
   is the single fix that would let you record what you booked by phone
   and have it actually reach the rider — smallest change, biggest
   relief for the immediate pain.
2. **Point the sync functions at the right endpoints** — production
   Amadeus host, correct Booking.com request shape (or, more realistically,
   a different Booking.com product — the Connectivity/XML API assumes
   you're the property, not a demand-side search client; the
   Booking.com Affiliate Partner API is closer to what "search hotels
   in Tobago" needs). This fixes the *research* data admins use to
   decide what to open, not the booking gap itself.
3. **Decide, deliberately, whether real self-service booking APIs are
   in scope at all.** Amadeus's actual booking/ticketing API (Flight
   Create Orders) and a real Booking.com reservation flow are
   substantial vendor-integration projects — API certification, travel
   business licensing considerations vary by jurisdiction, and typically
   weeks of work each, not something to bolt on inline. If the real goal
   is "stop me from having to personally call," that's the eventual
   target — but it's a scoped project of its own, and shouldn't get
   started as a side effect of a hardening pass. Recommend treating it
   as its own planning conversation once (1) is in place and buys you a
   working manual-entry path.
4. **Consolidate `admin_escape_action`'s two overloads** and confirm
   which admin flow (`admin_confirm_escape_seats` edge function,
   `admin_escape_action` RPC, or both) is the one actually meant to be
   live — right now there are three separate "confirm a group" code
   paths (two of which write into the disconnected participant table),
   and picking one canonical path would remove a lot of the confusion
   found here.

## Evidence checked

- `supabase/functions/travel/index.ts` (832 lines, all 7 actions)
- `supabase/functions/sync_flight_availability/index.ts`
- `supabase/functions/sync_lodging_availability/index.ts`
- `supabase/functions/admin_confirm_escape_seats/index.ts`
- `apps/admin/src/pages/EscapeManagement.tsx`
- Live function bodies (via `pg_get_functiondef`, fresh reads):
  `execute_escape_group_confirmation`, `escape_sweep_tipping_points`,
  `admin_escape_action` (both overloads)
- Live schema: `flight_blocks` columns (via `information_schema`)
- CLAUDE.md's own documented note on the two-escape-system split

## Evidence missing

- Whether `escape_packages.charter_reference` or `flight_blocks.notes`
  is being used as a real (if informal) manual workaround today — worth
  asking directly rather than inferring from schema alone.
- Real Amadeus/Booking.com account status (test vs. production
  credentials, partner-program enrollment) — `AMADEUS_API_KEY`/`SECRET`
  and `BOOKING_API_KEY` presence was confirmed as a documented
  environment variable in CLAUDE.md, but whether they're populated with
  live-tier credentials wasn't checked here.
- Whether any *other* system (a spreadsheet, a different tool) already
  serves as the real booking-reference record, which this audit
  wouldn't see.

## Next action

Want me to start with fix (1) — adding real confirmation fields to
`flight_blocks` and threading a booking reference through
`execute_escape_group_confirmation` into the rider itinerary? That's the
one change here that's genuinely scoped for a single session (schema +
one function + verification), and it's the one that turns "I called the
airline, now what" into an actual recorded, rider-visible fact instead
of a dead end.
