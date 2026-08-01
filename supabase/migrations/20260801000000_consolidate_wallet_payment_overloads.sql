-- ═══════════════════════════════════════════════════════════════════
-- WALLET PAYMENT: ONE FUNCTION, NOT THREE (2026-08-01)   ** P0 **
--
-- THE BUG: wallet ride completion was impossible in production.
--
-- Three overloads of process_wallet_payment_hardened were live:
--     (p_ride_id uuid, p_amount integer)                              -> jsonb
--     (p_ride_id uuid, p_amount integer, p_discount_cents integer)    -> jsonb
--     (p_ride_id uuid, p_amount integer, p_idempotency_key text)      -> TABLE(...)
--
-- complete_ride/index.ts:447 calls it with FOUR named arguments —
-- p_ride_id, p_amount, p_idempotency_key AND p_discount_cents. No
-- overload accepts both of the latter two, so the call failed with:
--
--     function public.process_wallet_payment_hardened(
--       p_ride_id => uuid, p_amount => integer,
--       p_idempotency_key => unknown, p_discount_cents => integer)
--     does not exist
--
-- complete_ride caught that and returned HTTP 402 "Payment failed:
-- Insufficient wallet funds" — so every wallet ride failed to complete
-- and the rider was told their wallet was empty WHEN IT WAS FULL.
-- Verified live by invoking the exact call. It failed closed (no money
-- lost, no free rides), but wallet is one of only two working payment
-- methods, so this removed half the remaining payment surface.
--
-- Second defect, same root cause: the legacy wrapper
-- process_wallet_payment(uuid,integer) calls the 2-arg form internally.
-- With two 3-arg overloads that both have DEFAULTs, a 2-arg call is
-- ambiguous and Postgres refuses:
--     function public.process_wallet_payment_hardened(uuid, integer)
--     is not unique
--
-- THE FIX: collapse to exactly ONE function whose signature is a
-- superset of every real call site. Because the two extra parameters
-- have defaults, the 2-arg and 3-arg call styles still resolve — and
-- resolve UNAMBIGUOUSLY, which also repairs the legacy wrapper.
--
-- The body is the hardened (…,text) version — the one with advisory
-- locking, duplicate handling, state repair and the driver-identity fix
-- — with discount support merged in from the (…,integer) version. The
-- discount variant was NOT used as the base: it lacks the
-- unique_violation duplicate handling that makes retries safe.
--
-- CORRECTNESS NOTE (do not "simplify" this away): the duplicate-detect
-- probe matches on `amount = -v_actual_debit`, NOT `-p_amount`. On a
-- discounted ride the rider is debited the discounted amount, so
-- probing for -p_amount would never match its own earlier row and a
-- retry would double-charge. This is the one line where copying the
-- old body verbatim would have introduced a real money bug.
--
-- DESIGNED FOR BAD CONNECTIONS AND IMPATIENT USERS — every one of
-- these is exercised by the harness in supabase/tests/:
--   * impatient double-tap, same instant  -> pg_try_advisory_xact_lock
--     on the ride returns "being processed by another request" rather
--     than attempting a second debit.
--     IMPORTANT: that lock is an OPTIMISATION, not the guarantee. The
--     guarantee is the UNIQUE constraint
--     unique_wallet_transaction_per_ride (user_id, ride_id,
--     transaction_type) on wallet_transactions. Even if two requests
--     both clear every status check, the second INSERT is rejected by
--     the database itself and the unique_violation handler below turns
--     that into a converging success. Proven 2026-08-01, deterministically
--     and without needing two connections: inserting a second
--     ride_payment row for one ride is refused, and a caller arriving
--     after the winner receives success=true / "Payment already
--     processed (state repaired)" with the debit-row count still 1.
--     Do not drop that constraint — see its COMMENT.
--   * client retried after a dropped response -> payment_status already
--     'captured' returns success TRUE (not an error) so the caller
--     converges instead of showing a false failure
--   * retry that lands before rides.payment_status was updated ->
--     the ride_payment ledger probe repairs the state and returns TRUE
--   * two requests race past both probes -> unique_violation on the
--     idempotency key is caught and treated as an already-processed
--     success
--   * genuinely insufficient funds -> FALSE with the real numbers, and
--     it is checked against the DISCOUNTED debit, not the gross fare
--   * anything unexpected -> FALSE + SQLERRM, never a partial write,
--     because the whole function is one transaction
-- ═══════════════════════════════════════════════════════════════════

-- Drop all three. A plain CREATE OR REPLACE cannot remove an overload,
-- and leaving any of them alive re-creates the ambiguity this fixes.
DROP FUNCTION IF EXISTS public.process_wallet_payment_hardened(uuid, integer);
DROP FUNCTION IF EXISTS public.process_wallet_payment_hardened(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.process_wallet_payment_hardened(uuid, integer, text);

CREATE FUNCTION public.process_wallet_payment_hardened(
    p_ride_id         uuid,
    p_amount          integer,
    p_idempotency_key text    DEFAULT NULL,
    p_discount_cents  integer DEFAULT 0
)
RETURNS TABLE(success boolean, error_message text, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_rider_id         UUID;
    v_driver_id        UUID;
    v_driver_uid       UUID;
    v_platform_id      UUID := '00000000-0000-0000-0000-000000000000';
    v_payment_status   TEXT;
    v_ride_status      TEXT;
    v_balance          INTEGER;
    v_advisory_lock_id BIGINT;
    v_txn_id           UUID := gen_random_uuid();
    v_split            jsonb;
    v_driver_net       INTEGER;
    v_platform_fee     INTEGER;
    v_reserve          INTEGER;
    v_discount_applied INTEGER;
    v_actual_debit     INTEGER;
BEGIN
    -- ── Input validation ────────────────────────────────────────────
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT FALSE, 'Invalid amount: must be positive', NULL::UUID;
        RETURN;
    END IF;
    IF p_ride_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Ride ID is required', NULL::UUID;
        RETURN;
    END IF;
    IF p_discount_cents IS NULL OR p_discount_cents < 0 THEN
        p_discount_cents := 0;
    END IF;

    -- ── Impatient user, double-tap: only one request per ride runs ──
    v_advisory_lock_id := ('x' || substr(md5(p_ride_id::text), 1, 16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_advisory_lock_id) THEN
        RETURN QUERY SELECT FALSE, 'Ride is being processed by another request', NULL::UUID;
        RETURN;
    END IF;

    SELECT r.rider_id, r.driver_id, r.payment_status, r.status
    INTO v_rider_id, v_driver_id, v_payment_status, v_ride_status
    FROM public.rides r WHERE r.id = p_ride_id FOR UPDATE;

    IF v_rider_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Ride not found', NULL::UUID;
        RETURN;
    END IF;
    IF v_driver_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Ride has no assigned driver', NULL::UUID;
        RETURN;
    END IF;
    IF v_ride_status NOT IN ('assigned', 'arrived', 'in_progress', 'completed') THEN
        RETURN QUERY SELECT FALSE, format('Cannot process payment for ride in %s status', v_ride_status), NULL::UUID;
        RETURN;
    END IF;

    -- ── Retry after a dropped response: converge, do not re-charge ──
    IF v_payment_status = 'captured' THEN
        RETURN QUERY SELECT TRUE, 'Payment already processed', v_txn_id;
        RETURN;
    END IF;

    -- ── Retry that landed before rides.payment_status was written ───
    IF EXISTS (
        SELECT 1 FROM public.wallet_transactions
        WHERE ride_id = p_ride_id AND transaction_type = 'ride_payment' AND amount < 0
    ) THEN
        UPDATE public.rides SET payment_status = 'captured', updated_at = NOW() WHERE id = p_ride_id;
        RETURN QUERY SELECT TRUE, 'Payment already processed (state repaired)', v_txn_id;
        RETURN;
    END IF;

    SELECT user_id INTO v_driver_uid FROM public.drivers WHERE id = v_driver_id;
    IF v_driver_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Driver account not found for settlement', NULL::UUID;
        RETURN;
    END IF;

    -- ── Split first: the discount decides what the rider actually pays
    v_split            := public.compute_ride_split(p_ride_id, p_amount, p_discount_cents);
    v_driver_net       := (v_split->>'driver_net')::integer;
    v_platform_fee     := (v_split->>'platform_fee')::integer;
    v_reserve          := (v_split->>'reserve')::integer;
    v_discount_applied := (v_split->>'discount_applied')::integer;
    v_actual_debit     := p_amount - v_discount_applied;

    -- ── Serialise per-rider so concurrent rides cannot overdraw ─────
    v_advisory_lock_id := ('x' || substr(md5(v_rider_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_advisory_lock_id);

    -- Balance is SUM(wallet_transactions) — the wallets.balance_cents
    -- cache is not maintained by every money path and must not be used.
    SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.wallet_transactions WHERE user_id = v_rider_id;

    IF v_balance < v_actual_debit THEN
        RETURN QUERY SELECT FALSE,
            format('Insufficient balance: %s cents available, %s cents required', v_balance, v_actual_debit),
            NULL::UUID;
        RETURN;
    END IF;

    -- ── Rider debit. reference_id carries the idempotency key. ──────
    BEGIN
        INSERT INTO public.wallet_transactions
            (id, user_id, ride_id, amount, transaction_type, description, status, reference_id)
        VALUES
            (gen_random_uuid(), v_rider_id, p_ride_id, -v_actual_debit, 'ride_payment',
             CASE WHEN v_discount_applied > 0
                  THEN format('Ride payment (wallet) — %s cents loyalty discount applied', v_discount_applied)
                  ELSE 'Ride payment (wallet)' END,
             'completed', p_idempotency_key);
    EXCEPTION
        WHEN unique_violation THEN
            -- Two requests raced past both probes. Match on the amount
            -- ACTUALLY debited (discount-aware) — see header note.
            IF EXISTS (SELECT 1 FROM public.wallet_transactions
                       WHERE ride_id = p_ride_id AND user_id = v_rider_id
                         AND transaction_type = 'ride_payment'
                         AND amount = -v_actual_debit) THEN
                UPDATE public.rides SET payment_status = 'captured', updated_at = NOW() WHERE id = p_ride_id;
                RETURN QUERY SELECT TRUE, 'Payment already processed (duplicate request)', v_txn_id;
                RETURN;
            ELSE
                RAISE;
            END IF;
    END;

    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_driver_uid, p_ride_id, v_driver_net, 'driver_payout',
         'Ride earnings (wallet)', 'completed');

    INSERT INTO public.wallet_transactions
        (id, user_id, ride_id, amount, transaction_type, description, status)
    VALUES
        (gen_random_uuid(), v_platform_id, p_ride_id, v_platform_fee, 'commission_fee',
         'Platform commission (wallet ride)', 'completed');

    IF v_reserve > 0 THEN
        PERFORM public.post_reserve_contribution(p_ride_id, v_reserve, 'ride');
    END IF;

    PERFORM public.record_ride_kickbacks(p_ride_id, v_rider_id, p_amount, v_split);

    INSERT INTO public.payment_ledger
        (id, ride_id, user_id, amount, currency, status, provider, metadata)
    VALUES
        (gen_random_uuid(), p_ride_id, v_rider_id, (v_actual_debit / 100.0), 'TTD',
         'captured', 'wallet',
         jsonb_build_object('idempotency_key', p_idempotency_key,
                            'discount_applied_cents', v_discount_applied));

    UPDATE public.rides
    SET payment_status      = 'captured',
        updated_at          = NOW(),
        total_fare_cents    = COALESCE(total_fare_cents, p_amount),
        driver_payout_cents = v_driver_net,
        platform_fee_cents  = v_platform_fee,
        reserve_cents       = v_reserve
    WHERE id = p_ride_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT, v_txn_id;

EXCEPTION
    WHEN OTHERS THEN
        -- One transaction: nothing above is left half-written.
        RETURN QUERY SELECT FALSE, SQLERRM, NULL::UUID;
END;
$function$;

-- DROP wipes grants; restore them. service_role only — this moves money
-- and must never be reachable from a browser client.
REVOKE ALL ON FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer) TO service_role;

COMMENT ON FUNCTION public.process_wallet_payment_hardened(uuid, integer, text, integer) IS
    'Canonical wallet ride payment. Replaced three ambiguous overloads on 2026-08-01 that made every wallet ride fail with a misleading "insufficient funds" error. Safe to retry: idempotent on payment_status, on the ride_payment ledger row, and on the idempotency key. Concurrent calls for one ride are rejected by advisory lock rather than double-charging.';

-- ── Legacy wrapper: it assigned the old jsonb return into a JSONB var ──
-- The canonical function returns TABLE(...), so that assignment now
-- fails with "invalid input syntax for type json". Caught by the dry
-- run, which is the only reason this is here.
--
-- Kept rather than dropped: no production code calls it, but
-- complete_ride/__tests__/capital_reserve_test.ts asserts it exists, and
-- silently deleting a function a test depends on trades one broken
-- thing for another.
CREATE OR REPLACE FUNCTION public.process_wallet_payment(p_ride_id uuid, p_amount integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_row record;
BEGIN
    SELECT * INTO v_row
    FROM public.process_wallet_payment_hardened(p_ride_id, p_amount);

    IF v_row.success THEN
        RETURN TRUE;
    ELSE
        RAISE WARNING 'Wallet payment failed for ride %: %', p_ride_id, v_row.error_message;
        RETURN FALSE;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.process_wallet_payment(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_wallet_payment(uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
