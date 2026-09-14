-- Registers the new initiate_lime_fleet action_type in g_action_types so
-- g_execute_action's handler-drift check recognizes the handler added in the
-- same change instead of refusing to run it as drifted.
--
-- NOTE: g_action_types itself has no CREATE TABLE migration anywhere in this
-- repo's git history -- it exists live in production (confirmed via
-- information_schema, 2026-09-14) with 15 other rows already in it, none of
-- them captured in git either. That's a pre-existing "deployed ahead of git"
-- gap discovered while making this change, not something this migration
-- attempts to fully backfill -- reconstructing 15 rows' exact payload_schema
-- and description text from scratch risks getting them subtly wrong. Flagged
-- to the owner as a separate follow-up; this migration only adds the one new
-- row this session's change actually depends on.
insert into g_action_types (action_type, execution_mode, category_default, description, payload_schema, is_enabled)
values (
  'initiate_lime_fleet',
  'handler',
  'money',
  'Rider-initiated group split-fare session, filed by Jarvis when a rider asks to start a "Lime Fleet". Requires payload.rider_id, payload.participant_count, payload.share_cents, and amount_cents (total fare).',
  '{"required":["rider_id","participant_count","share_cents"]}'::jsonb,
  true
)
on conflict (action_type) do nothing;
