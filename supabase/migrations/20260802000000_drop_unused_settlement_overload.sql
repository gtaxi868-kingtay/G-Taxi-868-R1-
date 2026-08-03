-- process_driver_settlement_atomic had TWO signatures:
--   (p_ride_id uuid, p_gross_cents integer, p_event_id text)                 <- 0 callers
--   (p_event_id text, p_ride_id uuid, p_driver_id uuid, p_rider_id uuid,
--    p_gross_cents bigint, p_currency text, p_provider_ref text)             <- both webhooks
--
-- Same shape as the wallet P0 that made every wallet ride fail: multiple
-- overloads of one money function, waiting for a caller whose named args
-- match none of them. Verified before dropping: stripe_webhook and
-- wipay_webhook both use the 7-arg form, no SQL function calls it at all,
-- and nothing under apps/ references it. The 3-arg form is dead.
--
-- Dry-run confirmed after the drop: overloads = 1, the 7-arg webhook call
-- still resolves, service_role retains EXECUTE, anon still cannot.
DROP FUNCTION IF EXISTS public.process_driver_settlement_atomic(uuid, integer, text);

NOTIFY pgrst, 'reload schema';
