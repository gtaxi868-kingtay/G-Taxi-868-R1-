-- ═══════════════════════════════════════════════════════════════════════════
-- F1 — expiry must notify (AI layer design doc v2, fix list)
--
-- g_proposed_actions rows were dying silently: the hourly g-proposal-expiry
-- cron (20260711000000_g_chief_of_staff.sql) runs a bare
-- UPDATE ... SET status='expired' WHERE status='pending' AND expires_at<now()
-- with no alert, no push, nothing. Confirmed live: 43 of 51 proposals ever
-- filed are sitting at status='expired' with zero record of anyone being
-- told.
--
-- Implemented as a trigger, not a cron-body rewrite, for two reasons:
--  1. It fires on the status transition itself, regardless of what causes
--     it — the existing hourly cron today, but also any future manual
--     UPDATE or a different sweep mechanism later. The guarantee lives on
--     the data, not on one specific caller remembering to notify.
--  2. It's atomic with the transition — no separate "mark expired" then
--     "notify" steps that could diverge if one half fails.
--
-- Reuses raise_admin_alert() exactly as every other admin alert in this
-- system does (confirmed by reading it first: it inserts system_alerts AND
-- best-effort pushes every admin with a registered Expo token, with the
-- push attempt wrapped so a push failure never rolls back the alert row).
-- No new notification mechanism invented.
--
-- Alert type: G_PROPOSAL_UNACTIONED. This value was already present in
-- system_alerts' type CHECK constraint -- confirmed by reading the
-- constraint before writing this -- but grepping the entire repo found
-- zero references to it anywhere. It was provisioned for exactly this and
-- never wired up. Using it means this migration does not need to touch
-- the CHECK constraint at all.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_proposal_expired()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.raise_admin_alert(
    'G_PROPOSAL_UNACTIONED',
    format('G proposal expired unseen: %s', NEW.title),
    format(
      '"%s" (%s, department: %s) expired after 72 hours with no decision. Review the Approvals screen.',
      NEW.title, NEW.action_type, NEW.department
    ),
    'WARNING',
    jsonb_build_object(
      'proposal_id', NEW.id,
      'action_type', NEW.action_type,
      'department', NEW.department,
      'category', NEW.category,
      'amount_cents', NEW.amount_cents
    )
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_proposal_expired ON public.g_proposed_actions;
CREATE TRIGGER trg_notify_proposal_expired
AFTER UPDATE ON public.g_proposed_actions
FOR EACH ROW
WHEN (OLD.status = 'pending' AND NEW.status = 'expired')
EXECUTE FUNCTION public.notify_proposal_expired();

REVOKE ALL ON FUNCTION public.notify_proposal_expired() FROM PUBLIC, anon, authenticated;
