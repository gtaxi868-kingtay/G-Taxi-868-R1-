# G 868 — The Errand Network

**Strategy. Written 2026-09-18.** Supersedes the "proxy purchase" framing.
Every technical claim was verified against the live database
(`ffbbuafgeypvkpcuvdnv`) or the deployed source. Unverified items are marked.

---

## The one line

> **G doesn't list stores. G goes and gets things.**

Everything below is downstream of that sentence.

---

## 1. The problem this solves

Every delivery company starts with the same trap: no stores, so no customers,
so no stores. The standard escape is to spend months and money onboarding
merchants before you have anything to sell. That is the bottleneck G-Taxi has
been stuck against — the app has 5 placeholder merchant rows, no real
catalogue, and nothing for a new user to do.

**The frame shift: the catalogue is not the supply.**

The catalogue is *information* — public, already online, free to assemble.
The actual supply is **drivers**, recruited by referral. So there is only one
side of the marketplace to solve, not two.

You are not building a marketplace. You are building an **errand network with
a borrowed catalogue**.

---

## 2. What the product actually is

A person lands via a shared link and immediately sees real local places they
recognise, assembled from publicly available information. They ask for
something. A driver who is *already heading that way* picks it up, pays at the
counter with their own cash, and delivers it. The person pays the driver back,
plus a fee for the trouble.

It is the phone call you already make to a friend who is passing the
grocery — with the waiting and the guessing removed.

**"Float them the help like a G would."** The brand and the mechanic are the
same thing. That is not a tagline retrofitted onto a feature.

---

## 3. The legal and relationship frame — this is not a footnote

The platform is an **agent acting for the buyer**. An errand service. It is
*not* a storefront representing a merchant, and must never present itself as
one.

- ✅ "We'll go and get it from Sammy's." — a favour, performed for the buyer.
- ❌ "Sammy's on G-Taxi." — a claim of partnership that does not exist.

Same order, completely different exposure. DoorDash built its early catalogue
from unpartnered listings and absorbed years of backlash for it. In Trinidad,
where everyone knows everyone, this is less a lawsuit risk than a
**relationship risk** — and relationships are the entire distribution
strategy. Getting this framing wrong poisons the merchant conversations that
come later (§6).

**Rule: never imply partnership, endorsement, or that an establishment is a
participant, until they have actually signed.**

---

## 4. The design rule that falls out of it

**Public prices are indicative, never contractual.**

Menus go stale. Prices move. If the display says TT$45 and the counter says
TT$52, somebody eats the difference — and it must never silently be the driver.

This is a core screen behaviour, not a disclaimer buried in settings:

- Show *approximate* pricing, clearly marked as an estimate.
- The request carries a **hard spend cap** the driver sees before accepting.
- The **receipt is the source of truth**; the real amount reconciles the order.
- Stock-outs follow `orders.substitution_policy` — already built, with
  `contact | substitute | cancel`.

---

## 5. The three loops

**1. Share → trust.**
The referral link is not marketing, it is **underwriting**. Whoever shares it
vouches for the person receiving it. That is how commitment is obtained
without a payment rail (§7). The referral system was repaired and
live-verified on 2026-09-15 and works today.

**2. Driver lists → quality.**
Drivers fulfil from their own chosen lists. A driver who hits that grocery
three times a week knows the real prices and what is actually in stock. So the
catalogue improves by being used, at zero cost:

> public data (unverified) → driver-validated → merchant-partnered

**3. Volume → partnership.**
The merchant signs *because* of the orders, not before them.

---

## 6. The merchant flip

This is the strongest second-order effect, and it resolves the question that
started this whole line of thinking ("how do I seed real merchants?").

**You don't seed them. You discover them.**

Run errands for weeks, watch what people actually order, then walk into the
places that came up most with real numbers: *"we brought you 40 orders last
month — want a G-Touch Point on your counter and a proper listing?"*

The order history **is** the pitch. That is a dramatically easier sale than
cold-pitching an owner into an empty app, and it carries no risk of having
listed a business that never agreed.

---

## 7. Why the rider has little skin in the game — and the answer

**Root cause: there is no payment rail that can take a commitment before
delivery.** Card pre-auth is how every other platform solves this. Stripe is
unconfigured, WiPay returns `coming_soon`, and the rider top-up screen is
Stripe-only — so riders cannot fund a wallet at all today. Nothing can be held
before the driver has already spent their own money.

Left open, a stranger creates an account in seconds, orders to a false
address, and vanishes. The driver eats it. Three of those and there are no
drivers.

**The answer is social and physical collateral, because financial collateral
is unavailable:**

- **Vouched-only at launch.** Errand ordering unlocks only for riders who
  arrived through a real member's referral code. The founder's own words:
  *"these would be people drivers already know."*
- **Low first-order cap**, rising with completed, accepted deliveries. Reuses
  the existing `rider_progression` ladder, and makes the **spending limit
  itself the retention loop** — a better hook than any discount.
- **Keychain verification** (`identity_tags`) as a stronger tier later —
  currently blocked, zero tags issued.

**State the limit plainly: social collateral does not scale.** It holds for
the first few hundred people in a seeded community. This is a **launch
mechanism, not a permanent architecture.** A real prepay rail is required
before this opens to the public — the founder has indicated WiPay can be
enabled when needed, and that is what eventually lets this go beyond people
the drivers already know.

---

## 8. The economics — founder's model (decided 2026-09-18)

The founder's own words: *"drivers close to person ordering… order goes in,
they get curbside pick up, cash or prepaid locked in, and app gets 5%
overall, because a distance by time of order acceptance, pick up to drop off
kinda thing."*

This replaces the earlier flat "TT$5 connection fee" idea, which left money on
the table on every large basket.

### The three parts

**1. Driver fee = distance × time, from acceptance → pickup → drop-off.**
Uses the ride rates already live in `pricing_config`: `PER_KM_CENTS` = 175
(TT$1.75/km) and `PER_MIN_CENTS` = 95 (TT$0.95/min). The driver is paid for
the actual work — getting there, collecting, and delivering.

**2. Platform fee = 5% of the whole order (goods + driver fee), with a floor.**
Charged to the rider **on top**, not carved out of the driver's fee.

**3. Payment: prepaid-and-locked, or cash on delivery.**

### Worked examples (real rates)

| | Kitten litter — driver already at the grocery | Weekly shop — driver 2 km away |
|---|---|---|
| Approach (accept → pickup) | 0 km, 0 min | 2 km, 6 min |
| Curbside collection | 3 min | 3 min |
| Delivery (pickup → drop-off) | 3 km, 8 min | 5 km, 14 min |
| **Driver fee** | 3 km + 11 min = **TT$15.70** | 7 km + 23 min = **TT$34.10** |
| Goods | TT$60.00 | TT$250.00 |
| 5% of goods + fee | TT$3.79 | **TT$14.21** |
| **Platform fee (5%, floor TT$5)** | **TT$5.00** | **TT$14.21** |
| **Rider pays** | **TT$80.70** | **TT$298.31** |
| Driver gets | TT$15.70 + TT$60 reimbursed | TT$34.10 + TT$250 reimbursed |

### Why this is right — three properties worth keeping

**It stops leaving money on the table at both ends.** A flat TT$5 earns more
on a small basket; 5% earns ~3× more on a big one. **5% with a TT$5 minimum**
captures the better of the two every time.

**It prices the favour automatically.** Because the approach leg is charged,
a driver who is *already at the store* is the cheapest option for the rider
with no special logic. "As you near by the grocery" isn't a feature to build —
it falls out of the formula. Matching should minimise total
acceptance → pickup → drop-off distance, which naturally picks that driver.

**It makes curbside the default, correctly.** The old
`DELIVERY_DRIVER_PAYOUT_CENTS` (TT$20) was anchored to ~35 minutes of
*in-store shopping*. Curbside removes that labour — which is exactly why
distance × time is the right model here, not the grocery base rate.

### Two guardrails — both mandatory

**1. The 5% goes on top. Never carve it out of the driver's fee.** On the
weekly shop, carving it out leaves the driver TT$19.89 for fronting TT$250 of
their own money. Drivers would decline every large basket — exactly the orders
worth the most.

**2. Cap the approach distance.** A rider should never be charged to bring a
driver 15 km for kitten litter. Set a maximum approach radius; beyond it, no
match rather than an expensive one.

### Two ordering modes

- **Order ahead → curbside** — the place takes phone, WhatsApp, or online
  orders. The order is placed on acceptance; the driver only collects. This is
  the fast, cheap default, and **drafting that order message is a real job for
  G.**
- **Driver shops** — the place doesn't take orders. In-store time is billed at
  `STOP_WAIT_FEE_PER_MIN_CENTS` (TT$1.50/min), **which already exists**.

### Payment modes — and what they do to trust

- **Prepaid, locked in** (needs WiPay). The rider pays the goods cap + fees up
  front and it's held. The driver still pays the store, but reimbursement is
  guaranteed — **driver risk drops to near zero.** This is what lets the
  service open beyond vouched riders.
- **Cash on delivery.** Vouched riders only, with the first-order cap (§7).

**This is the real value of switching WiPay on:** it isn't a convenience
feature, it's what removes the driver's risk and unlocks the public launch.

### Who wins

- **Rider:** gets it faster than calling around, pays a transparent fee.
- **Driver:** paid for the real distance and time, never fronts at risk on
  prepaid orders.
- **Merchant:** gets a real order at full retail, ready for curbside — which
  is the pitch for signing them later (§6).
- **Platform:** 5% of everything that moves, with a floor.

---

## 9. What first-run has to feel like

Someone taps a shared link and, **within one session**, sees real places they
recognise, asks for something real, and gets it.

No empty state. No waiting list. No "coming soon."

That is the single test of whether this frame is working.

---

## 10. What would kill this

- **Presenting listings as partnerships** (§3). Poisons the merchant
  relationships that are the whole second act.
- **Opening past vouched riders before a payment rail exists** (§7). Fraud
  losses land entirely on drivers, and drivers leave.
- **Treating errands as dispatched deliveries** (§8). The economics only work
  opportunistically.
- **Unbounded price drift.** Without the cap plus receipt reconciliation, the
  difference has no owner.
- **Perishables.** A refused hot-food delivery is a total loss. Consider
  excluding or tightly capping food in the pilot.
- **AI auto-ordering through third-party websites.** Real terms-of-service and
  reliability risk. A driver buying in person is the safe v1.

---

## 11. Open decisions

1. ~~**The errand fee, and how it splits.**~~ **DECIDED 2026-09-18** (§8):
   driver fee = distance × time (acceptance → pickup → drop-off); platform
   takes 5% of goods + driver fee, charged on top; cash or prepaid.
   Remaining sub-decisions:
   - **The floor** — TT$5 recommended (§8 table).
   - **Maximum approach radius** — how far will you bring a driver?
   - **"5% overall" confirmed as goods + driver fee?** This document assumes
     yes. If it's 5% of goods only, the platform earns less on every order.
1b. ~~**Is there a driver payout *on top* of the fee?**~~ **Resolved** — no.
   The distance × time fee *is* the driver's pay; the old TT$20 shopping base
   does not apply to curbside errands.
1c. **Who eats an over-cap purchase?** Recommended policy: the driver must
   call the rider *before* paying at the till; if they don't, the excess is
   theirs. This must be policy and in the driver terms before order one.
1d. **Who reimburses a driver when a rider refuses at the door?** Platform
   reserve, or nobody? This is the single biggest driver-trust risk.
2. **Is food in or out of the pilot?** (Perishable refusal risk.)
3. **Who are the first ~20 vouched riders, and which drivers vouch for them?**
4. **First-order spend cap** — suggest TT$50–100.
5. **WiPay: enable now or after the pilot?** Not required to prove the model
   with vouched cash riders — but it is what powers the prepaid mode that
   removes driver risk and opens the service to the public (§8). Founder has
   said he will switch it on. Recommended: pilot in cash with vouched riders,
   switch WiPay on before opening to anyone else.

---

## 12. The cheapest way to test this before building anything

Run **five errands by hand over WhatsApp** — one known driver, five vouched
people. Record real goods cost, real detour distance, real time taken, and
whether anybody refused delivery.

That produces the two numbers this entire model depends on — **the real unit
economics and the real refusal rate** — for the price of a weekend instead of
a sprint.

---

## Appendix — verified technical position (2026-09-18)

**Already exists and is reusable:**
`orders.merchant_id` is nullable and `orders.status`/`task_type` have no CHECK
constraints, so an order with no registered merchant is legal today.
`nfc_event_handler` already creates orders with `total_cents: 0` — precedent
for "an order exists before its price does". `orders` already carries
`rider_notes`, `ai_generated_list jsonb`, `substitution_policy`,
`delivery_fee_cents`. `vision_pickup` (Gemini) already resolves a landmark and
refines a pin from a photo. `identify_product` (Gemini) already estimates an
item price. `parse_receipt` (Google Vision OCR) already extracts an amount —
currently pointed at bank deposit slips, not store receipts.
`process_cash_delivery_settlement` already implements "driver holds the cash,
keeps their payout, is debited the remainder". Drivers may already run a
negative balance to TT$300 (`check_driver_debt_limit`).

**Known blockers:**
No estimate/cap/actual price concept on `orders` — one money column only.
`process_cash_delivery_settlement` hard-fails merchant-less orders
(`'Merchant has no owner'`). `calculate_delivery_driver_payout` measures
distance from `merchants.lat/lng`, so a merchant-less errand silently pays the
driver base-only. `confirm_cash_collection` is deployed but has no UI caller.
`g_rider_concierge` is deliberately payment-free and cannot express an
unregistered establishment. Riders have no zone link. The public site reads
`?ref=` but never writes `referred_by`, so shares are currently unmeasurable.
