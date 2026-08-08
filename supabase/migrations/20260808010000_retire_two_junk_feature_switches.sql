-- ═══════════════════════════════════════════════════════════════════════════
-- TWO SWITCHES THAT COULD NEVER WORK
-- (2026-08-08)
--
-- Follow-up to 20260808000000. That migration removed 7 duplicate vertical
-- flags. Checking the REST of the table afterwards showed the same disease
-- was wider: 9 of the 14 remaining switches were read by nothing at all.
-- An operator could toggle them, get a success toast, and no app anywhere
-- would behave differently.
--
-- Most of them have a real feature behind them and are being wired instead
-- of deleted (ai_assistant_active and opt_in_ai_routing are wired in the same
-- commit; airline/hotel/promo/scheduled-rides are flagged in the admin UI as
-- pending). These two cannot be wired, for different reasons:
--
--   sponsored_stops
--     "Paid merchant placement during active rides". There is no such
--     feature. Nothing in the rider app, the driver app, or any of the 124
--     edge functions implements sponsored placement. The switch has no
--     feature to control and never had.
--
--   loyalty_tier_threshold_cents
--     Not a switch. It carried a NUMBER in its metadata ({"value": 50000}) —
--     the driver wallet balance qualifying for the loyalty commission tier —
--     inside a table whose only meaningful column is a boolean. It rendered
--     as an ON/OFF toggle where "off" would read to an operator as "loyalty
--     tiers disabled" while in fact meaning nothing whatsoever. The value is
--     moved to pricing_config, which is where numeric configuration lives and
--     where compute_ride_split already reads its rates from.
--
-- Nothing referenced either id anywhere outside the admin page that listed
-- them, so neither delete can break a caller.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.pricing_config (key, value_cents, description)
VALUES ('LOYALTY_TIER_THRESHOLD_CENTS', 50000,
        'Driver wallet balance (cents) qualifying for the loyalty commission tier. Moved out of system_feature_flags, which is a boolean switch table.')
ON CONFLICT (key) DO NOTHING;

DELETE FROM public.system_feature_flags
 WHERE id IN ('loyalty_tier_threshold_cents', 'sponsored_stops');
