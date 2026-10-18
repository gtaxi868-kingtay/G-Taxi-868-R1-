-- ═══════════════════════════════════════════════════════════════════
-- A G-Partner shop is pinned on the map the moment its tag is registered
-- (founder rule, 2026-10-18).
--
-- "Registered" = a kiosk_nodes row (the counter puck) that has a real tag
-- (tag_uid), is linked to the shop (merchant_id), and is live
-- (is_active and provision_status 'active'). Nodes reach that state through
-- several paths (admin_review_node approval, the admin edge function's node
-- actions, commander_gateway), so the rule lives in one trigger on
-- kiosk_nodes and fires only on the TRANSITION into that state.
--
-- On that transition, for the linked shop:
--   1. merchants.is_pinned = true (what the rider map and
--      nearest_verified_pin read).
--   2. If the shop has no map location yet, it takes the tag's location
--      (lat/lng, and pickup_address as address). New shops are created
--      with no location and no screen lets them set one, which is also why
--      "Send a car" failed for them.
--   3. The free pin period starts now: the site promises "90 days pinned on
--      the map, free". merchant_subscriptions.trial_end_at defaulted to 90
--      days after the shop ACCOUNT was created, so a shop could use up its
--      free pin months before it had a tag. For a shop still in 'trial', the
--      end becomes at least 90 days from now (never shortened). A shop that
--      is already paying ('active') or overdue/suspended is not touched.
--   4. merchants.pinned_since records the first time, so re-registering or
--      replacing a tag never restarts the free period.
--
-- Unpinning is unchanged (admin_set_merchant_billing / pin-fee billing).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS pinned_since timestamptz;

CREATE OR REPLACE FUNCTION public.pin_merchant_on_tag_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now_registered boolean;
  v_was_registered boolean := false;
  v_first_pin boolean;
BEGIN
  v_now_registered := NEW.merchant_id IS NOT NULL
                      AND NULLIF(trim(NEW.tag_uid), '') IS NOT NULL
                      AND COALESCE(NEW.is_active, false)
                      AND COALESCE(NEW.provision_status, 'active') = 'active';
  IF NOT v_now_registered THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_was_registered := OLD.merchant_id IS NOT DISTINCT FROM NEW.merchant_id
                        AND NULLIF(trim(OLD.tag_uid), '') IS NOT NULL
                        AND COALESCE(OLD.is_active, false)
                        AND COALESCE(OLD.provision_status, 'active') = 'active';
  END IF;
  IF v_was_registered THEN
    RETURN NEW;   -- already registered for this shop: nothing changes
  END IF;

  SELECT pinned_since IS NULL INTO v_first_pin FROM public.merchants WHERE id = NEW.merchant_id;

  UPDATE public.merchants
     SET is_pinned    = true,
         pinned_since = COALESCE(pinned_since, now()),
         lat          = COALESCE(lat, NEW.lat),
         lng          = COALESCE(lng, NEW.lng),
         address      = COALESCE(NULLIF(address, ''), NEW.pickup_address)
   WHERE id = NEW.merchant_id;

  IF COALESCE(v_first_pin, false) THEN
    UPDATE public.merchant_subscriptions
       SET trial_start_at = now(),
           trial_end_at   = GREATEST(COALESCE(trial_end_at, now()), now() + interval '90 days')
     WHERE merchant_id = NEW.merchant_id
       AND status = 'trial';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.pin_merchant_on_tag_registration() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pin_merchant_on_tag_registration ON public.kiosk_nodes;
CREATE TRIGGER trg_pin_merchant_on_tag_registration
  AFTER INSERT OR UPDATE OF merchant_id, tag_uid, is_active, provision_status ON public.kiosk_nodes
  FOR EACH ROW EXECUTE FUNCTION public.pin_merchant_on_tag_registration();
