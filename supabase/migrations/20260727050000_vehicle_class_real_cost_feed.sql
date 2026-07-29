-- ═══════════════════════════════════════════════════════════════════
-- VEHICLE CLASSES: REAL LANDED-COST FEED (2026-07-27)
--
-- Confirmed real gap: vehicle_classes (the table G Garage's requested
-- vehicle_class_key points at) has NEVER had a cost column — only a
-- fare multiplier and a min_fare_cents. Admin's own editor
-- (apps/admin/src/pages/Pricing.tsx) has no cost input either. That
-- means every G Garage approval has been happening with zero visibility
-- into whether the vehicle being financed is anywhere close to paying
-- for itself — the exact blind spot the original plan's profit-math
-- section flagged and then never got wired into the actual approval
-- screen.
--
-- This does NOT invent a live market-data feed — no such feed exists
-- for car dealer pricing (unlike flights/hotels, there is no API for
-- "what does a BYD Sealion 7 cost right now"). What it does: gives
-- admin a real place to enter a real quote (from ATL Automotive, a
-- customs broker's FOB estimate, etc.) once they have one, with a
-- source + date so the number is never mistaken for something live or
-- automatic — and surfaces a real payback estimate against it wherever
-- a G Garage request references that vehicle class.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.vehicle_classes
    ADD COLUMN IF NOT EXISTS landed_cost_cents bigint CHECK (landed_cost_cents IS NULL OR landed_cost_cents >= 0),
    ADD COLUMN IF NOT EXISTS cost_source text,
    ADD COLUMN IF NOT EXISTS cost_updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS cost_notes text;

COMMENT ON COLUMN public.vehicle_classes.landed_cost_cents IS
    'Real quoted landed cost (vehicle + freight/duty/registration where applicable) in TTD cents. NULL means no real quote has been entered yet — never defaulted to a guess.';
COMMENT ON COLUMN public.vehicle_classes.cost_source IS
    'Where this number came from, e.g. "ATL Automotive fleet quote" or "FOB China + freight estimate, customs broker call 2026-08-01". Required context, not decoration.';

-- Adding new trailing params to a SECURITY DEFINER function creates a
-- second overload rather than replacing it (Postgres keys functions by
-- full signature) — drop the old 9-arg version first, same lesson
-- learned earlier this session with get_nearby_merchants, so there is
-- exactly one admin_set_vehicle_class, not two ambiguous ones.
DROP FUNCTION IF EXISTS public.admin_set_vehicle_class(text, text, text, text, integer, text, boolean, integer, integer);

CREATE FUNCTION public.admin_set_vehicle_class(
    p_key             text,
    p_label           text    DEFAULT NULL,
    p_description     text    DEFAULT NULL,
    p_icon            text    DEFAULT NULL,
    p_multiplier_x100 integer DEFAULT NULL,
    p_category        text    DEFAULT NULL,
    p_is_active       boolean DEFAULT NULL,
    p_sort_order      integer DEFAULT NULL,
    p_min_fare_cents  integer DEFAULT NULL,
    p_landed_cost_cents bigint DEFAULT NULL,
    p_cost_source     text    DEFAULT NULL,
    p_cost_notes      text    DEFAULT NULL
)
RETURNS public.vehicle_classes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_row public.vehicle_classes;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
        RAISE EXCEPTION 'key required';
    END IF;
    IF p_landed_cost_cents IS NOT NULL AND (p_cost_source IS NULL OR length(trim(p_cost_source)) = 0) THEN
        RAISE EXCEPTION 'cost_source is required whenever a landed cost is entered — a number with no stated source is exactly the kind of guess this column exists to prevent';
    END IF;

    INSERT INTO public.vehicle_classes AS vc
        (key, label, description, icon, multiplier_x100, category, is_active, sort_order, min_fare_cents,
         landed_cost_cents, cost_source, cost_notes, cost_updated_at)
    VALUES (
        lower(trim(p_key)),
        COALESCE(p_label, initcap(p_key)),
        p_description,
        COALESCE(p_icon, 'car-outline'),
        COALESCE(p_multiplier_x100, 100),
        COALESCE(p_category, 'passenger'),
        COALESCE(p_is_active, false),
        COALESCE(p_sort_order, 100),
        p_min_fare_cents,
        p_landed_cost_cents,
        p_cost_source,
        p_cost_notes,
        CASE WHEN p_landed_cost_cents IS NOT NULL THEN now() ELSE NULL END
    )
    ON CONFLICT (key) DO UPDATE SET
        label           = COALESCE(p_label, vc.label),
        description     = COALESCE(p_description, vc.description),
        icon            = COALESCE(p_icon, vc.icon),
        multiplier_x100 = COALESCE(p_multiplier_x100, vc.multiplier_x100),
        category        = COALESCE(p_category, vc.category),
        is_active       = COALESCE(p_is_active, vc.is_active),
        sort_order      = COALESCE(p_sort_order, vc.sort_order),
        min_fare_cents  = COALESCE(p_min_fare_cents, vc.min_fare_cents),
        landed_cost_cents = COALESCE(p_landed_cost_cents, vc.landed_cost_cents),
        cost_source     = COALESCE(p_cost_source, vc.cost_source),
        cost_notes      = COALESCE(p_cost_notes, vc.cost_notes),
        cost_updated_at = CASE WHEN p_landed_cost_cents IS NOT NULL THEN now() ELSE vc.cost_updated_at END,
        updated_at      = now()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_vehicle_class(text, text, text, text, integer, text, boolean, integer, integer, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_vehicle_class(text, text, text, text, integer, text, boolean, integer, integer, bigint, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
