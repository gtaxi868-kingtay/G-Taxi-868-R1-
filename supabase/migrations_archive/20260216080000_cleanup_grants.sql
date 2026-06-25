-- CLEANUP GRANTS
-- Revoke temporary debug access to Admin RPCs.
-- Secure them for Service Role use only.

BEGIN;
-- 1. Admin Top Up
REVOKE EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) FROM anon;
-- 2. Admin Create Driver
REVOKE EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) FROM authenticated;
REVOKE EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) FROM anon;
-- 3. Admin Update Ride Status
REVOKE EXECUTE ON FUNCTION admin_update_ride_status(UUID, TEXT, UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION admin_update_ride_status(UUID, TEXT, UUID) FROM anon;
COMMIT;
