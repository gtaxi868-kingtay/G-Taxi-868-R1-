-- ADMIN RIDE TOOLS
-- Bypasses RLS via Security Definer

BEGIN;
CREATE OR REPLACE FUNCTION admin_update_ride_status(
    p_ride_id UUID, 
    p_status TEXT, 
    p_driver_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.rides 
    SET 
        status = p_status::public.ride_status,
        driver_id = COALESCE(p_driver_id, driver_id),
        updated_at = NOW()
    WHERE id = p_ride_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- SECURE IT
REVOKE EXECUTE ON FUNCTION admin_update_ride_status(UUID, TEXT, UUID) FROM public;
GRANT EXECUTE ON FUNCTION admin_update_ride_status(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION admin_update_ride_status(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_ride_status(UUID, TEXT, UUID) TO anon;
COMMIT;
