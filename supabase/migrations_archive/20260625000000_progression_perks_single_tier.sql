-- ═══════════════════════════════════════════════════════════════════════════
-- G-Taxi Progression Perks + Single Paid Tier (G-Member)
-- Migration: 20260625000000_progression_perks_single_tier
--
-- Merges subscription_benefits perks into progression_config so that
-- discount, priority matching, and wait time are earned by riding — not
-- by paying a monthly fee. A single "g_member" paid tier is offered only
-- at Level 5 for power users who want extra convenience.
--
-- Changes:
--   1. Add g_member to rider_subscription_tier enum
--   2. Add discount_percent, priority_matching, free_wait_minutes to
--      progression_config
--   3. Re-seed progression_config rows with level-based perks
--   4. Seed g_member row in subscription_benefits (single paid tier)
--   5. Update calculate_subscription_discount() to read from progression
--      level, then optionally g_member on top
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. ADD g_member TO ENUM ───────────────────────────────────────────────
ALTER TYPE rider_subscription_tier ADD VALUE IF NOT EXISTS 'g_member';

-- ── 2. ADD PERK COLUMNS TO progression_config ─────────────────────────────
ALTER TABLE public.progression_config
  ADD COLUMN IF NOT EXISTS discount_percent    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority_matching   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_wait_minutes   INTEGER NOT NULL DEFAULT 3;

-- ── 3. SEED LEVEL-BASED PERKS ──────────────────────────────────────────────
INSERT INTO public.progression_config
  (level, unlock_vertical, threshold_type, threshold_value,
   push_title, push_body,
   discount_percent, priority_matching, free_wait_minutes)
VALUES
  (2, 'grocery',       'rides',           5,
   'G-Grocery unlocked',
   'Order food and groceries delivered right to your door.',
   5,  false, 5),
  (3, 'laundry_nfc',   'grocery_orders',  2,
   'G-Laundry unlocked',
   'Drop off laundry on your next ride. Tap any G-Taxi kiosk to pay.',
   8,  true,  8),
  (4, 'gwallet_bonus', 'laundry_orders',  1,
   'G-Wallet bonus active',
   'Top up TTD $200, get TTD $220 in ride credits.',
   10, true,  10),
  (5, 'g_escape',      'wallet_funded',   1,
   'G-Escape unlocked',
   'Exclusive Caribbean packages — only for our most loyal riders.',
   12, true,  12)
ON CONFLICT (level) DO UPDATE SET
  discount_percent    = EXCLUDED.discount_percent,
  priority_matching   = EXCLUDED.priority_matching,
  free_wait_minutes   = EXCLUDED.free_wait_minutes,
  push_title          = EXCLUDED.push_title,
  push_body           = EXCLUDED.push_body;

-- Remove plus/pro from subscription_benefits (keep only free + g_member)
DELETE FROM public.subscription_benefits WHERE tier IN ('plus', 'pro');

-- ── 4. SEED SINGLE PAID TIER ───────────────────────────────────────────────
INSERT INTO public.subscription_benefits
  (tier, discount_percent, priority_matching, free_wait_minutes,
   monthly_price_cents, yearly_price_cents, description, features)
VALUES (
  'g_member',
  15,   true,   20,
  3500, 35000,
  'G-Member — unlimited priority, 15% off everything, no booking fees',
  '["15% off all rides", "Unlimited priority matching", "20-minute wait grace",
    "No G-Escape booking fees", "Dedicated support",
    "Early access to new verticals"]'::jsonb
) ON CONFLICT (tier) DO NOTHING;

-- ── 5. UPDATE DISCOUNT FUNCTION ────────────────────────────────────────────
-- Now reads from rider_progression level first.
-- If user is g_member, adds 3% on top of their level discount (min 15%).
CREATE OR REPLACE FUNCTION calculate_subscription_discount(
    p_user_id UUID,
    p_base_fare_cents INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_tier          rider_subscription_tier;
    v_level         SMALLINT;
    v_level_discount INTEGER := 0;
    v_is_g_member   BOOLEAN := false;
    v_discount_cents INTEGER;
BEGIN
    -- Check if user is g_member
    SELECT subscription_tier INTO v_tier
    FROM profiles
    WHERE id = p_user_id;
    v_is_g_member := (v_tier = 'g_member');

    -- Get progression level
    SELECT level INTO v_level
    FROM rider_progression
    WHERE rider_id = p_user_id;

    -- Look up level-based discount
    IF v_level IS NOT NULL AND v_level >= 2 THEN
        SELECT discount_percent INTO v_level_discount
        FROM progression_config
        WHERE level = v_level;
        v_level_discount := COALESCE(v_level_discount, 0);
    END IF;

    -- G-Member: 15% minimum, or level + 3% whichever is higher
    IF v_is_g_member THEN
        v_level_discount := GREATEST(15, v_level_discount + 3);
    END IF;

    v_discount_cents := (p_base_fare_cents * v_level_discount / 100);

    -- Cap at TTD $50.00 max discount per ride
    RETURN LEAST(v_discount_cents, 5000);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
