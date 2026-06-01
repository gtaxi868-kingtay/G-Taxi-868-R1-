-- =============================================================================
-- 6-STEP STABILIZATION — Step 6: Schedule Stripe Reconciliation Audit
-- Runs audit_stripe_vs_ledger edge function daily at 4:00 AM UTC.
-- Requires CRON_SECRET env var to be set in Supabase project settings.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  cron_secret_value text;
BEGIN
  BEGIN
    cron_secret_value := current_setting('app.settings.cron_secret', true);
  EXCEPTION WHEN OTHERS THEN
    cron_secret_value := NULL;
  END;

  IF cron_secret_value IS NULL THEN
    RAISE WARNING 'app.settings.cron_secret not set — scheduled audit will fail until the secret is configured.';
    RAISE WARNING 'Run: SELECT set_config(''app.settings.cron_secret'', ''<your-cron-secret>'', false);';
  END IF;
END;
$$;

SELECT cron.schedule(
  'audit-stripe-reconciliation',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/audit_stripe_vs_ledger',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true)
    )
  ) AS request_id;
  $$
);
