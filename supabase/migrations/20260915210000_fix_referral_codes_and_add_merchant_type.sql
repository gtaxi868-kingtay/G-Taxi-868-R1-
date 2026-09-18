-- ═══════════════════════════════════════════════════════════════════════════
-- Fix generate_referral_code (broken since it was written) + add a 'merchant'
-- referral type (2026-09-15)
--
-- WHAT WAS BROKEN
-- ---------------
-- generate_referral_code did `INSERT ... ON CONFLICT (user_id) DO NOTHING`,
-- but referral_codes.user_id has never had a unique constraint or index --
-- only a plain btree index. Every call throws 42P10 ("there is no unique or
-- exclusion constraint matching the ON CONFLICT specification"), confirmed
-- live in a rolled-back transaction. Confirmed via `select count(*) from
-- referral_codes` = 0: this has never once succeeded in production. Any
-- driver opening DriverReferralScreen.tsx for the first time has been
-- hitting a silent failure since this function was written.
--
-- referral_codes.type and referral_earnings.type also only allowed
-- ('driver','rider') -- no 'merchant', needed for the driver-refers-a-
-- merchant-friend feature this migration also unblocks.
--
-- WHAT THIS DOES
-- --------------
--   * Adds a real UNIQUE (user_id, type) constraint -- one code per user PER
--     TYPE, not one code per user total. A driver can hold a 'driver' code
--     (to refer other drivers) and a 'merchant' code (to refer a business-
--     owning friend) at the same time without colliding.
--   * Rewrites generate_referral_code to look up an existing (user_id, type)
--     code first and return it if found (idempotent, matches the function's
--     original intent), otherwise generates and inserts one against the new
--     constraint -- the ON CONFLICT target now actually exists.
--   * Widens referral_codes.type and referral_earnings.type CHECK
--     constraints to include 'merchant'. apply_referral_code() is already
--     generic per-type (confirmed by reading its live body) and needs no
--     change -- it looks up `referral_codes WHERE code = ... AND type = ...`
--     and credits both sides from wallet_transactions, independent of type.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. type CHECK constraints: drop and re-add per project convention (a CHECK
--    constraint rejects unknown values silently at the call site, so the
--    full list is dropped and re-added rather than altered in place).
-- ---------------------------------------------------------------------------
ALTER TABLE public.referral_codes DROP CONSTRAINT IF EXISTS referral_codes_type_check;
ALTER TABLE public.referral_codes ADD CONSTRAINT referral_codes_type_check
    CHECK (type = ANY (ARRAY['driver'::text, 'rider'::text, 'merchant'::text]));

ALTER TABLE public.referral_earnings DROP CONSTRAINT IF EXISTS referral_earnings_type_check;
ALTER TABLE public.referral_earnings ADD CONSTRAINT referral_earnings_type_check
    CHECK (type = ANY (ARRAY['driver'::text, 'rider'::text, 'merchant'::text]));

-- ---------------------------------------------------------------------------
-- 2. Real uniqueness the function can target. Table is empty in production
--    (verified via `select count(*) from referral_codes` = 0), so this adds
--    cleanly with no backfill needed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.referral_codes
    ADD CONSTRAINT referral_codes_user_id_type_key UNIQUE (user_id, type);

-- ---------------------------------------------------------------------------
-- 3. generate_referral_code -- idempotent lookup-then-insert against the
--    constraint that now actually exists. Same signature/return type/auth
--    check as before (unauthorized if caller's auth.uid() doesn't match
--    p_user_id, when there is a caller identity at all).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_referral_code(p_user_id uuid, p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_code     TEXT;
    v_attempts INT := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Idempotent: a user calling this again for a type they already have
    -- gets their existing code back, not an error or a second row.
    SELECT code INTO v_code FROM public.referral_codes
     WHERE user_id = p_user_id AND type = p_type;
    IF v_code IS NOT NULL THEN
        RETURN v_code;
    END IF;

    LOOP
        v_code := upper(substring(md5(p_user_id::text || p_type || clock_timestamp()::text) from 1 for 6));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = v_code);
        v_attempts := v_attempts + 1;
        IF v_attempts > 20 THEN
            RAISE EXCEPTION 'Could not generate unique code';
        END IF;
    END LOOP;

    INSERT INTO public.referral_codes (user_id, code, type)
    VALUES (p_user_id, v_code, p_type)
    ON CONFLICT (user_id, type) DO NOTHING;

    -- Re-select rather than trust v_code directly: if a concurrent call won
    -- the race and inserted first, ON CONFLICT DO NOTHING means our v_code
    -- was never stored -- returning it would hand back a code that redeems
    -- nothing. The existing row (whoever inserted it) is always correct.
    SELECT code INTO v_code FROM public.referral_codes
     WHERE user_id = p_user_id AND type = p_type;

    RETURN v_code;
END;
$function$;
