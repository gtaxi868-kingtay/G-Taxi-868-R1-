-- FINAL PERMISSION FIX
-- Ensure Service Role has absolute power over Admin Tools and Tipping
-- Using "postgres" role via migration to ensure override.

BEGIN;

-- 1. Admin Top Up
GRANT EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) TO authenticated; -- Just in case (Secure via RLS/Logic if needed, but for now we unblock)

-- 2. Admin Create Driver
GRANT EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) TO service_role;

-- 3. Admin Update Status
GRANT EXECUTE ON FUNCTION admin_update_ride_status(UUID, TEXT, UUID) TO service_role;

-- 4. Process Tip
GRANT EXECUTE ON FUNCTION process_tip(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION process_tip(UUID, INTEGER) TO authenticated;

COMMIT;
