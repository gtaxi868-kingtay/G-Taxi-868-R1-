-- Fix RLS on wipay_transactions and system_settings
ALTER TABLE public.wipay_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wipay_transactions_service_only"
    ON public.wipay_transactions FOR ALL
    TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "system_settings_select_auth"
    ON public.system_settings FOR SELECT
    TO authenticated USING (true);

CREATE POLICY "system_settings_write_service"
    ON public.system_settings FOR ALL
    TO service_role USING (true) WITH CHECK (true);

-- Fix expo_push_tickets permissive UPDATE policy
DROP POLICY IF EXISTS "expo_push_tickets_update_service" ON public.expo_push_tickets;

CREATE POLICY "expo_push_tickets_update_service"
    ON public.expo_push_tickets FOR UPDATE
    TO service_role USING (true) WITH CHECK (true);

-- Revoke anon EXECUTE from sensitive SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.get_wallet_balance(p_user_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_wallet_payment(p_ride_id uuid, p_amount integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_wallet_payment_hardened(p_ride_id uuid, p_amount integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_wallet_payment_hardened(p_ride_id uuid, p_amount integer, p_idempotency_key text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_wallet_credit_idempotent(p_user_id uuid, p_amount_cents integer, p_reference_id text, p_provider text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_tip(p_ride_id uuid, p_amount integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_wallet_adjust(p_user_id uuid, p_amount_cents integer, p_reason text, p_admin_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_driver_debt_limit(p_driver_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_spoof_flag(p_driver_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_driver_location_packet(p_lat double precision, p_lng double precision, p_heading double precision, p_speed double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_cash_payment(ride_uuid uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_ride(p_ride_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_ride_atomic(p_rider_id uuid, p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_address text, p_dropoff_lat double precision, p_dropoff_lng double precision, p_dropoff_address text, p_status text, p_total_fare_cents integer, p_driver_payout_cents integer, p_distance_meters integer, p_duration_seconds integer, p_route_polyline text, p_vehicle_type text, p_payment_method text, p_ride_pin text, p_idempotency_key text, p_metadata jsonb, p_taxi_stand_id uuid, p_billed_to_merchant_id uuid, p_node_id uuid, p_driver_cut integer, p_platform_cut integer, p_merchant_cut integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_mid_ride_stop(p_ride_id uuid, p_place_name text, p_lat double precision, p_lng double precision, p_address text) FROM anon;

-- Fix merchant_nodes view
CREATE OR REPLACE VIEW public.merchant_nodes WITH (security_invoker = true) AS
SELECT * FROM public.kiosk_nodes;

-- Fix storage bucket policies
DROP POLICY IF EXISTS "Give users access to own folder" ON storage.objects;
DROP POLICY IF EXISTS "merchant_intake_select" ON storage.objects;
DROP POLICY IF EXISTS "merchant_intake_insert" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read intake photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated write intake photos" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "receipts_select_auth" ON storage.objects;
DROP POLICY IF EXISTS "receipts_insert_auth" ON storage.objects;

CREATE POLICY "merchant_intake_select_auth"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'merchant-intake-photos');

CREATE POLICY "merchant_intake_insert_auth"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'merchant-intake-photos');

CREATE POLICY "receipts_select_own"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "receipts_insert_own"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Fix stripe_config orphaned RLS
CREATE POLICY "stripe_config_select_auth"
    ON public.stripe_config FOR SELECT
    TO authenticated USING (true);

CREATE POLICY "stripe_config_write_service"
    ON public.stripe_config FOR ALL
    TO service_role USING (true) WITH CHECK (true);
