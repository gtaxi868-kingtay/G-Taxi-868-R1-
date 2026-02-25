-- DEBUG GRANT
-- Opening admin_top_up to all to debug permission failure.
-- WILL BE REVERTED.

GRANT EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_top_up(UUID, INTEGER) TO anon;
