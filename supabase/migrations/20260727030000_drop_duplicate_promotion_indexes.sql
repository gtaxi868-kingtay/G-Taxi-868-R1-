-- Pre-existing duplicate indexes flagged by get_advisors while reviewing
-- the new promotion-consumption work — not introduced by that work, but
-- cheap and safe to clean up since they were found in passing: each pair
-- below is byte-identical (confirmed via pg_indexes.indexdef before
-- dropping), so this only removes redundant write overhead, changes no
-- query behavior.
DROP INDEX IF EXISTS public.idx_promotions_merchant_id;
DROP INDEX IF EXISTS public.idx_promotion_impressions_promotion_id;
DROP INDEX IF EXISTS public.idx_promotion_impressions_ride_id;
DROP INDEX IF EXISTS public.idx_promotion_impressions_user_id;
