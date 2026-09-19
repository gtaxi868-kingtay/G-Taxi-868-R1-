-- Merchant/G-Touch-Point node commission was set to 2% of the platform's
-- take, but the founder's actual notes (docs/g868-manus-brief.md, line
-- 232-233 and 305-306) and his explicit instruction both say merchants get
-- 1% -- "a share of the platform's take," never phrased as a flat "3%
-- commission" or any other number. This was a real live/intent mismatch,
-- confirmed 2026-09-18 and already applied live before this file was
-- written to capture it in git.
--
-- Does not touch DRIVER_SHARE_CENTS (8000 = 80%), COMMANDER_REVSHARE_RATE_CENTS
-- (200 = 2%), or RESERVE_RATE_CENTS (150 = 1.5%) -- all three already matched
-- the founder's notes exactly and needed no change. compute_ride_split()
-- itself also needed no change: it correctly gives the platform whatever is
-- left after driver/commander/reserve/merchant are paid, matching the
-- founder's notes explicitly rejecting any fixed platform percentage
-- ("Any 82/15/3 split" is called out by name as wrong to state anywhere).
UPDATE public.pricing_config
SET value_cents = 100
WHERE key = 'NODE_COMMISSION_RATE_ON_PLATFORM_BPS';
