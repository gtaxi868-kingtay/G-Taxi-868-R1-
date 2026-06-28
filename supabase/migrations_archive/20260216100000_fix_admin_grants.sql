-- Fix Admin Grants
-- Ensure Service Role can execute the Admin Tools

GRANT EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION admin_create_driver(UUID, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION admin_update_ride_status(UUID, TEXT, UUID) TO service_role;
