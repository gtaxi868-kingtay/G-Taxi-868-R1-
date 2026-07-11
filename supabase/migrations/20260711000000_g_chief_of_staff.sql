-- =============================================================================
-- G — AI Chief of Staff: decision log fix, approval queue, config, budget,
-- rider memory/reminders, social metrics, merchant promotions, ranking RPC.
-- =============================================================================

-- 1. agent_decision_log: drop the CHECK that silently rejects new decision
--    types (inserts were swallowed by .catch(() => null) in edge functions).
ALTER TABLE public.agent_decision_log
  DROP CONSTRAINT IF EXISTS agent_decision_log_decision_type_check;
ALTER TABLE public.agent_decision_log
  ADD COLUMN IF NOT EXISTS department text;
CREATE INDEX IF NOT EXISTS idx_agent_decision_log_department
  ON public.agent_decision_log (department, created_at DESC);

-- 2. Approval queue -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.g_proposed_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  action_type text NOT NULL,
  title text NOT NULL,
  reasoning text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  category text NOT NULL CHECK (category IN ('money','people','public','config','other')),
  amount_cents bigint,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired','executed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  decided_by uuid REFERENCES public.profiles(id),
  decided_at timestamptz,
  execution_result jsonb
);
CREATE INDEX IF NOT EXISTS idx_g_proposed_actions_status
  ON public.g_proposed_actions (status, created_at DESC);

ALTER TABLE public.g_proposed_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS g_proposed_actions_admin ON public.g_proposed_actions;
CREATE POLICY g_proposed_actions_admin ON public.g_proposed_actions
  FOR ALL USING (
    (SELECT role::text FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- 3. G config -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.g_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.g_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS g_config_admin ON public.g_config;
CREATE POLICY g_config_admin ON public.g_config
  FOR ALL USING (
    (SELECT role::text FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

INSERT INTO public.g_config (key, value) VALUES
  ('g_enabled', 'true'::jsonb),
  ('daily_llm_budget_usd', '0.80'::jsonb),
  ('auto_approve', '{"surge_max": 2.0, "max_interventions_per_run": 3}'::jsonb),
  ('max_proposals_per_department_per_day', '10'::jsonb),
  ('department.reserved', '{"enabled": false, "prompt": "", "tools": []}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4. LLM budget counter --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.g_llm_usage (
  day date NOT NULL,
  department text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  est_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (day, department)
);
ALTER TABLE public.g_llm_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS g_llm_usage_admin ON public.g_llm_usage;
CREATE POLICY g_llm_usage_admin ON public.g_llm_usage
  FOR SELECT USING (
    (SELECT role::text FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- 5. Rider structured memory (consented) ---------------------------------------
CREATE TABLE IF NOT EXISTS public.g_rider_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('preference','frequent_order','place','reminder','fact')),
  content jsonb NOT NULL,
  confidence numeric(3,2) NOT NULL DEFAULT 0.8,
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_g_rider_memory_rider
  ON public.g_rider_memory (rider_id, kind, last_confirmed_at DESC);
ALTER TABLE public.g_rider_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS g_rider_memory_own ON public.g_rider_memory;
CREATE POLICY g_rider_memory_own ON public.g_rider_memory
  FOR ALL USING (rider_id = auth.uid());

-- 6. Rider reminders (delivered by sweep via push) ------------------------------
CREATE TABLE IF NOT EXISTS public.g_rider_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  due_at timestamptz NOT NULL,
  recurrence text CHECK (recurrence IN ('none','daily','weekly')) DEFAULT 'none',
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_g_rider_reminders_due
  ON public.g_rider_reminders (due_at) WHERE delivered_at IS NULL;
ALTER TABLE public.g_rider_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS g_rider_reminders_own ON public.g_rider_reminders;
CREATE POLICY g_rider_reminders_own ON public.g_rider_reminders
  FOR ALL USING (rider_id = auth.uid());

-- 7. Social metrics (manual import now, Graph API sync later) -------------------
CREATE TABLE IF NOT EXISTS public.g_social_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','x','other')),
  post_ref text NOT NULL,
  posted_at timestamptz,
  caption text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, post_ref)
);
ALTER TABLE public.g_social_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS g_social_metrics_admin ON public.g_social_metrics;
CREATE POLICY g_social_metrics_admin ON public.g_social_metrics
  FOR ALL USING (
    (SELECT role::text FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- 8. Merchant promotions (featured placements; admin approves) ------------------
CREATE TABLE IF NOT EXISTS public.merchant_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  headline text NOT NULL,
  offer text,
  budget_type text NOT NULL DEFAULT 'featured_slot' CHECK (budget_type IN ('featured_slot')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','active','rejected','ended')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_merchant_promotions_active
  ON public.merchant_promotions (merchant_id) WHERE status = 'active';
ALTER TABLE public.merchant_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_promotions_admin ON public.merchant_promotions;
CREATE POLICY merchant_promotions_admin ON public.merchant_promotions
  FOR ALL USING (
    (SELECT role::text FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );
-- Riders may read active promos (they surface as "Featured")
DROP POLICY IF EXISTS merchant_promotions_public_read ON public.merchant_promotions;
CREATE POLICY merchant_promotions_public_read ON public.merchant_promotions
  FOR SELECT USING (status = 'active' AND now() BETWEEN starts_at AND ends_at);

-- 9. rider_ai_preferences: memory consent + metadata (greeting cache fix) -------
ALTER TABLE public.rider_ai_preferences
  ADD COLUMN IF NOT EXISTS memory_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.rider_ai_preferences
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 10. RPC: approve/reject a proposal --------------------------------------------
CREATE OR REPLACE FUNCTION public.g_decide_action(p_id uuid, p_decision text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_row public.g_proposed_actions;
BEGIN
  IF (SELECT role::text FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected';
  END IF;

  UPDATE public.g_proposed_actions
     SET status = p_decision,
         decided_by = auth.uid(),
         decided_at = now()
   WHERE id = p_id AND status = 'pending'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found or not pending';
  END IF;

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;
REVOKE ALL ON FUNCTION public.g_decide_action(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.g_decide_action(uuid, text) TO authenticated, service_role;

-- 11. RPC: personalized merchant ranking ----------------------------------------
CREATE OR REPLACE FUNCTION public.g_rank_merchants(
  p_rider_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_store_type text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  merchant_id uuid,
  name text,
  category text,
  store_type text,
  lat double precision,
  lng double precision,
  distance_m double precision,
  score numeric,
  is_usual boolean,
  visit_count integer,
  is_featured boolean,
  is_open boolean,
  cover_image_url text,
  delivery_fee_cents integer,
  minimum_order_cents integer,
  address text,
  avg_delivery_minutes integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_rider uuid := COALESCE(auth.uid(), p_rider_id);
  v_personalize boolean := false;
BEGIN
  -- Personalization only with explicit consent; otherwise plain distance.
  SELECT COALESCE(rap.ai_suggestions_enabled, false)
    INTO v_personalize
    FROM public.rider_ai_preferences rap
   WHERE rap.user_id = v_rider;
  v_personalize := COALESCE(v_personalize, false);

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.category,
    m.store_type,
    m.lat,
    m.lng,
    ST_DistanceSphere(ST_MakePoint(p_lng, p_lat), ST_MakePoint(m.lng, m.lat)) AS distance_m,
    (
      -- Base: distance decay (0..100)
      GREATEST(0, 100 - LEAST(ST_DistanceSphere(ST_MakePoint(p_lng, p_lat), ST_MakePoint(m.lng, m.lat)) / 1000.0 * 8, 60))
      + CASE WHEN v_personalize THEN LEAST(COALESCE(ush.visit_count, 0) * 6, 30) ELSE 0 END
      + CASE WHEN v_personalize AND rrp.typical_merchant_id IS NOT NULL
             THEN 15 * COALESCE(rrp.probability, 0.5) ELSE 0 END
      + CASE WHEN m.is_open THEN 10 ELSE 0 END
      + CASE WHEN promo.merchant_id IS NOT NULL THEN 20 ELSE 0 END
      + CASE WHEN m.is_pinned THEN 5 ELSE 0 END
    )::numeric AS score,
    (COALESCE(ush.visit_count, 0) >= 2) AS is_usual,
    COALESCE(ush.visit_count, 0)::integer AS visit_count,
    (promo.merchant_id IS NOT NULL) AS is_featured,
    m.is_open,
    m.cover_image_url,
    m.delivery_fee_cents,
    m.minimum_order_cents,
    m.address,
    m.avg_delivery_minutes
  FROM public.merchants m
  LEFT JOIN public.user_service_history ush
    ON ush.merchant_id = m.id AND ush.user_id = v_rider
  LEFT JOIN LATERAL (
    SELECT r.typical_merchant_id, r.probability
      FROM public.rider_route_patterns r
     WHERE r.rider_id = v_rider AND r.typical_merchant_id = m.id
     ORDER BY r.probability DESC
     LIMIT 1
  ) rrp ON true
  LEFT JOIN LATERAL (
    SELECT mp.merchant_id
      FROM public.merchant_promotions mp
     WHERE mp.merchant_id = m.id AND mp.status = 'active'
       AND now() BETWEEN mp.starts_at AND mp.ends_at
     LIMIT 1
  ) promo ON true
  WHERE m.is_active = true
    AND m.activation_status = 'active'
    AND (p_store_type IS NULL OR m.store_type = p_store_type)
    AND ST_DistanceSphere(ST_MakePoint(p_lng, p_lat), ST_MakePoint(m.lng, m.lat)) <= 20000
  ORDER BY score DESC, distance_m ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 30);
END;
$$;
REVOKE ALL ON FUNCTION public.g_rank_merchants(uuid, double precision, double precision, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.g_rank_merchants(uuid, double precision, double precision, text, integer) TO authenticated, service_role;

-- 12. Helper RPCs for G services (service-role only) ----------------------------
CREATE OR REPLACE FUNCTION public.g_cron_health()
RETURNS TABLE (jobname text, schedule text, active boolean, last_status text, last_run timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT j.jobname::text, j.schedule::text, j.active,
    (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1)::text,
    (SELECT d.start_time FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1)
  FROM cron.job j
  ORDER BY j.jobname;
$$;
REVOKE ALL ON FUNCTION public.g_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g_cron_health() TO service_role;

CREATE OR REPLACE FUNCTION public.g_add_llm_usage(
  p_department text, p_prompt bigint, p_completion bigint, p_cost numeric
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  INSERT INTO public.g_llm_usage (day, department, calls, prompt_tokens, completion_tokens, est_cost_usd)
  VALUES (current_date, p_department, 1, p_prompt, p_completion, p_cost)
  ON CONFLICT (day, department) DO UPDATE
    SET calls = g_llm_usage.calls + 1,
        prompt_tokens = g_llm_usage.prompt_tokens + EXCLUDED.prompt_tokens,
        completion_tokens = g_llm_usage.completion_tokens + EXCLUDED.completion_tokens,
        est_cost_usd = g_llm_usage.est_cost_usd + EXCLUDED.est_cost_usd;
$$;
REVOKE ALL ON FUNCTION public.g_add_llm_usage(text, bigint, bigint, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g_add_llm_usage(text, bigint, bigint, numeric) TO service_role;

-- 13. pg_cron: department runs (T&T is UTC-4; 09:30 UTC = 05:30 local),
--     execution sweep, proposal expiry. HTTP jobs read the shared cron secret
--     from the app.settings.cron_secret GUC (never hardcoded in git).
DO $$
DECLARE
  v_jobs text[] := ARRAY[
    'g-dept-ops', 'g-dept-finance', 'g-dept-support', 'g-dept-content_creator',
    'g-execute-sweep', 'g-proposal-expiry'
  ];
  j text;
BEGIN
  FOREACH j IN ARRAY v_jobs LOOP
    PERFORM cron.unschedule(j) FROM cron.job WHERE jobname = j;
  END LOOP;
END $$;

SELECT cron.schedule('g-dept-ops', '30 9 * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/g_agent_runner',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', current_setting('app.settings.cron_secret', true)),
    body := '{"department":"ops"}'::jsonb)
$$);
SELECT cron.schedule('g-dept-finance', '45 9 * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/g_agent_runner',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', current_setting('app.settings.cron_secret', true)),
    body := '{"department":"finance"}'::jsonb)
$$);
SELECT cron.schedule('g-dept-support', '0 10 * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/g_agent_runner',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', current_setting('app.settings.cron_secret', true)),
    body := '{"department":"support"}'::jsonb)
$$);
SELECT cron.schedule('g-dept-content_creator', '15 10 * * 1,4', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/g_agent_runner',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', current_setting('app.settings.cron_secret', true)),
    body := '{"department":"content_creator"}'::jsonb)
$$);
SELECT cron.schedule('g-execute-sweep', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/g_execute_action',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', current_setting('app.settings.cron_secret', true)),
    body := '{"sweep":true}'::jsonb)
$$);
SELECT cron.schedule('g-proposal-expiry', '10 * * * *', $$
  UPDATE public.g_proposed_actions
     SET status = 'expired'
   WHERE status = 'pending' AND expires_at < now()
$$);
