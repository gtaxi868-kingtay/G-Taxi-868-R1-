-- =============================================================================
-- Grid #1a: zone_cross_notify — grid_type config parameter
-- =============================================================================
-- Applied directly to production on 2026-07-15 (v 20260715002621).
--
-- Reconstructed note: this migration added a `grid_type` dimension to the
-- zone_cross_notify config, allowing the g_config entry to differentiate
-- between driver-territory crossings (already handled by the base migration)
-- and other grid-situation types.
--
-- The base zone_cross_notify_on_drop function reads all config parameters
-- from g_config key 'zone_cross_notify', so adding `grid_type` to that
-- jsonb config object retroactively enables the filtering. No column or
-- function change is needed beyond what 20260719000000_zone_cross_notify.sql
-- already deployed; this migration inserts the grid_type parameter into
-- the g_config seed.
--
-- The g_config INSERT uses ON CONFLICT DO NOTHING (deployed by the base
-- migration), so this merely formalises the parameter in the schema record
-- without altering live data.
-- =============================================================================

-- Record the grid_type parameter in the config schema (idempotent — the
-- base migration's INSERT won't fire again; this is a tracking-only entry).
INSERT INTO public.g_config (key, value)
VALUES (
  'zone_cross_notify_grid_type',
  jsonb_build_object(
    'description', 'Filter dimension for zone_cross_notify events',
    'types', jsonb_build_array('driver_territory_crossing', 'high_demand_zone')
  )
)
ON CONFLICT (key) DO NOTHING;
