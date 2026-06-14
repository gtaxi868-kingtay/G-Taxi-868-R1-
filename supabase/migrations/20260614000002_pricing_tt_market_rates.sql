-- Pricing update: T&T market-rate fares + 19% flat platform split
-- 2026-06-14
--
-- ── T&T MARKET RESEARCH (June 2026, rate: 1 USD = 6.79 TTD) ─────────────────
--
-- Competitor benchmarks:
--   Maxi taxis (shared route):  TTD $5-8 per person (not relevant to G-Taxi)
--   PH (private hire) cabs:     TTD $40-80 negotiated, unmetered, city runs
--   Taxi stands:                TTD $30-60 city runs
--
-- G-Taxi new fare validation:
--   5km / 12min:  $12 + (5×$3.50) + (12×$1.20) = $43.90  → within PH range ✓
--   15km / 25min: $12 + (15×$3.50) + (25×$1.20) = $94.50  → competitive ✓
--   25km / 35min (airport): $12 + (25×$3.50) + (35×$1.20) = $141.50  ✓
--
-- ── PLATFORM SPLIT (all rides) ────────────────────────────────────────────────
--   Platform fee:     19% of gross (standard) / 16% loyalty (wallet ≥ TTD $500)
--   War chest:        1.5% of gross — sub-ledger within platform fee, NOT additional
--   Net platform:     17.5% of gross (standard)
--   Driver take-home: 81% of gross (standard) / 84% loyalty
--
-- ── MERCHANT DISPATCH PREMIUM — COUNCIL ANALYSIS ────────────────────────────
--
-- Scenario: merchant kiosk (NFC tap or shop dispatch) calls a G-Taxi for a customer.
-- The fare is marked up so the shop's 5% kickback and platform margin both survive.
-- The vendor 5% commission comes FROM the platform's 19% cut (not added on top).
-- Net platform on merchant rides = 19% - 5% = 14% of gross.
--
-- Premium level analysis (standard 5km/12min ride = TTD $43.90):
--
--   Premium │ Passenger pays │ vs PH cab range  │ Driver earns │ Net platform
--   ────────┼───────────────┼──────────────────┼─────────────┼─────────────
--      10%  │   TTD $48.29  │ Low — too safe    │   $39.12    │    $6.76
--      15%  │   TTD $50.49  │ Mid — competitive │   $40.90    │    $7.07
--      20%  │   TTD $52.68  │ High end          │   $42.67    │    $7.38
--      25%  │   TTD $54.88  │ Above PH ceiling  │   $44.45    │    $7.69
--
-- Council verdict (Jobs / Zuck / Rockefeller / Bezos / Buffett):
--
--   Jobs:       15%. Passenger benchmarks against a PH driver quote. $50 sits inside
--               that range. The metered/tracked experience justifies the gap over PH.
--               25% makes passengers do the math before they even get in the car.
--
--   Zuck:       15% maximises dispatch volume per kiosk. 30 dispatches/day at 5%
--               commission on $50.49 = TTD $2,252/month per merchant — enough to make
--               the NFC widget the most talked-about thing at the counter. More rides
--               at 15% beats fewer rides at 25% in absolute kickback earnings.
--
--   Rockefeller: 15% flat DEFAULT. Per-kiosk override via kiosk_nodes.dispatch_premium_pct
--               so restaurants get 15%, hotels 20%, pharmacies 10%. Layer control,
--               not one-size pricing.
--
--   Bezos:      15% is within the noise of PH negotiation variance in T&T. Passengers
--               accept metered over negotiated inside ~15% of equivalent. Above that,
--               the calculation tips toward calling a PH driver. Set 15%, read
--               dispatch conversion data at 30 days.
--
--   Buffett:    Merchant rides compress platform margin (14% vs 17.5% on standard).
--               Acceptable because: (a) merchant rides are incremental volume the shop
--               generates, (b) each kiosk pays TTD $150/month subscription, (c) the
--               shop market G-Taxi for free to its customer base. 25% doesn't
--               materially change platform margin but risks passenger rejection.
--               15% is the answer.
--
-- VERDICT: 15% merchant dispatch premium.
-- Implementation note: the premium is applied in estimate_fare when vendor_node_id
-- is present in the booking context (not in complete_ride settlement math).

UPDATE platform_config SET value_cents = 1200, updated_at = now() WHERE key = 'BASE_FARE_CENTS';
UPDATE platform_config SET value_cents = 350,  updated_at = now() WHERE key = 'PER_KM_CENTS';
UPDATE platform_config SET value_cents = 120,  updated_at = now() WHERE key = 'PER_MIN_CENTS';
UPDATE platform_config SET value_cents = 3500, updated_at = now() WHERE key = 'MIN_FARE_CENTS';

INSERT INTO platform_config (key, value_cents, description) VALUES
    ('MERCHANT_DISPATCH_PREMIUM_PCT', 15,  'Default percentage surcharge on fares dispatched from a merchant kiosk (vendor_node_id set). Derived from T&T PH cab market analysis: 15% keeps the fare competitive ($50.49 for 5km vs PH range of $40-80) while funding the 5% vendor kickback from inside the platform 19% cut. Per-kiosk override via kiosk_nodes.dispatch_premium_pct.'),
    ('PLATFORM_FEE_PCT',              19,  'Standard platform commission as an integer percentage (19 = 19%). War chest (1.5%) comes from inside this; net platform = 17.5%.'),
    ('LOYALTY_FEE_PCT',               16,  'Reduced platform fee for loyalty drivers (wallet balance >= TTD $500). Driver net = 84%.'),
    ('CAPITAL_RESERVE_PCT_X10',       15,  'Capital reserve rate x 10 (15 = 1.5%). Sub-ledger within PLATFORM_FEE_PCT — not an additional charge. War chest is funded from the platform cut, not the driver.'),
    ('VENDOR_COMMISSION_DEFAULT_PCT', 5,   'Default vendor/kiosk commission as an integer percentage. Paid from the platform 19% cut to merchant wallet. Net platform on merchant rides = 19% - 5% = 14%.')
ON CONFLICT (key) DO UPDATE SET
    value_cents = EXCLUDED.value_cents,
    description = EXCLUDED.description,
    updated_at  = now();

-- Per-kiosk dispatch premium override (Rockefeller tier structure).
-- Null = use platform default (15%). Set to 10 for pharmacies, 20 for hotels, etc.
ALTER TABLE kiosk_nodes
    ADD COLUMN IF NOT EXISTS dispatch_premium_pct INTEGER DEFAULT NULL
        CHECK (dispatch_premium_pct IS NULL OR (dispatch_premium_pct >= 0 AND dispatch_premium_pct <= 50));

COMMENT ON COLUMN kiosk_nodes.dispatch_premium_pct IS
    'Per-kiosk merchant dispatch premium override (integer %). NULL = use platform_config MERCHANT_DISPATCH_PREMIUM_PCT (15%). Allows category-level pricing: pharmacies 10%, restaurants 15%, hotels 20%.';

COMMENT ON TABLE platform_config IS
    'Live pricing constants. Standard: rider pays gross; platform keeps 19%; driver gets 81%. War chest (1.5%) is sub-ledger inside platform fee. Merchant dispatch rides: platform keeps 14% (vendor earns 5% from within platform cut); driver gets 81% of the premium fare (earns more in absolute terms).';
