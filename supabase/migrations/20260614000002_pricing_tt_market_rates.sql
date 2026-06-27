-- Pricing update: T&T market-rate fares + 19% flat platform split
-- 2026-06-14 (revised after full competitive audit June 14)
--
-- ── T&T COMPETITIVE AUDIT (June 2026, rate: 1 USD = 6.79 TTD) ───────────────
--
-- ACTIVE PLAYERS CONFIRMED:
--   TT RideShare (TTRS): $1.75-2.25/km (last published Dec 2022, likely higher now).
--                         Estimated real 5km fare: $25-35 incl. unpublished base fare.
--                         Driver commission: ~20% (reduced to 15% during Jan 2026 strike).
--   DeliverMe TT:         $28 Essential base, $35 Premium. $1/min wait after 3 min.
--   H-plate taxis:        $5 base + $5/km negotiated. ~$30 for 5km city run.
--   Official airport rank: $350-500 for Piarco → Port of Spain (23km).
--   PH (private hire):    $25-50 negotiated, unmetered, no app.
--   Maxi taxis:           $4-10 per person shared route (not relevant to G-Taxi).
--
-- NOT IN T&T: Uber (exited), Bolt (no T&T presence confirmed), InDriver (global
--             expansion not confirmed in T&T as of 2026).
--
-- FOOD DELIVERY:
--   foodDROP: Dominant. $25-70 delivery fee + 5% booking surcharge. Restaurant
--             commission undisclosed. G-Taxi merchant dispatch is PASSENGER transport
--             not food delivery — no direct conflict with foodDROP at launch.
--
-- GROCERY: Massy Stores has online ordering with distance-dependent delivery fee.
--          No dedicated grocery delivery app confirmed. Not a day-one conflict.
--
-- ── WHY THE ORIGINAL RATES WERE WRONG ────────────────────────────────────────
--
-- Prior rates (BASE $12, PER_KM $3.50, PER_MIN $1.20, MIN $35) gave:
--   5km/12min = $43.90 → 25-57% above TTRS and H-taxi for same short trip.
--
-- At day-one launch a rider's reference price is the PH or TTRS fare they
-- know. $43.90 vs $28-35 is the kind of gap that produces immediate uninstalls
-- and negative word-of-mouth. T&T is a small, tight community — word travels
-- fast in both directions.
--
-- The fix is to bring short-trip fares into the PH/TTRS competitive band.
-- Medium and long runs are already competitive; the problem is exclusively
-- in the sub-10km short-city segment.
--
-- ── REVISED FARE VALIDATION ───────────────────────────────────────────────────
--
--   5km / 12min:  $8 + (5×$3.00) + (12×$1.00) = $35.00  → within TTRS/H-taxi band ✓
--   10km / 18min: $8 + (10×$3.00) + (18×$1.00) = $56.00  → below H-taxi ($80) ✓
--   15km / 25min: $8 + (15×$3.00) + (25×$1.00) = $81.00  → beats H-taxi, near PH ✓
--   23km / 30min (airport): $8 + (23×$3.00) + (30×$1.00) = $107.00  ← vs rank $350-500 ✓
--
-- ── DRIVER ECONOMICS CHECK ───────────────────────────────────────────────────
--
--   5km/12min:  Driver earns 81% × $35.00 = $28.35 (PH would get $25-35 negotiated) ✓
--   15km/25min: Driver earns 81% × $81.00 = $65.61 (PH would get $50-80 negotiated) ✓
--   Airport:    Driver earns 81% × $107.00 = $86.67 (H-taxi gets $280-400 of $350-500) ✓
--
--   Drivers earn competitively across all segments. The minimum fare ($28) ensures
--   short-pickup rides still pay at least $22.68 to the driver — viable for T&T.
--
-- ── COUNCIL VERDICT (unanimous on revised rates) ─────────────────────────────
--
--   Jobs:       $35 lands inside the PH quote range a rider already knows.
--               No sticker shock, no calculation at the door. ✓
--   Zuck:       $35 is shareable. "$10 cheaper than what I used to pay" is a text
--               message to three friends. $43.90 is not. Volume is the viral loop. ✓
--   Rockefeller: Market share is the pipeline. You extract margin once you own
--               territory. Price to win the territory first. ✓
--   Bezos:      Every ride is a data point. Cheap prices = more rides = faster
--               flywheel calibration on demand patterns, surge zones, driver pools. ✓
--   Buffett:    19% of $35 × 5,000 rides > 19% of $43.90 × 500. Volume math wins.
--               Capital efficiency requires market penetration first. ✓
--
-- ── PLATFORM SPLIT (unchanged — all rides) ───────────────────────────────────
--   Platform fee:     19% of gross (standard) / 16% loyalty (wallet ≥ TTD $500)
--   War chest:        1.5% of gross — sub-ledger within platform fee, NOT additional
--   Net platform:     17.5% of gross (standard)
--   Driver take-home: 81% of gross (standard) / 84% loyalty
--
-- ── MERCHANT DISPATCH PREMIUM — UNCHANGED ────────────────────────────────────
--
-- The 15% merchant dispatch premium remains. At revised base rates:
--   Merchant-dispatched 5km/12min = $35.00 × 1.15 = $40.25
--   Still within the PH range ($40-80), justified by metered/tracked experience.
--   5% vendor commission from within platform's 19% cut. Net platform = 14%.
--
-- ── GEOGRAPHIC NOTES ─────────────────────────────────────────────────────────
--   Port of Spain:  Short trips are the competitive battleground. $35 min wins.
--   San Fernando:   Longer urban distances → per-km model is MORE favorable for G-Taxi
--                   vs PH negotiation. No rate adjustment needed.
--   Chaguanas:      Same as San Fernando. Suburban = longer average trip.
--   Tobago:         Shorter island, tourist runs, no TTRS/DeliverMe confirmed.
--                   $28 minimum competes with taxi rank. G-Taxi wins.
--   North Coast:    Point-to-point tourist runs 20-30km. G-Taxi ~$68-98 vs negotiated
--                   PH $80-150. G-Taxi wins on price and tracking.
--
-- ── PRICE REVIEW TRIGGER ─────────────────────────────────────────────────────
--   At 30-day post-launch: if driver_payout_avg > PH negotiated rate by >20% AND
--   ride volume is growing, raise PER_KM to $3.25. Do not raise before data confirms
--   driver supply is healthy and riders are not price-shopping back to PH.

UPDATE platform_config SET value_cents = 800,  updated_at = now() WHERE key = 'BASE_FARE_CENTS';
UPDATE platform_config SET value_cents = 300,  updated_at = now() WHERE key = 'PER_KM_CENTS';
UPDATE platform_config SET value_cents = 100,  updated_at = now() WHERE key = 'PER_MIN_CENTS';
UPDATE platform_config SET value_cents = 2800, updated_at = now() WHERE key = 'MIN_FARE_CENTS';

INSERT INTO platform_config (key, value_cents, description) VALUES
    ('MERCHANT_DISPATCH_PREMIUM_PCT', 15,  'Default percentage surcharge on fares dispatched from a merchant kiosk (vendor_node_id set). At revised base rates, a merchant-dispatched 5km/12min fare = $40.25 (inside the PH $40-80 range). Per-kiosk override via kiosk_nodes.dispatch_premium_pct (pharmacies 10%, hotels 20%).'),
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
    'Per-kiosk merchant dispatch premium override (integer %). NULL = use platform_config MERCHANT_DISPATCH_PREMIUM_PCT (15%). Category-level pricing: pharmacies 10%, restaurants 15%, hotels 20%.';

COMMENT ON TABLE platform_config IS
    'Live pricing constants. Base: TTD $8 + $3.00/km + $1.00/min, min TTD $28. Standard: rider pays gross; platform keeps 19%; driver gets 81%. War chest (1.5%) is sub-ledger inside platform fee. Merchant dispatch rides: platform keeps 14% (vendor earns 5% from within platform cut); driver gets 81% of the premium fare. Rates validated against T&T market: TTRS (~$25-35 for 5km), DeliverMe ($28 base), H-plate ($30 for 5km), airport rank ($350-500 vs G-Taxi $107). Review rates at 30-day post-launch.';
