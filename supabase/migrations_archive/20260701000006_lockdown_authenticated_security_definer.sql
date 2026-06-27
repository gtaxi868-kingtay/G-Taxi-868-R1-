-- HARDENED CORE — Phase B: deny-by-default EXECUTE for `authenticated` on
-- SECURITY DEFINER functions, keeping only those the apps actually call.
--
-- After Phase A (anon revoked), any *logged-in* user could still call all 158
-- SECURITY DEFINER functions directly via /rest/v1/rpc/ — including privileged
-- writers like capture_escape_wipay_payment (marks a booking paid with NO
-- payment check), process_wallet_payment_hardened, credit_wallet, etc. This is
-- the authenticated-tier privilege-escalation surface.
--
-- We revoke `authenticated` EXECUTE on every SECURITY DEFINER function in public
-- EXCEPT:
--   (1) the ~31 RPCs the rider/driver/admin/merchant apps call directly
--       (verified: every client .rpc() uses a string literal; list is complete),
--   (2) any function referenced in an RLS policy expression (USING/WITH CHECK) —
--       authenticated must keep EXECUTE or row-level SELECT/INSERT breaks,
--   (3) any function referenced in a column DEFAULT — needed by inserting role.
--
-- `service_role` keeps EXECUTE on everything (edge functions are unaffected).
-- Trigger functions don't require EXECUTE for the DML-invoking user, so revoking
-- them is harmless. Extension-owned functions (PostGIS etc.) are skipped.
--
-- Reversible: GRANT EXECUTE ... TO authenticated restores prior access.

DO $$
DECLARE
  r RECORD;
  client_keep text[] := ARRAY[
    'add_mid_ride_stop','admin_create_driver_loan','admin_create_surge_zone','admin_deactivate_surge_zone',
    'admin_escape_action','admin_get_organizer_banks','admin_get_platform_rates','admin_get_pricing',
    'admin_get_reserve_balance','admin_get_surge_zones','admin_set_merchant_billing','admin_set_pricing',
    'admin_set_surge_zone','admin_toggle_feature_flag','admin_update_vertical','admin_upsert_organizer_bank',
    'apply_referral_code','expire_ride','generate_referral_code','get_demand_hotspots','get_home_suggestion',
    'get_merchant_earnings','get_nearby_merchants','get_package_opportunities','get_wallet_balance',
    'increment_stop_wait_time','process_merchant_billing','process_tip','record_driver_lease_consent',
    'retry_ride_matching','update_driver_location_packet'
  ];
  n_revoked INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public'
      AND p.prosecdef = true
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      AND p.proname <> ALL (client_keep)
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy pol
        WHERE pg_get_expr(pol.polqual,      pol.polrelid) ~ ('\m' || p.proname || '\M')
           OR pg_get_expr(pol.polwithcheck, pol.polrelid) ~ ('\m' || p.proname || '\M')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_attrdef ad
        WHERE pg_get_expr(ad.adbin, ad.adrelid) ~ ('\m' || p.proname || '\M')
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    n_revoked := n_revoked + 1;
  END LOOP;

  RAISE NOTICE 'Phase B lockdown: authenticated EXECUTE revoked on % SECURITY DEFINER functions', n_revoked;
END $$;