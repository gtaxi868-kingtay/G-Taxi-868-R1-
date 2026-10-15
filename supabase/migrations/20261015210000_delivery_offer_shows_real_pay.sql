-- ═══════════════════════════════════════════════════════════════════
-- Delivery offers carry the driver's real pay.
--
-- Before (verified live 2026-10-15): both places that create delivery
-- offers (process_dispatch_queue, merchant) insert only order/driver/status/
-- expiry. delivery_offers.delivery_fee_cents was always NULL, so the driver
-- app fell back to an order lookup that asks for merchants.business_name
-- (no such column) and failed, and the offer showed "TT$?". Even with a fee,
-- the app showed a made-up 82% of it, while drivers are actually paid by
-- calculate_delivery_driver_payout (base + per-km) in both
-- process_order_delivery_payment and process_cash_delivery_settlement.
--
-- After: a BEFORE INSERT trigger fills, from the same function that pays:
--   driver_payout_cents  (new) what this driver will be paid
--   delivery_fee_cents          the order's delivery fee (for reference)
-- No edge function needs redeploying.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.delivery_offers
  ADD COLUMN IF NOT EXISTS driver_payout_cents integer;

CREATE OR REPLACE FUNCTION public.fill_delivery_offer_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.driver_payout_cents IS NULL THEN
    SELECT payout_cents INTO NEW.driver_payout_cents
      FROM public.calculate_delivery_driver_payout(NEW.order_id);
  END IF;
  IF NEW.delivery_fee_cents IS NULL THEN
    SELECT delivery_fee_cents INTO NEW.delivery_fee_cents
      FROM public.orders WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fill_delivery_offer_payout() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fill_delivery_offer_payout ON public.delivery_offers;
CREATE TRIGGER trg_fill_delivery_offer_payout
  BEFORE INSERT ON public.delivery_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_delivery_offer_payout();
