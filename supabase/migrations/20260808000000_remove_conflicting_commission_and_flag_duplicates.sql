-- ═══════════════════════════════════════════════════════════════════════════
-- REMOVE TWO SETS OF NUMBERS THAT LIED TO THE ADMIN
-- (2026-08-08)
--
-- PROBLEM 1 — a second, fake commission rate
-- ------------------------------------------
-- vertical_settings carried commission_rate_percent (19) and
-- driver_commission_percent (81) for ride_hailing. The real split is
-- pricing_config: PLATFORM_RATE_CENTS=1500 (15%), DRIVER_SHARE_CENTS=8000
-- (80%), RESERVE_RATE_CENTS=150 (1.5%), COMMANDER_REVSHARE_RATE_CENTS=200.
--
-- Nothing read those columns for money. They were rendered in
-- PlatformControl.tsx and nowhere else — verified across the whole repo and
-- against pg_proc (0 database functions referenced them). So an admin could
-- read "commission 19% · driver 81%", edit it, and change absolutely nothing
-- about what a driver got paid.
--
-- This is the same failure mode as the 82/15/3 split that CLAUDE.md already
-- records as never-correct: a plausible number living somewhere that is not
-- the source of truth. The fix is deletion, not synchronisation — a second
-- writable path to the split would be a money bug waiting to happen.
-- PlatformControl now reads pricing_config live and says so on screen.
--
-- PROBLEM 2 — three switches per vertical, disagreeing
-- ----------------------------------------------------
-- system_feature_flags held, for grocery and laundry:
--     grocery_active  = true    "Controls visibility of the Grocery tile"
--     grocery_module  = false   "Enable grocery delivery platform"
--     grocery_vertical= false   "Grocery ordering vertical for riders"
-- plus pharma_vertical = false. Seven rows, all unread. Every reference was
-- inside PlatformControl's own display-grouping list; no app, edge function or
-- database function ever checked one.
--
-- The vertical gate that DOES work is vertical_settings.is_enabled +
-- rollout_percentage + enabled_regions, intersected with what the rider earned
-- and enforced server-side in get_rider_progress. Keeping a parallel set of
-- switches that claim to control the same tiles is worse than having none:
-- someone eventually flips one and believes the vertical is off.
--
-- Deleted. Verified first that every flag apps DO read survives:
-- kiosk_active, carnival_active, events_active (rider HomeScreen),
-- driver_registration_active (driver LoginScreen),
-- merchant_billing_enabled (admin MerchantNetwork).
--
-- ALSO FIXED — the silent no-op that made phantom switches possible
-- ----------------------------------------------------------------
-- admin_toggle_feature_flag was a bare UPDATE ... WHERE id = p_id with no
-- row-count check. Toggling an id that did not exist matched zero rows, raised
-- nothing, and returned success. PlatformControl exploited this by injecting
-- 'wallet_active' and 'commander_system_active' into local state when they were
-- absent from the database — two switches that looked real, could be clicked,
-- and could never do anything. The injection is removed and the function now
-- raises on an unknown id, so this class of ghost control cannot return.
--
-- Verified live in a rolled-back transaction as a real admin JWT:
--   real flag toggles true -> false                              PASS
--   wallet_active REFUSED "Unknown feature flag ... Nothing was changed" PASS
--   grocery_module (deleted) REFUSED                             PASS
--   admin_update_vertical still works                            PASS
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vertical_settings
  DROP COLUMN IF EXISTS commission_rate_percent,
  DROP COLUMN IF EXISTS driver_commission_percent;

COMMENT ON TABLE public.vertical_settings IS
'Which verticals are on, per region, with staged rollout. Enforced server-side by get_rider_progress (earned AND allowed). Contains NO commission rates on purpose — the split lives only in pricing_config and is applied only by compute_ride_split.';

DELETE FROM public.system_feature_flags
 WHERE id IN ('grocery_active','laundry_active','grocery_module','grocery_vertical',
              'laundry_module','laundry_vertical','pharma_vertical');

COMMENT ON TABLE public.system_feature_flags IS
'Platform behaviour switches. NOT vertical on/off — that is vertical_settings. Every row here must be read by real code; a switch nothing reads is worse than no switch. admin_toggle_feature_flag raises on an unknown id to keep that true.';

CREATE OR REPLACE FUNCTION public.admin_toggle_feature_flag(p_id text, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_role TEXT;
    v_n    integer;
BEGIN
    SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
    IF v_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: admin role required';
    END IF;

    UPDATE system_feature_flags SET
        is_active  = p_is_active,
        toggled_at = now(),
        toggled_by = auth.uid()
    WHERE id = p_id;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Unknown feature flag: %. Nothing was changed.', p_id;
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_toggle_feature_flag(text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_toggle_feature_flag(text,boolean) TO authenticated, service_role;
