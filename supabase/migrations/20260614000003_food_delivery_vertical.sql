-- Food delivery vertical — June 2026
--
-- ── COUNCIL RATIONALE ─────────────────────────────────────────────────────────
--
-- foodDROP is the dominant player in T&T food delivery. Their model:
--   Customer pays: $25-70 delivery fee + 5% booking surcharge on order value
--   Restaurant commission: undisclosed (industry standard 20-30%)
--
-- G-Taxi approach (council consensus):
--   Customer pays: flat delivery fee from merchant.delivery_fee_cents (no booking
--                  surcharge — the most visible differentiator vs foodDROP)
--   Restaurant commission: 15% of order subtotal (below industry standard,
--                          low enough to onboard restaurants without resistance)
--   Driver earns: 81% of delivery fee (same split as rides)
--   Platform keeps: 19% of delivery fee + 15% restaurant commission
--
-- Jobs:  Two-tap ordering. Restaurant list → menu → cart → track.
--        Delivery fee shown BEFORE entering the restaurant, not at checkout.
--        No booking surcharge = no surprise at payment screen.
--
-- Zuck:  "No booking fee" is the headline that gets shared on WhatsApp.
--        "foodDROP charges 5% extra on your order — G-Taxi doesn't" is a
--        message that writes itself. Order volume is the virality mechanism.
--
-- Rockefeller: Two revenue layers per order:
--   Layer 1: delivery fee revenue (rider pays → driver earns 81% → platform 19%)
--   Layer 2: restaurant commission (restaurant pays 15% → pure platform margin)
--   Future Layer 3: premium restaurant placement ($99/month featured spot)
--
-- Bezos:  Every food order builds behavioral data: cuisine preference, time of day,
--         reorder frequency. Feeds demand_patterns. AI surfaces "you usually order
--         from here on Friday evenings" before the rider opens the app.
--
-- Buffett: Zero new driver infrastructure. Drivers toggle delivery mode same as
--          ride mode. match_order_delivery already exists and handles assignment.
--          Incremental revenue on existing sunk costs.
--
-- ── REVENUE MODEL ────────────────────────────────────────────────────────────
--
--   Example: rider orders TTD $80 of food, delivery fee TTD $25
--   Restaurant pays G-Taxi:  $80 × 15% = $12.00 commission
--   Rider pays G-Taxi:       $25 delivery fee
--   Driver earns:            $25 × 81% = $20.25
--   Platform total:          $12.00 + ($25 × 19%) = $12.00 + $4.75 = $16.75
--   Effective take rate:      $16.75 / ($80 + $25) = 16% of GMV
--
-- ── DATABASE CHANGES ─────────────────────────────────────────────────────────

-- 1. Add food_delivery vertical to vertical_settings
INSERT INTO vertical_settings (vertical_name, display_name, is_enabled, enabled_regions,
    requires_subscription, commission_rate_percent, icon_name, sort_order, config)
VALUES (
    'food_delivery',
    'Food Delivery',
    false,
    '{}',
    false,
    15,
    'restaurant',
    3,
    '{"no_booking_surcharge": true, "restaurant_commission_pct": 15, "driver_split_pct": 81, "tagline": "No booking fee. Flat delivery charge. Beats foodDROP."}'
)
ON CONFLICT (vertical_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    commission_rate_percent = EXCLUDED.commission_rate_percent,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order,
    config = EXCLUDED.config,
    updated_at = now();

-- 2. Ensure merchants table has the columns FoodDeliveryScreen expects
--    (delivery_fee_cents, avg_delivery_minutes, is_open already exist from prior
--     grocery vertical work — these are no-ops if columns already present)
ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 2000
        CHECK (delivery_fee_cents >= 0),
    ADD COLUMN IF NOT EXISTS avg_delivery_minutes INTEGER NOT NULL DEFAULT 30
        CHECK (avg_delivery_minutes > 0),
    ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN merchants.delivery_fee_cents IS
    'Flat delivery fee charged to rider (no booking surcharge added). At TTD $20 = 2000.';
COMMENT ON COLUMN merchants.avg_delivery_minutes IS
    'Estimated delivery time shown in FoodDeliveryScreen card. Updated by merchant.';
COMMENT ON COLUMN merchants.is_open IS
    'Whether merchant is currently accepting orders. FoodDeliveryScreen shows open/closed.';

-- 3. Ensure restaurant categories are valid in the merchants.category constraint
--    (adds categories if the check constraint exists and is blocking new values)
DO $$
DECLARE
    constraint_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'merchants'
          AND constraint_name LIKE '%category%'
          AND constraint_type = 'CHECK'
    ) INTO constraint_exists;

    IF constraint_exists THEN
        RAISE NOTICE 'merchants.category check constraint found — verify it allows: restaurant, local, indian, chinese, american, pizza, seafood, bakery, creole. If not, drop and recreate it.';
    END IF;
END $$;

-- 4. Add RESTAURANT_COMMISSION_PCT to platform_config so admin can adjust
INSERT INTO platform_config (key, value_cents, description) VALUES
    ('RESTAURANT_COMMISSION_PCT', 15,
     'Commission percentage taken from restaurant on each food order (15 = 15%). Paid from restaurant earnings, not added to rider''s order total. foodDROP industry standard is ~20-30%; G-Taxi charges 15% to onboard restaurants quickly.')
ON CONFLICT (key) DO UPDATE SET
    value_cents = EXCLUDED.value_cents,
    description = EXCLUDED.description,
    updated_at  = now();

-- 5. Add food_delivery to wallet transaction types if not already present
DO $$
BEGIN
    ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
    ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check
        CHECK (transaction_type IN (
            'topup','ride_payment','refund','bonus','driver_payout','tip','commission_fee',
            'cancellation_fee','leakage_fine','debt_recovery','payout','debt_repayment',
            'lease_deduction','lease_income','capital_reserve',
            'travel_package_payment','travel_package_refund','scout_referral_payout',
            'food_order_payment','food_order_refund','restaurant_commission'
        ));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'wallet_transactions constraint update skipped: %', SQLERRM;
END $$;
