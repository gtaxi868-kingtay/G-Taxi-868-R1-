-- Business console v1: VISIBILITY ONLY (Connection Map item 2).
-- A signed-in business sees its own record: profile, touch points, the rides
-- it booked for guests and clients, and the drivers it vouched for with their
-- status. Read-only; one call so the screens load fast on a phone.
--
-- Driver privacy: a business sees the first name, verification status and
-- whether the driver is working now, never their phone, plate or location.

CREATE OR REPLACE FUNCTION public.merchant_dashboard() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_m public.merchants%ROWTYPE; v_mid uuid;
BEGIN
    SELECT merchant_id INTO v_mid FROM public.profiles WHERE id = auth.uid();
    IF v_mid IS NULL THEN
        -- Staff accounts see their employer's business.
        SELECT merchant_id INTO v_mid FROM public.merchant_staff WHERE user_id = auth.uid() AND is_active LIMIT 1;
    END IF;
    IF v_mid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'This account is not linked to a business.'); END IF;
    SELECT * INTO v_m FROM public.merchants WHERE id = v_mid;

    RETURN jsonb_build_object(
        'success', true,
        'business', jsonb_build_object(
            'id', v_m.id, 'name', v_m.name, 'category', v_m.category, 'address', v_m.address,
            'has_location', v_m.lat IS NOT NULL AND v_m.lng IS NOT NULL,
            'status', v_m.activation_status, 'is_active', v_m.is_active,
            'area', (SELECT t.name FROM public.territories t WHERE t.id = v_m.territory_id),
            'billing', COALESCE(v_m.billing_type, 'cash'),
            'credit_limit_cents', v_m.credit_limit_cents, 'current_debt_cents', v_m.current_debt_cents),
        'touch_points', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'name', k.location_name, 'pickup_spot', k.pickup_address,
                'tag_ready', k.tag_uid IS NOT NULL, 'live', k.is_active, 'status', k.provision_status) ORDER BY k.created_at)
            FROM public.kiosk_nodes k WHERE k.merchant_id = v_m.id), '[]'::jsonb),
        'rides', COALESCE((SELECT jsonb_agg(r ORDER BY (r->>'at') DESC) FROM (
            SELECT jsonb_build_object(
                'id', rd.id, 'status', rd.status,
                'at', COALESCE(rd.scheduled_for, rd.created_at),
                'guest', COALESCE(rd.metadata->>'client_name', rd.metadata->>'guest_name', 'Guest'),
                'to', rd.dropoff_address, 'from', rd.pickup_address,
                'fare_cents', rd.total_fare_cents,
                'billed_monthly', rd.billed_to_merchant_id IS NOT NULL,
                'airport', (rd.metadata->>'is_airport_pickup') = 'true',
                'flight', rd.metadata->>'flight_number') AS r
              FROM public.rides rd
             WHERE rd.metadata->>'dispatched_by_merchant_id' = v_m.id::text OR rd.billed_to_merchant_id = v_m.id
             ORDER BY rd.created_at DESC LIMIT 50) x), '[]'::jsonb),
        'ride_counts', jsonb_build_object(
            'last_30_days', (SELECT count(*) FROM public.rides rd
                              WHERE (rd.metadata->>'dispatched_by_merchant_id' = v_m.id::text OR rd.billed_to_merchant_id = v_m.id)
                                AND rd.created_at > now() - interval '30 days'),
            'completed', (SELECT count(*) FROM public.rides rd
                           WHERE (rd.metadata->>'dispatched_by_merchant_id' = v_m.id::text OR rd.billed_to_merchant_id = v_m.id)
                             AND rd.status IN ('completed', 'payment_confirmed', 'closed'))),
        'drivers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'first_name', split_part(COALESCE(d.name, 'Driver'), ' ', 1),
                'verified', COALESCE(d.is_verified, false),
                'status', CASE WHEN COALESCE(d.is_verified, false) THEN 'Verified' ELSE 'Waiting for checks' END,
                'working_now', COALESCE(d.is_online, false),
                'since', d.recruited_by_merchant_at) ORDER BY d.recruited_by_merchant_at DESC NULLS LAST)
            FROM public.drivers d WHERE d.recruited_by_merchant_id = v_m.id), '[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_dashboard() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_dashboard() TO authenticated;
