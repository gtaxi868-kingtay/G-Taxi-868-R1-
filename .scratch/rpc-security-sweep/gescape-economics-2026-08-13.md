# G-Escape real economics — business consult prep (pulled 2026-08-13)

Numbers only, pulled directly from the live database. No recommendations.

## 1. Every real escape_packages row — dated, with implied markup

**All 3 rows share the identical `created_at` timestamp
(`2026-06-24 08:53:17.243958+00`)** — they were inserted as a single
batch, not created organically over time. There is no real
seasonality or trend data to report; three same-instant data points
can't show one.

| Package | Departure | Price charged | Flight+lodging cost | Markup on flight+lodging only | Total real cost (incl. ground) | Markup on total incl. ground |
|---|---|---|---|---|---|---|
| Tobago Beach Escape | 2026-07-04 | $3,500.00 | $2,400.00 | 45.83% | $2,510.00 | 39.44% |
| Barbados Sun & Sand | 2026-07-11 | $5,500.00 | $3,450.00 | 59.42% | $3,572.00 | 53.98% |
| Grenada Spice Escape | 2026-07-18 | $4,200.00 | $2,600.00 | 61.54% | $2,715.00 | 54.70% |

(TTD, cents converted to dollars for readability. Departure dates
2026-07-04/11/18 are in the past relative to today — none of these
three packages have any real booking, confirmed, or historical
outcome tied to them; see §3.)

## 2. Ground transport: already priced in or sits on top?

Ground transport (`driver_origin_cost_cents` + `driver_destination_cost_cents`)
**is already included** in `total_real_cost_incl_ground` above — it is
not an additional cost sitting on top uncounted.

| Package | Driver origin cost | Driver destination cost | Total ground cost | % of total real cost |
|---|---|---|---|---|
| Tobago Beach Escape | $80.00 | $30.00 | $110.00 | 4.4% |
| Barbados Sun & Sand | $80.00 | $42.00 | $122.00 | 3.4% |
| Grenada Spice Escape | $80.00 | $35.00 | $115.00 | 4.2% |

**The stored `platform_margin_cents` field does not reconcile with
`price − total_real_cost_incl_ground`** — it was independently typed
at package creation (before today's pricing-enforcement fix), not
derived from the cost breakdown:

| Package | Stored platform_margin_cents | Price − total_real_cost | Discrepancy |
|---|---|---|---|
| Tobago Beach Escape | $900.00 | $990.00 | $90.00 |
| Barbados Sun & Sand | $1,728.00 | $1,928.00 | $200.00 |
| Grenada Spice Escape | $1,385.00 | $1,485.00 | $100.00 |

## 3. Real group sizes to date

**Zero.** `package_reservations` (the live booking table) has zero
rows. `escape_group_participants` (the legacy/disconnected table) also
has zero rows — zero distinct packages, zero distinct riders. No rider
has ever booked a G-Escape package through either system. There is no
real group-size data to report — not "small groups," not "below
threshold" — literally none exists yet.

## 4. Subscription/membership product status

A real subscription product **is defined** in `subscription_benefits`:

| Tier | Monthly price | Yearly price | Discount on rides | Notes on G-Escape |
|---|---|---|---|---|
| free | $0.00 | $0.00 | 0% | — |
| g_member | $35.00 | $350.00 | 15% off all rides | Feature list explicitly includes "No G-Escape booking fees" |

`g_member` was created 2026-06-16, ahead of the escape packages
(2026-06-24).

**Active subscriber count: 0.** `profiles.subscription_tier` /
`g_member_active` / `subscription_expires_at` exist and are tracked
per-user — real fields, not placeholders. Current state across all 11
real profiles: 100% on `free` tier, `g_member_active = false` for
every row, zero rows with a future `subscription_expires_at`.

The `g_member` tier's 15% discount is platform-wide (all rides), a
different number and a different mechanism than the `pricing_rules`
subscriber_discount_percent field seeded today for G-Escape
specifically (10%, currently disabled).

## 5. Real vs. aspirational country/territory coverage

**`airport_coordinates`** — 6 rows, all with real lat/lng:

| Code | Airport |
|---|---|
| ANU | V.C. Bird International, Antigua |
| BGI | Grantley Adams International, Barbados |
| GND | Maurice Bishop International, Grenada |
| POS | Piarco International, Trinidad |
| SKB | Robert L. Bradshaw International, St Kitts |
| TAB | ANR Robinson International, Tobago |

**`lodging_nodes`** — 3 rows, one per BGI/GND/TAB:

| Destination | Property | lat/lng populated | Merchant has an owner account linked |
|---|---|---|---|
| BGI | St Lawrence Beach House | No (NULL) | No |
| GND | Grand Anse Villa | No (NULL) | No |
| TAB | Store Bay Holiday Resort | No (NULL) | No |

**Aspirational only** — appear in `sync_flight_availability`'s
hardcoded route list but have no `airport_coordinates` row and no
`lodging_nodes` row: **St Lucia (SLU), Havana (HAV)**.

**In `airport_coordinates` but with no `lodging_nodes` row at all:**
**Antigua (ANU), St Kitts (SKB)**.

Net: 3 of 6 airport-coordinate destinations (BGI, GND, TAB) have both
an airport reference and a lodging property; all 3 of those lodging
properties are missing GPS coordinates and have no linked merchant
owner account. 3 more (ANU, SKB, POS as origin-only) have no lodging
counterpart at all. 2 more (SLU, HAV) exist only as names in a route
list, with no supporting data anywhere.
