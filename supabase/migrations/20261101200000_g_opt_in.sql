-- Letting G learn someone. Riders could only read their AI preferences and drivers
-- had no access at all, so the opt-in switch could never save and G's memory could
-- never turn on. Both go through these checked functions. Identity comes from the
-- JWT, and turning it off also stops memory.

CREATE OR REPLACE FUNCTION public.g_opt_in_status(p_role text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_on boolean;
BEGIN
    IF p_role = 'driver' THEN
        SELECT ai_suggestions_enabled AND memory_enabled INTO v_on FROM public.driver_ai_preferences WHERE user_id = auth.uid();
    ELSIF p_role = 'rider' THEN
        SELECT ai_suggestions_enabled AND memory_enabled INTO v_on FROM public.rider_ai_preferences WHERE user_id = auth.uid();
    END IF;
    RETURN COALESCE(v_on, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.g_set_opt_in(p_role text, p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF auth.uid() IS NULL OR p_on IS NULL OR p_role NOT IN ('rider', 'driver') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
    IF p_role = 'driver' THEN
        IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE user_id = auth.uid()) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Not a driver');
        END IF;
        INSERT INTO public.driver_ai_preferences (user_id, ai_suggestions_enabled, memory_enabled)
        VALUES (auth.uid(), p_on, p_on)
        ON CONFLICT (user_id) DO UPDATE SET ai_suggestions_enabled = p_on, memory_enabled = p_on;
    ELSE
        INSERT INTO public.rider_ai_preferences (user_id, ai_suggestions_enabled, memory_enabled)
        VALUES (auth.uid(), p_on, p_on)
        ON CONFLICT (user_id) DO UPDATE SET ai_suggestions_enabled = p_on, memory_enabled = p_on;
    END IF;
    RETURN jsonb_build_object('success', true, 'on', p_on);
END;
$function$;

REVOKE ALL ON FUNCTION public.g_opt_in_status(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.g_set_opt_in(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.g_opt_in_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.g_set_opt_in(text, boolean) TO authenticated;
