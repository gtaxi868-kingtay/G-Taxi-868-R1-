# FLEET & ASSET ARCHITECTURE — MONETIZATION AUDIT V3

**Date:** 2026-05-22  
**Author:** Principal Financial Architect  
**Scope:** Full-stack monetization across ride-share, fleet leasing, dealership brokerage, and regional expansion

---

## EXECUTIVE SUMMARY

The G-Taxi platform has evolved from a single-sided ride-hailing marketplace into an **asset-generating, fleet-owning, multi-region financial machine**. This document proves the architecture supports the complete lifecycle:

1. **Broker a car sale** — capture lead, manage financing, auto-invoice dealership commission
2. **Lease it to a driver** — own the asset, collect daily + mileage fees
3. **Capture 19% ride-take + lease fee** — dual revenue on every fleet-driver trip
4. **Scale to any country** — one config change, zero code changes

---

## FINANCIAL MODEL OVERVIEW

```
                    ┌─────────────────────────────────────┐
                    │         REGION SETTINGS              │
                    │  (Currency, Pricing, Compliance)     │
                    └────────────────┬────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│ DEALERSHIP       │     │  RIDE-SHARE ENGINE   │     │  FLEET LEASING       │
│ BROKERAGE        │     │                      │     │  ENGINE              │
│                  │     │  Rider pays 100%      │     │                      │
│ Dealer sells     │     │  └→ Driver 81%       │     │  We own vehicles     │
│  vehicle         │     │  └→ Platform 19%     │     │  Driver leases       │
│  └→ Lead         │     │                      │     │  └→ Daily fee (100%  │
│  └→ Financing    │     │  IF fleet driver:    │     │      margin)         │
│  └→ Invoice      │     │  └→ Lease deducted   │     │  └→ Mileage fee (100%│
│                  │     │      before payout    │     │      margin)         │
│ Revenue:         │     │                      │     │                      │
│  Commission on   │     │  Revenue: 19% take    │     │  Revenue:            │
│  vehicle sale    │     │   + fleet deductions  │     │   100% of fee        │
│  (2.5-5% typ)    │     │  (0% marginal cost)   │     │   (0% marginal cost) │
└─────────────────┘     └──────────────────────┘     └──────────────────────┘
```

---

## REVENUE STREAMS

### Stream 1: Ride-Share Take Rate (Base Business)

| Component | Rate | Per $100 Ride | Recipient |
|---|---|---|---|
| Gross fare | 100% | $100.00 | Rider pays |
| Driver payout | 81% | $81.00 | Driver |
| Platform commission | 19% | $19.00 | G-Taxi |
| *Pioneer tier* | 19% commission | $81.00 driver | Driver |
| *Standard tier* | 22% commission | $78.00 driver | Driver |
| *Top earner tier* | 17% commission | $83.00 driver | Driver |

### Stream 2: Fleet Leasing Income (100% Margin)

| Fee Type | Rate | Per Unit | Annual per Driver (est.) |
|---|---|---|---|
| Daily lease fee | TT$30.00/day | Per calendar day | TT$10,950 |
| Mileage fee | TT$0.50/km | Per km driven | TT$5,000 (10k km/yr) |
| Security deposit | TT$0-5,000 | One-time | TT$0-5,000 float |
| **Total per fleet driver** | | | **TT$15,950+/year** |

**Margin structure:** $0 marginal cost per additional km or day — the vehicle is already purchased. Every dollar collected is pure profit margin.

### Stream 3: Dealership Brokerage (Asset Turnover)

| Component | Rate | Per $120,000 TTD Vehicle |
|---|---|---|
| Brokerage fee (percentage) | 2.5% typ | TT$3,000 |
| Brokerage fee (fixed) | TT$0-10,000 | Per contract |
| Payment terms | Net 30 | From financing approval |

**Lifetime value per driver acquired through brokerage:**
- Brokerage commission: TT$3,000 (one-time)
- Ride-share take (30 trips/mo × TT$40 avg × 19%): TT$228/mo
- Fleet lease (if fleet vehicle): TT$1,329/mo
- **18-month LTV: ~TT$31,000+**

### Revenue Comparison

| Metric | Standard Driver | Fleet Driver | Delta |
|---|---|---|---|
| Monthly ride gross | TT$3,000 | TT$3,000 | — |
| Platform take (19%) | TT$570 | TT$570 | — |
| Lease deduction | $0 | -TT$900 (30 d @ $30) + -TT$416 (833 km @ $0.50) | -TT$1,316 |
| Driver net | TT$2,430 | TT$1,114 | -54% |
| Platform + lease total | TT$570 | TT$1,886 | **+231%** |
| Platform margin on driver | 19% | **63%** | +231% |

> **The fleet model triples platform margin per driver** without increasing ride fares. The driver pays less per month than a standard car payment while the platform captures 63% effective margin.

---

## MODULE 1: DEALERSHIP BROKERAGE ENGINE

### Tables

| Table | Purpose |
|---|---|
| `dealer_partners` | Registered dealerships, commission terms, bank details |
| `vehicle_inventory` | Vehicles listed by dealers, pricing, specs, status |
| `vehicle_sales` | Lead-to-sale pipeline tracking, brokerage fee computation |

### Business Logic Flow

```
Driver browses inventory → Creates lead
    → Status: lead
    → Status: test_drive_scheduled
    → Status: financing_pending
    → Status: financing_approved
        └→ RPC handle_brokerage_commission()
            └→ Calculates fee (percentage or fixed)
            └→ Generates invoice ID (BRK-YYYYMMDD-XXXXXXXX)
            └→ Sets brokerage_invoiced_at
        └→ Dealer receives invoice (Net 30)
    → Status: sale_completed
        └→ Vehicle marked as sold
        └→ Full audit trail recorded
```

### Edge Function Actions

| Action | Method | Auth | Description |
|---|---|---|---|
| `list_vehicles` | GET | Authenticated | Browse available inventory with filters |
| `list_dealers` | GET | Authenticated | List active dealer partners |
| `create_lead` | POST | Authenticated | Driver creates a sales lead |
| `update_lead_status` | POST | Admin | Move lead through pipeline, trigger brokerage |
| `dealer` | POST | Admin | Create/update dealer partner |
| `vehicle` | POST | Admin | Add vehicle to inventory |
| `report` | GET | Admin | Brokerage revenue report |

### Revenue Recognition

Brokerage revenue is recognized at **financing approval** (not at delivery), matching accrual accounting standards. The invoice is generated immediately and due per the dealer's payment terms (default Net 30).

---

## MODULE 2: FLEET LEASING ENGINE

### Tables

| Table | Purpose |
|---|---|
| `fleet_vehicles` | Vehicles we own/lease, maintenance tracking, value |
| `fleet_leases` | Lease agreements linking drivers to vehicles |
| `lease_payments` | Individual deductions (daily, mileage, hybrid) |

### Lease Types

| Type | Daily Fee | Mileage Fee | Weekly Minimum | When Charged |
|---|---|---|---|---|
| **Daily** | TT$30.00 | — | — | Once per day via cron/API |
| **Mileage** | — | TT$0.50/km | — | Per ride via complete_ride |
| **Hybrid** | TT$30.00 | TT$0.50/km | TT$500 | Daily + per ride |

### Deduction Flow (Per Ride)

```
Ride completed by fleet driver (complete_ride edge function):
  1. Process payment (wallet/card/cash)
  2. Update ride status → completed
  3. Log platform revenue
  4. → CALL deduct_lease_for_ride(ride_id) [NEW]
       a. Resolve driver's active fleet lease
       b. If mileage/hybrid: calculate km * mileage_rate
       c. Acquire advisory lock on (driver + ride) — prevents double-deduction
       d. Check driver wallet balance
       e. If sufficient:
            - Debit driver wallet (lease_deduction)
            - Credit platform wallet (lease_income)
            - Record lease_payment (status: deducted)
            - Update ride.lease_deduction_cents
            - Update platform_revenue_logs.lease_deduction_cents
       f. If insufficient:
            - Record lease_payment (status: failed)
            - Log error, do NOT block ride completion
  5. Return response with lease deduction info
```

### Daily Fee Flow (Cron)

```
Daily cron job → POST fleet_lease_engine?action=apply_daily_fees
  → For each active daily/hybrid lease:
    1. CALL deduct_daily_lease_fee(lease_id, date)
    2. Check if already charged today (idempotent)
    3. Deduct daily_rate from driver wallet
    4. Credit platform wallet
    5. Record lease_payment
```

### Driver Wallet Impact

| Transaction | Debit Driver | Credit Platform | Type |
|---|---|---|---|
| Ride payout (81%) | +TT$81.00 | — | `driver_payout` |
| Platform commission (19%) | — | +TT$19.00 | `platform_commission` |
| Lease mileage deduction (16.6 km @ $0.50) | -TT$8.30 | +TT$8.30 | `lease_deduction` / `lease_income` |
| Daily lease fee | -TT$30.00 | +TT$30.00 | `lease_deduction` / `lease_income` |

> The platform receives BOTH the 19% ride commission AND the lease fee. The driver's wallet reflects the combined deduction in a single transaction.

### Deduction Priority

The lease deduction uses the same hardened wallet infrastructure as ride payments:
- **Advisory lock** on driver to prevent concurrent deductions
- **Idempotency** via deduplication check (ride_id + deducted_from_ride flag)
- **Atomic transaction**: all-or-nothing within the RPC

---

## MODULE 3: REGIONAL SETTINGS ENGINE

### The `region_settings` Table — Schema Summary

```sql
CREATE TABLE region_settings (
    code            TEXT UNIQUE NOT NULL,     -- 'TT', 'BB', 'JM'
    name            TEXT NOT NULL,            -- 'Trinidad and Tobago'
    currency        TEXT DEFAULT 'TTD',       -- Currency code
    currency_symbol TEXT DEFAULT 'TT$',       -- Display symbol

    -- Take-rates (per-region configurable)
    default_commission_rate      NUMERIC(5,2)  -- 22.00%
    default_driver_payout_rate   NUMERIC(5,2)  -- 81.00%
    default_merchant_split_rate  NUMERIC(5,2)  -- 5.00%

    -- Pricing (per-region configurable)
    base_fare_cents              INTEGER  -- 1600
    per_km_cents                 INTEGER  -- 175
    per_min_cents                INTEGER  -- 95
    min_fare_cents               INTEGER  -- 2200
    cancellation_fee_cents       INTEGER  -- 500

    -- Enforcement
    gps_proximity_dropoff_meters INTEGER  -- 150
    gps_proximity_pickup_meters  INTEGER  -- 120

    -- Lease defaults
    lease_daily_rate_cents       INTEGER  -- 3000
    lease_mileage_rate_cents     INTEGER  -- 50

    -- Compliance (JSON blob for regulatory APIs)
    compliance_config            JSONB

    -- Wallet limits
    driver_online_debt_limit_cents  INTEGER  -- 60000
    ride_creation_debt_limit_cents  INTEGER  -- 60000
    min_wallet_topup_cents          INTEGER  -- 2000
    max_wallet_topup_cents          INTEGER  -- 100000
);
```

### Copy-Paste Expansion to Barbados (Example)

```bash
curl -X POST https://api.gtaxi.com/functions/v1/region_settings?action=create \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{
    "code": "BB",
    "name": "Barbados",
    "currency": "BBD",
    "currency_symbol": "BB$",
    "locale": "en-BB",
    "timezone": "America/Barbados",
    "template_region_code": "TT"
  }'
```

This single API call:
1. Creates a complete region config cloned from Trinidad
2. Sets Barbados-specific currency (BBD), locale, timezone
3. Inherits all pricing, take-rates, lease defaults, and compliance config
4. Region is immediately active — drivers, rides, and fleet operations can reference it
5. Zero code changes required. Zero deploys. Zero migrations.

### What Changes Per Region

| Aspect | Trinidad (TT) | Barbados (BB) | Jamaica (JM) |
|---|---|---|---|
| Currency | TTD | BBD | JMD |
| Symbol | TT$ | BB$ | J$ |
| Base fare | 1,600¢ ($16.00) | 1,600¢ ($16.00 BBD) | 1,600¢ ($16.00 JMD) |
| Commission | 22% | 22% | 22% |
| Lease daily rate | 3,000¢ ($30.00) | 3,000¢ ($30.00 BBD) | 3,000¢ ($30.00 JMD) |
| Fleet present? | Yes | Planned | No |
| Compliance | MoWT + DPA 2011 | BITT + PDPA | TDA + DPA |

### Verification

```
GET /functions/v1/region_settings?action=validate&region_id={id}

Returns:
- 10 checks (currency, pricing, commission, lease rates, etc.)
- is_ready: boolean
- failed_checks: array of unmet requirements
```

---

## MARGIN PROTECTION ANALYSIS

### How Fleet Income Offsets Operational Overhead

The ride-share side has real operational costs: payment processing (2.9% + $0.30 per transaction), customer support, driver acquisition, insurance. The 19% take rate, after these costs, may net 8-12%.

**Fleet leasing is 100% margin.** The vehicle is a fixed asset. Maintenance costs are predictable and passed through in lease pricing. Every dollar collected in lease fees drops directly to the bottom line.

### Hypothetical P&L: 100 Standard Drivers vs. 100 Fleet Drivers

| Line Item | 100 Standard Drivers | 100 Fleet Drivers | Delta |
|---|---|---|---|
| Monthly ride gross | $300,000 | $300,000 | — |
| Platform take (19%) | $57,000 | $57,000 | — |
| Lease income | $0 | $132,900 | +$132,900 |
| **Gross revenue** | **$57,000** | **$189,900** | **+233%** |
| Payment processing (2.9%) | -$8,700 | -$8,700 | — |
| Driver support | -$5,000 | -$5,000 | — |
| Insurance (fleet) | $0 | -$20,000 | -$20,000 |
| Vehicle depreciation | $0 | -$40,000 | -$40,000 |
| Maintenance | $0 | -$10,000 | -$10,000 |
| **Net revenue** | **$43,300** | **$106,200** | **+145%** |
| **Margin** | **14.4%** | **35.4%** | **+21pp** |

> Fleet drivers generate 145% more net revenue than standard drivers. The fleet operation turns a 14.4% margin business into a 35.4% margin business.

### Debt Recovery Through Lease Deductions

When a fleet driver's wallet is insufficient to cover a lease deduction:
1. The deduction records as `status: 'failed'` in `lease_payments`
2. The driver accrues a negative wallet balance
3. Future ride payouts automatically reduce the debt (wallet is debited first)
4. If debt exceeds region-specific limit (`driver_online_debt_limit_cents`, default TT$600), the driver cannot go online
5. This creates a **self-correcting debt recovery system** — no manual collections needed

---

## DATA FLOW ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                    EDGE FUNCTIONS LAYER                      │
├─────────────────┬──────────────────┬───────────────────────┤
│ dealer_brokerage │ fleet_lease_engine │ region_settings      │
│  (leads, sales,  │  (leases, fees,   │  (CRUD, resolve,     │
│   invoices)      │   daily cron)     │   validate)           │
├─────────────────┴──────────────────┴───────────────────────┤
│                        SHARED LAYER                         │
│           _shared/auth.ts → requireAuth / requireAdmin      │
│           _shared/sentry.ts → error capture                 │
│           _shared/push.ts → notifications                   │
├─────────────────────────────────────────────────────────────┤
│                      RPC LAYER (Postgres)                   │
├──────────┬───────────┬────────────┬───────────┬────────────┤
│ resolve_ │ calculate_ │ deduct_   │ deduct_   │ handle_    │
│ region_  │ _lease_   │ _lease_   │ _daily_   │ brokerage_ │
│ for_     │ deduction │ for_ride  │ lease_fee │ commission │
│ location │           │           │           │            │
└──────────┴───────────┴────────────┴───────────┴────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                  ▼
    ┌──────────────┐ ┌────────────────┐ ┌──────────────┐
    │ wallet_      │ │ platform_      │ │ lease_       │
    │ transactions │ │ revenue_logs   │ │ payments     │
    └──────────────┘ └────────────────┘ └──────────────┘
```

### Transaction Atomicity

Every financial flow uses PostgreSQL transactions with:
- **Advisory locks** (ride-level, driver-level) — prevent double-spend
- **Unique constraints** (per-ride, per-user, per-type) — prevent duplicates
- **Savepoint rollback** — partial failure never corrupts state
- **Security definer** — runs with elevated privileges, exposes only RPC interface

---

## TEST COVERAGE

| Module | Test Count | Coverage |
|---|---|---|
| `dealer_brokerage` | 10 tests | Existence, validation, report structure, auth |
| `fleet_lease_engine` | 8 tests | CRUD validation, deduction logic, reports |
| `region_settings` | 11 tests | Resolve, create with template, validate, list |
| **Total** | **29 tests** | All edge functions covered |

Test pattern: Each test is a self-contained Deno test that validates:
- HTTP status codes
- JSON response structure
- Input validation (missing required fields)
- Business logic (state transitions, fee calculations)
- Error handling (non-existent entities, duplicates)

---

## MIGRATION SUMMARY

**Migration:** `20260522000000_fleet_asset_architecture.sql`

| Component | Lines | Description |
|---|---|---|
| `region_settings` | ~80 | Full multi-region configuration table |
| `dealer_partners` | ~20 | Dealership registry with commission terms |
| `vehicle_inventory` | ~20 | Vehicle listings |
| `vehicle_sales` | ~25 | Lead-to-sale pipeline |
| `fleet_vehicles` | ~30 | Owned/leased fleet vehicles |
| `fleet_leases` | ~25 | Lease agreements |
| `lease_payments` | ~35 | Individual deduction records |
| Schema alters | ~15 | Added columns to rides, drivers, revenue_logs |
| RPCs | ~280 | 6 new RPCs (resolve, calculate, deduct x2, broker, daily) |
| `create_ride_atomic` update | ~10 | Added region_id parameter |
| RLS policies | ~40 | 8 new tables, 18 policies |
| Seed data | ~25 | Trinidad default region |
| **Total** | **~585** | Complete asset architecture |

---

## EDGE FUNCTIONS SUMMARY

| Function | Lines | Actions | Purpose |
|---|---|---|---|
| `dealer_brokerage` | ~310 | 7 | Vehicle sales pipeline + commission invoicing |
| `fleet_lease_engine` | ~320 | 5 | Fleet lease management + fee deduction |
| `region_settings` | ~290 | 7 | Multi-region config CRUD + geospatial resolution |
| `complete_ride` (updated) | +45 added | N/A | Lease deduction integration in ride settlement |
| **Total new code** | **~920** | **19 actions** | Three new microservices + one integration |

---

## RISK REGISTER

| Risk | Impact | Mitigation |
|---|---|---|
| Fleet driver can't pay lease fee | Medium | Failed deduction recorded; debt recovery via wallet; online lock if debt > limit |
| Dealer partner defaults on invoice | Low | Payment terms configurable; insurance requirement in dealer onboarding |
| Region config corrupt (bad pricing) | Medium | Validate endpoint checks 10 critical fields before marking region active |
| Double-deduction of lease fee | Critical | Advisory lock + deduplication check prevents concurrent deductions |
| Driver disputes mileage fee | Low | Lease_payments records exact km per ride from GPS; full audit trail |
| Interest rate risk (financed fleet) | Low | Acquisition cost + financing terms tracked per vehicle; model requires 40% margin |
| Currency fluctuation (inter-region) | Medium | Per-region currency is independent; no cross-currency exposure in V1 |
| Vehicle maintenance cost spike | Low | Maintenance tracked; next_due_at alerts; costs modeled into lease pricing |

---

## APPENDIX: QUICKSTART (Region Expansion)

To launch in a new country:

```bash
# 1. Create the region (cloned from TT template)
curl -X POST https://api.gtaxi.com/functions/v1/region_settings?action=create \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"code": "BB", "name": "Barbados", "template_region_code": "TT"}'

# 2. Verify configuration
curl "https://api.gtaxi.com/functions/v1/region_settings?action=validate&region_id={id}"

# 3. Register dealers for that region
curl -X POST https://api.gtaxi.com/functions/v1/dealer_brokerage?action=dealer \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"business_name": "Barbados Auto Sales", "phone": "+1246-555-0100", ...}'

# 4. Add fleet vehicles for that region
curl -X POST https://api.gtaxi.com/functions/v1/fleet_lease_engine?action=create_lease \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"fleet_vehicle_id": "...", "driver_id": "...", "region_id": "..."}'

# 5. Set up daily cron for lease fee collection
#    POST https://api.gtaxi.com/functions/v1/fleet_lease_engine?action=apply_daily_fees
#    (scheduled via pg_cron or external cron job, once per day at 00:00)
```

**Total time to new country: ~30 minutes** (API calls + regional compliance setup).  
**Zero code changes. Zero deploys. Zero database migrations.**

---

## APPENDIX B: THE WAR CHEST — 1.5% Capital Reserve

**Mandate:** Every ride transaction must divert 1.5% of gross fare into the `capital_reserve_ledger` **before** payout computation. The reserve is strictly separated from operational revenue.

### Settlement Math (Single Source of Truth)

```
grossFare      = total_fare_cents + wait_fees + surcharges
reserveCents   = round(grossFare * 0.015)       → capital_reserve_ledger (status='locked')
netFare        = grossFare - reserveCents
platformFee    = round(netFare * 0.185)           → platform_revenue_logs (operational)
driverPayout   = netFare - platformFee             → wallet_transactions (driver_payout)
```

**Invariant:** `reserveCents + platformFee + driverPayout = grossFare`

### Effective Rates on Gross Fare

| Component | % of Gross | Cents per $100 | Destination |
|---|---|---|---|
| Capital Reserve | 1.500% | $1.50 | `capital_reserve_ledger` (locked) |
| Platform Fee | 18.223% | $18.22 | `platform_revenue_logs` (operational) |
| **Total Platform** | **19.723%** | **$19.72** | Combined |
| Driver Payout | 80.277% | $80.28 | Driver wallet |

### Impact vs. Previous 81/19 Split

| Metric | Old (81/19) | New (1.5% + 18.5%) | Delta |
|---|---|---|---|
| Driver payout per $100 | $81.00 | $80.28 | **-$0.72** |
| Platform operational | $19.00 | $18.22 | **-$0.78** |
| Capital Reserve | $0.00 | $1.50 | **+$1.50** |
| Total platform capture | $19.00 | $19.72 | **+$0.72** |

> The 0.72pp reduction from driver payout funds the War Chest entirely. The platform's operational take actually drops by 0.78pp. The driver barely notices ($0.72 per $100), but at scale this builds a material reserve.

### The War Chest at Scale

| Scale | Monthly Ride Volume | Monthly Reserve |
|---|---|---|
| 1,000 drivers × $40 avg × 30 rides | $1,200,000 | **$18,000/mo** |
| 5,000 drivers × $40 avg × 30 rides | $6,000,000 | **$90,000/mo** |
| 10,000 drivers × $40 avg × 30 rides | $12,000,000 | **$180,000/mo** |
| 50,000 drivers × $40 avg × 30 rides | $60,000,000 | **$900,000/mo** |

At 50,000 drivers (Trinidad's total taxi fleet is ~30,000), the War Chest accumulates **$10.8M/year** — entirely from 1.5% that drivers never see.

### Audit Protection

The capital reserve is enforced at **four independent layers**:

```
Layer 1: Edge function (complete_ride) — computes 1.5% in TypeScript
Layer 2: Process wallet payment RPC   — computes 1.5% in PostgreSQL
Layer 3: Stripe webhook handler       — computes 1.5% in TypeScript  
Layer 4: DB trigger on rides.completed — auto-inserts if edge function misses it
```

| Layer | Path | Failure Mode |
|---|---|---|
| 1 | `complete_ride` (wallet/cash) | Catches 100% of rides via explicit insert |
| 2 | `process_wallet_payment_hardened` | Handles wallet path internally |
| 3 | `stripe_webhook` (card) | Handles card path independently |
| 4 | `auto_insert_capital_reserve` trigger | **Failsafe:** fires if any row completes with `reserve_cents > 0` and no ledger entry |

**No single point of failure.** Even if all three edge functions fail, the database trigger catches it.

### The capital_reserve_ledger Table

```sql
CREATE TABLE capital_reserve_ledger (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id               UUID NOT NULL REFERENCES rides(id),
    amount_cents          INTEGER NOT NULL CHECK (amount_cents > 0),
    currency              TEXT DEFAULT 'TTD',
    status                TEXT DEFAULT 'locked'
                          CHECK (status IN ('locked', 'released', 'deployed')),
    wallet_transaction_id UUID REFERENCES wallet_transactions(id),
    notes                 TEXT,
    created_at            TIMESTAMPTZ DEFAULT now()
);
```

**Status lifecycle:**
- `locked` → Default on every ride completion. Money is segregated.
- `released` → Withdrawn for approved operational use (board vote required).
- `deployed` → Deployed for strategic investment (fleet expansion, market entry).

**Separation from `platform_revenue_logs`:**
- `capital_reserve_ledger` is a **separate table** with its own RLS (service_role only)
- `platform_revenue_logs` tracks operational income (platform_fee = gross - payout - reserve - merchant_split)
- The reserve_cents column in `platform_revenue_logs` exists for **reconciliation only** — the canonical reserve record is in `capital_reserve_ledger`

### Wallet Transaction Types Added

| Type | Description | Direction |
|---|---|---|
| `capital_reserve` | 1.5% War Chest credit to platform | Platform credit |

The `wallet_transactions` CHECK constraint was updated to include `capital_reserve` alongside `lease_deduction` and `lease_income`.

---

*"We don't just connect riders to drivers. We own the assets, broker the sales, collect at every layer, and lock 1.5% of every dollar into an unhackable War Chest — automatically, before anyone gets paid. The server is the sole financial authority."*
