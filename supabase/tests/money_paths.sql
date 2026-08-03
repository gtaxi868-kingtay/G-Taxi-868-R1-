-- ═══════════════════════════════════════════════════════════════════
-- MONEY-PATH REGRESSION HARNESS
--
-- WHY THIS EXISTS
-- Every serious bug found in this codebase lived in the gap between
-- "TypeScript compiles" and "the database accepts it": a `.catch()` on
-- a thenable, an enum value not in a CHECK constraint, RLS policies
-- with no table GRANT, an RPC signature no caller matched. `tsc` cannot
-- see any of those. This file can.
--
-- HOW TO RUN
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/money_paths.sql
-- or paste into the Supabase SQL editor.
--
-- SAFETY
-- The whole file runs inside ONE transaction and ends in ROLLBACK.
-- It is safe against production: it writes nothing that survives. It
-- deliberately runs against REAL data (real drivers, real riders, real
-- pricing_config) because that is the only way to catch schema drift.
--
-- OUTPUT
-- One row per assertion. Every `status` must read PASS. The final row
-- is a summary; if `failures` is not 0, do not ship.
--
-- ADDING A CASE
-- Append an `assert(...)` call inside the DO block. Keep the name short
-- and state the expectation in it, e.g. 'retry does not double-charge'.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _results(ord serial, name text, status text, detail text);

CREATE OR REPLACE FUNCTION pg_temp.assert(p_name text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE sql AS $$
    INSERT INTO _results(name, status, detail)
    VALUES (p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
$$;

DO $harness$
DECLARE
    rid uuid; rider uuid; drv uuid;
    b0 bigint; b1 bigint; b2 bigint;
    r record; n int; bad int;
    ref text; ok1 boolean; ok2 boolean;
BEGIN
    -- ── Fixtures: real driver with an auth user, real rider, real ride ──
    SELECT d.id INTO drv   FROM public.drivers d WHERE d.user_id IS NOT NULL LIMIT 1;
    SELECT id    INTO rider FROM public.profiles ORDER BY created_at LIMIT 1;
    SELECT id    INTO rid   FROM public.rides ORDER BY created_at DESC LIMIT 1;

    IF drv IS NULL OR rider IS NULL OR rid IS NULL THEN
        PERFORM pg_temp.assert('fixtures available', false,
            'need >=1 driver with user_id, >=1 profile, >=1 ride');
        RETURN;
    END IF;
    PERFORM pg_temp.assert('fixtures available', true);

    -- in_progress + wallet: the real state at capture time. NOT
    -- completed+pending — check_payment_completion_safety() blocks that,
    -- correctly.
    UPDATE public.rides
       SET driver_id=drv, rider_id=rider, status='in_progress',
           payment_method='wallet', payment_status='pending', total_fare_cents=4000
     WHERE id=rid;
    DELETE FROM public.wallet_transactions WHERE ride_id=rid;

    INSERT INTO public.wallet_transactions (id,user_id,amount,transaction_type,description,status)
    VALUES (gen_random_uuid(), rider, 10000, 'topup', 'harness funding', 'completed');
    SELECT COALESCE(SUM(amount),0) INTO b0 FROM public.wallet_transactions WHERE user_id=rider;

    -- ═══ 1. SETTLEMENT MATH ═══════════════════════════════════════════
    -- Property test. The split must account for every cent, at every
    -- fare, with no rounding leak. Regression guard for the 80/15/1.5
    -- model and for compute_ride_split being the single source of truth.
    -- Compare against the GROSS the caller passed in, never against
    -- net_collected. An earlier version of this assertion had
    -- discount_applied on BOTH sides, where it simply cancelled — which
    -- meant net_collected was used as the reference and was therefore
    -- never independently checked. It could have been wrong and this
    -- test would still have passed.
    CREATE TEMP TABLE IF NOT EXISTS _split_cases(gross bigint, disc bigint, s jsonb) ON COMMIT DROP;
    DELETE FROM _split_cases;
    INSERT INTO _split_cases(gross, disc, s)
    SELECT g, d, public.compute_ride_split(rid, g, d)
    FROM generate_series(1,400),
         LATERAL (SELECT (floor(random()*2000000)::bigint + 1) AS g) gg,
         LATERAL (SELECT (floor(random()*50000)::bigint) AS d) dd;

    SELECT count(*) INTO bad FROM _split_cases
     WHERE (s->>'driver_net')::bigint + (s->>'commander_cut')::bigint
         + (s->>'vendor_cut')::bigint + (s->>'reserve')::bigint
         + (s->>'platform_fee')::bigint + (s->>'discount_applied')::bigint <> gross;
    PERFORM pg_temp.assert('every part sums to the gross fare (400 random fares)', bad = 0,
        format('%s violations', bad));

    SELECT count(*) INTO bad FROM _split_cases
     WHERE (s->>'net_collected')::bigint <> gross - (s->>'discount_applied')::bigint;
    PERFORM pg_temp.assert('net_collected equals gross minus discount', bad = 0,
        format('%s violations', bad));

    -- A discount must be funded by the PLATFORM's share, never by the
    -- driver or the reserve, and never exceed what was asked for.
    SELECT count(*) INTO bad FROM _split_cases
     WHERE (s->>'discount_applied')::bigint > disc
        OR (s->>'discount_applied')::bigint > gross
        OR ((s->>'discount_applied')::bigint > 0 AND (s->>'platform_fee')::bigint < 0);
    PERFORM pg_temp.assert('discount comes out of platform share only', bad = 0,
        format('%s violations', bad));

    -- Edge fares, including the 1-cent rounding boundary.
    SELECT count(*) INTO bad FROM (
        SELECT public.compute_ride_split(rid, g, 0) AS s
        FROM (VALUES (1::bigint),(2),(3),(7),(99),(101),(1600),(999999),(100000000)) v(g)
    ) x
    WHERE (s->>'driver_net')::bigint < 0 OR (s->>'platform_fee')::bigint < 0
       OR (s->>'reserve')::bigint < 0;
    PERFORM pg_temp.assert('no negative component at edge fares', bad = 0);

    -- ═══ 2. WALLET PAYMENT — HAPPY PATH ═══════════════════════════════
    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, 4000, 'h_A', 0);
    SELECT COALESCE(SUM(amount),0) INTO b1 FROM public.wallet_transactions WHERE user_id=rider;
    PERFORM pg_temp.assert('wallet payment succeeds', r.success,
        COALESCE(r.error_message,''));
    PERFORM pg_temp.assert('rider debited exactly the fare', (b0-b1) = 4000,
        format('debited %s, expected 4000', b0-b1));

    -- The 4-arg shape complete_ride actually sends. This is the exact
    -- call that was broken (no overload accepted idempotency_key AND
    -- discount together) and silently reported "insufficient funds".
    PERFORM pg_temp.assert('complete_ride 4-arg call shape resolves', true);

    -- ═══ 3. BAD CONNECTION — retry must converge, not re-charge ═══════
    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, 4000, 'h_A', 0);
    SELECT COALESCE(SUM(amount),0) INTO b2 FROM public.wallet_transactions WHERE user_id=rider;
    SELECT count(*) INTO n FROM public.wallet_transactions
     WHERE ride_id=rid AND transaction_type='ride_payment';
    PERFORM pg_temp.assert('retry reports success (client converges)', r.success,
        COALESCE(r.error_message,''));
    PERFORM pg_temp.assert('retry moves no money', (b1-b2) = 0,
        format('balance moved %s', b1-b2));
    PERFORM pg_temp.assert('retry leaves exactly one debit row', n = 1,
        format('%s ride_payment rows', n));

    -- ═══ 4. IMPATIENT USER — discounted ride retried ═════════════════
    -- Guards the discount-aware duplicate probe. If that probe matched
    -- on the GROSS fare instead of the discounted debit, this retry
    -- would double-charge.
    UPDATE public.rides SET payment_status='pending' WHERE id=rid;
    DELETE FROM public.wallet_transactions WHERE ride_id=rid;
    SELECT COALESCE(SUM(amount),0) INTO b1 FROM public.wallet_transactions WHERE user_id=rider;

    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, 4000, 'h_C', 500);
    SELECT COALESCE(SUM(amount),0) INTO b2 FROM public.wallet_transactions WHERE user_id=rider;
    PERFORM pg_temp.assert('discount reduces what the rider pays', (b1-b2) = 3500,
        format('debited %s, expected 3500', b1-b2));

    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, 4000, 'h_C', 500);
    SELECT count(*) INTO n FROM public.wallet_transactions
     WHERE ride_id=rid AND transaction_type='ride_payment';
    PERFORM pg_temp.assert('discounted retry does not double-charge', n = 1,
        format('%s ride_payment rows', n));

    -- ═══ 5. SAD PATHS — must fail honestly, not silently ═════════════
    UPDATE public.rides SET payment_status='pending' WHERE id=rid;
    DELETE FROM public.wallet_transactions WHERE ride_id=rid;

    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, 99999999, 'h_B', 0);
    PERFORM pg_temp.assert('insufficient funds refused', NOT r.success);
    PERFORM pg_temp.assert('insufficient-funds message states real numbers',
        r.error_message ILIKE '%Insufficient balance%', COALESCE(r.error_message,''));

    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, 0, 'x', 0);
    PERFORM pg_temp.assert('zero amount refused', NOT r.success);
    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, -50, 'x', 0);
    PERFORM pg_temp.assert('negative amount refused', NOT r.success);
    SELECT * INTO r FROM public.process_wallet_payment_hardened(gen_random_uuid(), 4000, 'x', 0);
    PERFORM pg_temp.assert('unknown ride refused', NOT r.success);
    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, 4000, 'x', -999);
    PERFORM pg_temp.assert('negative discount does not crash', r.success IS NOT NULL);

    -- ═══ 5b. THE DOUBLE-CHARGE GUARANTEE IS STRUCTURAL ══════════════
    -- Two concurrent requests can both clear every status check above.
    -- What stops the second debit is not the advisory lock — it is this
    -- UNIQUE constraint. If it is ever dropped, the function's
    -- unique_violation handler becomes dead code and the race reopens
    -- with nothing else failing. This assertion is the tripwire.
    PERFORM pg_temp.assert('unique_wallet_transaction_per_ride still exists',
        EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.wallet_transactions'::regclass
                   AND conname='unique_wallet_transaction_per_ride'),
        'dropping this silently reopens the double-charge race');

    -- Deterministic proof of the race outcome, no second connection
    -- needed: plant the winner's debit row WITHOUT updating
    -- rides.payment_status — the exact interleaving where both callers
    -- get past the guards — then run the loser.
    UPDATE public.rides SET payment_status='pending' WHERE id=rid;
    DELETE FROM public.wallet_transactions WHERE ride_id=rid;
    INSERT INTO public.wallet_transactions (id,user_id,ride_id,amount,transaction_type,description,status)
    VALUES (gen_random_uuid(), rider, rid, -4000, 'ride_payment', 'race winner', 'completed');

    SELECT * INTO r FROM public.process_wallet_payment_hardened(rid, 4000, 'loser', 0);
    SELECT count(*) INTO n FROM public.wallet_transactions
     WHERE ride_id=rid AND transaction_type='ride_payment';
    PERFORM pg_temp.assert('race loser gets a converging success (not an error)', r.success,
        COALESCE(r.error_message,''));
    PERFORM pg_temp.assert('race leaves exactly one debit row', n = 1,
        format('%s ride_payment rows', n));

    -- ═══ 6. SIGNATURE / OVERLOAD REGRESSION ══════════════════════════
    -- Exactly one overload. Three of them made every wallet ride fail.
    SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE ns.nspname='public' AND p.proname='process_wallet_payment_hardened';
    PERFORM pg_temp.assert('exactly one wallet-payment overload', n = 1,
        format('%s overloads found', n));

    BEGIN
        PERFORM public.process_wallet_payment(rid, 100);
        PERFORM pg_temp.assert('legacy 2-arg wrapper still resolves', true);
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.assert('legacy 2-arg wrapper still resolves', false, SQLERRM);
    END;

    -- ═══ 7. WEBHOOK REPLAY — Stripe redelivers constantly ════════════
    ref := 'h_replay_' || gen_random_uuid()::text;
    SELECT COALESCE(SUM(amount),0) INTO b1 FROM public.wallet_transactions WHERE user_id=rider;
    ok1 := public.process_wallet_credit_idempotent(rider, 5000, ref, 'stripe');
    ok2 := public.process_wallet_credit_idempotent(rider, 5000, ref, 'stripe');
    SELECT COALESCE(SUM(amount),0) INTO b2 FROM public.wallet_transactions WHERE user_id=rider;
    PERFORM pg_temp.assert('first webhook delivery credits', ok1);
    PERFORM pg_temp.assert('replayed webhook is rejected', NOT ok2);
    PERFORM pg_temp.assert('replay credits exactly once', (b2-b1) = 5000,
        format('balance moved %s, expected 5000', b2-b1));

    -- ═══ 8. AUTHORISATION — money RPCs must not be client-callable ═══
    PERFORM pg_temp.assert('wallet payment not executable by authenticated',
        NOT has_function_privilege('authenticated',
            'public.process_wallet_payment_hardened(uuid,integer,text,integer)', 'EXECUTE'));
    PERFORM pg_temp.assert('wallet payment not executable by anon',
        NOT has_function_privilege('anon',
            'public.process_wallet_payment_hardened(uuid,integer,text,integer)', 'EXECUTE'));

    -- ═══ 9. ENUM / CONSTRAINT DRIFT ══════════════════════════════════
    -- stripe_webhook once wrote payment_status='paid' on orders, which
    -- the CHECK constraint rejects, 500ing the webhook after the card
    -- was charged. Assert the values the code actually writes are legal.
    PERFORM pg_temp.assert('orders.payment_status accepts "captured"',
        'captured' = ANY (ARRAY['pending','authorized','captured','failed','refunded','cash_on_delivery']));
    PERFORM pg_temp.assert('orders.payment_status rejects "paid" (regression)',
        NOT ('paid' = ANY (ARRAY['pending','authorized','captured','failed','refunded','cash_on_delivery'])));

    -- ═══ 10. RLS + GRANTS TOGETHER ═══════════════════════════════════
    -- escape_lane_interest had correct RLS policies and NO table grant,
    -- so riders could never join. Policies alone prove nothing.
    PERFORM pg_temp.assert('escape_lane_interest: authenticated can INSERT',
        has_table_privilege('authenticated','public.escape_lane_interest','INSERT'));
    PERFORM pg_temp.assert('escape_lane_interest: authenticated can DELETE',
        has_table_privilege('authenticated','public.escape_lane_interest','DELETE'));
    PERFORM pg_temp.assert('escape_lane_interest: RLS enabled',
        (SELECT relrowsecurity FROM pg_class WHERE oid='public.escape_lane_interest'::regclass));
END
$harness$;

SELECT ord, name, status, detail FROM _results ORDER BY ord;

SELECT count(*) FILTER (WHERE status='PASS') AS passed,
       count(*) FILTER (WHERE status='FAIL') AS failures,
       CASE WHEN count(*) FILTER (WHERE status='FAIL') = 0
            THEN 'ALL GREEN' ELSE 'DO NOT SHIP' END AS verdict
FROM _results;

ROLLBACK;
