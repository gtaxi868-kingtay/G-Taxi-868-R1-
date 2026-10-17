-- ═══════════════════════════════════════════════════════════════════
-- Restore driver_referral_rewards (driver-refers-driver reward).
--
-- The live rule (DRIVER_ONBOARD_DRIVER_REWARD_BPS = 500,
-- DRIVER_REFERRAL_TARGET_RIDES = 10): once a driver who signed up with
-- another driver's referral code completes 10 rides, the referrer gets a
-- one-time 5% of the platform's share (platform_fee_cents) of those rides,
-- paid from the reserve via spend_from_reserve.
--
-- complete_ride (live v96) calls increment_driver_referral_reward on every
-- completed ride, but the table that function writes was missing live
-- (PROVEN 2026-10-17: to_regclass = null). It was created by tracked
-- migration 20260904202203 and removed by something untracked, so every
-- call failed and the reward could never pay. This recreates it exactly as
-- that migration defined it; the function itself is unchanged.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.driver_referral_rewards (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id         uuid NOT NULL REFERENCES auth.users(id),
    referee_id          uuid NOT NULL REFERENCES auth.users(id),
    rides_completed     smallint NOT NULL DEFAULT 0,
    target_rides        smallint NOT NULL DEFAULT 10,
    reward_triggered    boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (referrer_id, referee_id)
);

ALTER TABLE public.driver_referral_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_referral_rewards FROM anon, authenticated;
GRANT SELECT ON public.driver_referral_rewards TO authenticated;

DROP POLICY IF EXISTS "Own driver referral rewards" ON public.driver_referral_rewards;
CREATE POLICY "Own driver referral rewards" ON public.driver_referral_rewards
    FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR referee_id = auth.uid());
