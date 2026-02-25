-- ADMIN DRIVER TOOLS
-- Bypasses RLS via Security Definer

BEGIN;

CREATE OR REPLACE FUNCTION admin_create_driver(
    p_id UUID, 
    p_name TEXT, 
    p_status TEXT, 
    p_is_online BOOLEAN
) RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO public.drivers (id, name, status, is_online)
    VALUES (p_id, p_name, p_status, p_is_online);
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SECURE IT
REVOKE EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) FROM public;
REVOKE EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) FROM authenticated;
REVOKE EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) TO service_role;

-- ALSO GRANT TO AUTHENTICATED/ANON TEMPORARILY IF NEEDED? 
-- No, let's trust Service Key works now (it worked for admin_top_up with debug grant).
-- Wait, admin_top_up worked AFTER debug grant (TO authenticated/anon).
-- If I use just TO service_role, it might fail again if Key is mismatched.
-- I should add the Debug Grant for this function too, just to be sure.
GRANT EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) TO anon;

COMMIT;
