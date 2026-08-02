-- Companion record for two live fixes applied 2026-08-01.
-- Full reasoning lives in the commit message; the authoritative bodies
-- were applied via the management API and are reproduced here so the
-- repo is not silent about them.
--
-- 1. ADMIN VERTICAL TOGGLE DID NOTHING.
--    PlatformControl wrote vertical_settings and the rider app even
--    subscribed to it over realtime, but nothing ever READ it. Gating
--    used only rider_progression.unlocked_verticals (the ride-count
--    auto-unlock, e.g. 15 rides -> grocery), so an admin switching a
--    vertical off changed nothing on any phone. caribbean_travel,
--    carnival and events are all is_enabled=false today while riders who
--    had earned g_escape would still have been shown it.
--    Fixed in supabase/functions/get_rider_progress: the returned
--    unlocked_verticals is now (rider earned) AND (admin allows),
--    including staged rollout_percentage via a per-rider stable bucket.
--    Server-side so no client can opt out. Fails safe: if
--    vertical_settings cannot be read the rider keeps what they earned
--    rather than losing every vertical.
--
-- 2. system_alerts REJECTED THE VALUES THE CODE WRITES — see below.
ALTER TABLE public.system_alerts DROP CONSTRAINT IF EXISTS system_alerts_severity_check;
ALTER TABLE public.system_alerts ADD CONSTRAINT system_alerts_severity_check
  CHECK (severity = ANY (ARRAY['INFO','LOW','MEDIUM','WARNING','HIGH','CRITICAL']));

ALTER TABLE public.system_alerts DROP CONSTRAINT IF EXISTS system_alerts_type_check;
ALTER TABLE public.system_alerts ADD CONSTRAINT system_alerts_type_check
  CHECK (type = ANY (ARRAY[
    'RECONCILIATION_FAILURE','PAYMENT_ANOMALY','GPS_SPOOF_ESCALATION',
    'STATE_MACHINE_VIOLATION','RATE_LIMIT_BURST','ADMIN_OVERRIDE',
    'DRIVER_SAFETY_TIMEOUT','WATCHDOG_ANOMALY','LEASE_DEFAULT',
    'G_BUDGET_EXHAUSTED','GARAGE_REQUEST','ESCAPE_GROUP_READY']));
