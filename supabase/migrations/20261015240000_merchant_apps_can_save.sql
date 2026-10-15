-- ═══════════════════════════════════════════════════════════════════
-- Merchant apps: let merchants save their own business data (and only that).
--
-- Before (verified live 2026-10-15): the RLS policies for merchants were
-- already correctly scoped to their own business (auth_merchant_ids() /
-- merchants.created_by), but `authenticated` only had SELECT on these
-- tables, so every save in the merchant apps failed with "permission
-- denied": add/edit/delete products, add/toggle/remove staff, approve or
-- decline appointments. Separately:
--   - merchant_staff has no `role` column, but the staff screen writes and
--     reads one, so adding staff and loading the list both failed.
--   - travel_properties had no policy for merchants at all.
--   - order_items: merchants could UPDATE every column (incl. unit_price_cents
--     and quantity after the customer paid); the only app write is
--     picking_status. Narrowed.
--
-- Grants are column-limited to what the apps actually write; the existing
-- (unchanged) policies decide WHICH rows.
-- ═══════════════════════════════════════════════════════════════════

-- Products: own merchant's (owner or staff) via merchants_manage_own_products.
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;

-- Staff: owner only, via "Merchant owner manages staff".
ALTER TABLE public.merchant_staff
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'staff';
-- The staff screen invites by name/phone; the person may not have a G-Taxi
-- login yet. user_id NULL = invited, not yet linked (auth_merchant_ids()
-- ignores NULLs, so an unlinked row grants nobody access). NOTE: there is no
-- flow yet that links an invite to a login.
ALTER TABLE public.merchant_staff ALTER COLUMN user_id DROP NOT NULL;
GRANT INSERT (merchant_id, name, role, phone, is_active) ON public.merchant_staff TO authenticated;
GRANT UPDATE (name, role, phone, is_active) ON public.merchant_staff TO authenticated;
GRANT DELETE ON public.merchant_staff TO authenticated;

-- Appointments: merchant approves/declines, via
-- "Merchants manage appointments for their business".
GRANT UPDATE (status, merchant_consent_status) ON public.merchant_appointments TO authenticated;

-- Travel properties (Escape lodging): owner/staff of the property's merchant.
DROP POLICY IF EXISTS "Merchants manage their own properties" ON public.travel_properties;
CREATE POLICY "Merchants manage their own properties"
  ON public.travel_properties
  FOR ALL
  TO authenticated
  USING (merchant_id IN (SELECT public.auth_merchant_ids()))
  WITH CHECK (merchant_id IN (SELECT public.auth_merchant_ids()));
GRANT INSERT (merchant_id, name, destination_code, destination_name, address, stars,
              room_types, cover_image_url, amenities, ical_urls, is_active, sync_status)
  ON public.travel_properties TO authenticated;
GRANT UPDATE (name, address, stars, room_types, cover_image_url, amenities,
              ical_urls, is_active, sync_status)
  ON public.travel_properties TO authenticated;

-- Order lines: merchants may only mark picking (no price/quantity edits).
REVOKE UPDATE ON public.order_items FROM authenticated;
GRANT UPDATE (picking_status, photo_url, substituted_with_id) ON public.order_items TO authenticated;
