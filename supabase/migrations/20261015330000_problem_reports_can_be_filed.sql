-- ═══════════════════════════════════════════════════════════════════
-- Rider "Report a problem" reports can actually be filed.
--
-- Before (verified live 2026-10-15): the merchant function's submit_dispute
-- inserts support_tickets with user_id, ride_id, category, description,
-- but subject is NOT NULL with no default, so every report (refund,
-- overcharge, lost item, safety) failed with "Could Not Submit". Two of
-- the categories the app and function offer (driver_behavior, app_issue,
-- plus the function's rider_behavior) were also refused by the category
-- CHECK. 0 tickets have ever been filed.
--
-- After (database only, no function deploy needed):
--  - category CHECK also allows driver_behavior, rider_behavior, app_issue.
--  - BEFORE INSERT trigger fills subject from the category when missing,
--    and marks safety reports priority 'urgent' unless one was given.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_category_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_category_check
  CHECK (category = ANY (ARRAY['overcharge', 'double_charge', 'driver_issue', 'driver_behavior',
                               'rider_behavior', 'safety', 'lost_item', 'refund_request',
                               'account', 'app_issue', 'other']));

CREATE OR REPLACE FUNCTION public.support_ticket_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.subject IS NULL OR btrim(NEW.subject) = '' THEN
    NEW.subject := CASE NEW.category
      WHEN 'refund_request'  THEN 'Refund request'
      WHEN 'overcharge'      THEN 'Overcharged'
      WHEN 'double_charge'   THEN 'Charged twice'
      WHEN 'driver_issue'    THEN 'Driver issue'
      WHEN 'driver_behavior' THEN 'Driver behaviour'
      WHEN 'rider_behavior'  THEN 'Rider behaviour'
      WHEN 'safety'          THEN 'Safety concern'
      WHEN 'lost_item'       THEN 'Lost item'
      WHEN 'account'         THEN 'Account'
      WHEN 'app_issue'       THEN 'App problem'
      ELSE 'Problem report'
    END;
  END IF;
  IF NEW.category = 'safety' AND (NEW.priority IS NULL OR NEW.priority = 'normal') THEN
    NEW.priority := 'urgent';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.support_ticket_defaults() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_ticket_defaults ON public.support_tickets;
CREATE TRIGGER trg_support_ticket_defaults
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.support_ticket_defaults();
