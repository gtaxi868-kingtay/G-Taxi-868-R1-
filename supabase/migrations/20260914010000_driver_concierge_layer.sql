-- Driver voice (Phase 2 of the reviewed 3-voice AI architecture). Mirrors
-- g_rider_memory/rider_ai_preferences exactly, including the identity
-- convention: this codebase's own rule is that rides.driver_id is
-- drivers.id (a separate generated PK), NOT auth.uid() -- but for RLS
-- simplicity and to match how g_rider_memory keys "rider_id" as auth.uid()
-- directly (riders' profiles.id IS auth.uid()), this table keys on
-- `driver_user_id` explicitly named to make clear it is auth.uid()
-- (drivers.user_id), never drivers.id.

CREATE TABLE IF NOT EXISTS public.driver_ai_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_suggestions_enabled boolean NOT NULL DEFAULT false,
  memory_enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_ai_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_ai_preferences_own ON public.driver_ai_preferences;
CREATE POLICY driver_ai_preferences_own ON public.driver_ai_preferences
  FOR ALL USING (user_id = auth.uid());

-- kind deliberately excludes rider-shaped concepts (frequent_order) --
-- 'concern' is the one addition, for flag_concern's own record of what was
-- raised (separate from the g_proposed_actions row admin actually sees;
-- this is the driver's own memory of having raised it, so a future
-- conversation doesn't ask them to repeat themselves).
CREATE TABLE IF NOT EXISTS public.g_driver_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('preference','route_note','concern')),
  content jsonb NOT NULL,
  confidence numeric(3,2) NOT NULL DEFAULT 0.8,
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_g_driver_memory_driver
  ON public.g_driver_memory (driver_user_id, kind, last_confirmed_at DESC);
ALTER TABLE public.g_driver_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS g_driver_memory_own ON public.g_driver_memory;
CREATE POLICY g_driver_memory_own ON public.g_driver_memory
  FOR ALL USING (driver_user_id = auth.uid());

-- Registers the driver-concern action type as manual_ack (no automated
-- handler needed -- flagging a concern just needs to reach the admin
-- inbox, "approving" it means "seen and will act on it manually", same
-- shape as draft_post/support_reply_draft). Not gated behind admin
-- approval before the driver sees it acknowledged -- the row landing in
-- g_proposed_actions IS the visibility, same as every other proposal.
insert into g_action_types (action_type, execution_mode, category_default, description, payload_schema, is_enabled)
values (
  'driver_concern',
  'manual_ack',
  'people',
  'A driver flagged a concern via the driver AI voice (safety, pay question, or general feedback) -- not auto-executed, just needs an admin to see and act on it manually.',
  '{"required":["driver_user_id","concern"]}'::jsonb,
  true
)
on conflict (action_type) do nothing;
