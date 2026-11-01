-- Hotel (business) payouts on the founder's model (2026-10-26):
--   "hotels get their room money at their own rates PLUS the 1% lobby tap share".
--
-- ROOM MONEY: for each G-Escape reservation at the hotel's property, the
-- lodging cost locked into the package (escape_packages.lodging_cost_per_person_cents,
-- built from the hotel's own nightly rate) x guests. It becomes payable once
-- the stay is COMPLETED (guest checked out); see FORK in the commit message.
-- G's package margin is NOT touched here: the hotel is paid its own rate,
-- whatever the package sold for.
--
-- LOBBY SHARE: the 1% node commission compute_ride_split already credits to
-- the owner's wallet as wallet_transactions 'merchant_commission'. The payout
-- moves the unpaid commission out of the wallet, capped at the wallet balance
-- (subscription/pin-fee debits come first).
--
-- FLOW (no money moves without a human):
--   hotel: merchant_request_payout()  -> business_payouts 'requested' + items
--          + a g_proposed_actions row (approve_business_payout, category money)
--   admin approves in the G approvals inbox -> g_execute_action handler ->
--          business_payout_approve()  -> 'approved'
--   admin pays by bank transfer, then admin_mark_business_payout_paid(ref)
--          -> 'paid', and the lobby part is debited from the wallet ('payout').
--   rejected/expired proposal -> payout 'rejected', items released.
-- Each source item can be in at most one live payout (unique index).

CREATE TABLE IF NOT EXISTS public.business_payouts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id  uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
    requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'paid', 'rejected')),
    room_cents   integer NOT NULL DEFAULT 0 CHECK (room_cents >= 0),
    lobby_cents  integer NOT NULL DEFAULT 0 CHECK (lobby_cents >= 0),
    total_cents  integer GENERATED ALWAYS AS (room_cents + lobby_cents) STORED,
    proposal_id  uuid REFERENCES public.g_proposed_actions(id) ON DELETE SET NULL,
    decided_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    decided_at   timestamptz,
    reject_reason text,
    paid_reference text,
    paid_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
-- One open payout per business at a time.
CREATE UNIQUE INDEX IF NOT EXISTS business_payouts_one_open
    ON public.business_payouts (merchant_id) WHERE status IN ('requested', 'approved');

CREATE TABLE IF NOT EXISTS public.business_payout_items (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payout_id    uuid NOT NULL REFERENCES public.business_payouts(id) ON DELETE CASCADE,
    source_type  text NOT NULL CHECK (source_type IN ('room', 'lobby')),
    source_id    uuid NOT NULL,          -- package_reservations.id or wallet_transactions.id
    amount_cents integer NOT NULL CHECK (amount_cents > 0),
    UNIQUE (source_type, source_id)      -- never paid twice
);

ALTER TABLE public.business_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_payout_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_payouts, public.business_payout_items FROM anon, authenticated;
GRANT SELECT ON public.business_payouts, public.business_payout_items TO authenticated;
DROP POLICY IF EXISTS "Admin reads business payouts" ON public.business_payouts;
CREATE POLICY "Admin reads business payouts" ON public.business_payouts FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));
DROP POLICY IF EXISTS "Admin reads business payout items" ON public.business_payout_items;
CREATE POLICY "Admin reads business payout items" ON public.business_payout_items FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin'));

-- What a business is owed right now, item by item (not yet in a live payout).
CREATE OR REPLACE FUNCTION public._business_unpaid_items(p_merchant_id uuid)
RETURNS TABLE (source_type text, source_id uuid, amount_cents integer, label text, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    -- Rooms: completed stays at this business's properties.
    SELECT 'room'::text, pr.id,
           (ep.lodging_cost_per_person_cents * pr.guest_count)::integer,
           format('%s: %s guest(s), %s', ln.name, pr.guest_count, ep.package_name),
           COALESCE(pr.updated_at, pr.created_at)
      FROM public.package_reservations pr
      JOIN public.escape_packages ep ON ep.id = pr.escape_package_id
      JOIN public.lodging_nodes ln ON ln.id = ep.lodging_node_id
     WHERE ln.merchant_id = p_merchant_id
       AND pr.status = 'COMPLETED'
       AND ep.lodging_cost_per_person_cents > 0 AND pr.guest_count > 0
       AND NOT EXISTS (SELECT 1 FROM public.business_payout_items i WHERE i.source_type = 'room' AND i.source_id = pr.id)
    UNION ALL
    -- Lobby: the 1% tap-point commission credited to the owner's wallet.
    SELECT 'lobby'::text, wt.id, wt.amount, COALESCE(wt.description, 'Lobby tap share'), wt.created_at
      FROM public.wallet_transactions wt
      JOIN public.merchants m ON m.id = p_merchant_id AND m.created_by = wt.user_id
     WHERE wt.transaction_type = 'merchant_commission' AND wt.status = 'completed' AND wt.amount > 0
       AND NOT EXISTS (SELECT 1 FROM public.business_payout_items i WHERE i.source_type = 'lobby' AND i.source_id = wt.id)
$$;
REVOKE ALL ON FUNCTION public._business_unpaid_items(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._business_wallet_balance(p_merchant_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    -- Ledger truth (SUM of completed rows), never the wallets cache.
    SELECT COALESCE(SUM(wt.amount), 0)::integer
      FROM public.wallet_transactions wt JOIN public.merchants m ON m.created_by = wt.user_id
     WHERE m.id = p_merchant_id AND wt.status = 'completed'
$$;
REVOKE ALL ON FUNCTION public._business_wallet_balance(uuid) FROM public, anon, authenticated;

-- Owner view: what is owed, payout history, whether bank details are on file.
CREATE OR REPLACE FUNCTION public.merchant_earnings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_m uuid; v_room integer; v_lobby integer; v_bal integer;
BEGIN
    SELECT merchant_id INTO v_m FROM public.profiles WHERE id = auth.uid();
    IF v_m IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'This account is not linked to a business.'); END IF;
    SELECT COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'room'), 0),
           COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'lobby'), 0)
      INTO v_room, v_lobby FROM public._business_unpaid_items(v_m);
    v_bal := GREATEST(public._business_wallet_balance(v_m), 0);
    RETURN jsonb_build_object(
        'success', true,
        'owed_room_cents', v_room,
        'owed_lobby_cents', LEAST(v_lobby, v_bal),
        'lobby_held_back_cents', GREATEST(v_lobby - v_bal, 0),
        'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', source_type, 'amount_cents', amount_cents, 'label', label, 'at', occurred_at) ORDER BY occurred_at DESC)
                             FROM public._business_unpaid_items(v_m)), '[]'::jsonb),
        'payouts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'status', status, 'total_cents', total_cents, 'room_cents', room_cents,
                                       'lobby_cents', lobby_cents, 'created_at', created_at, 'paid_at', paid_at, 'reject_reason', reject_reason) ORDER BY created_at DESC)
                               FROM public.business_payouts WHERE merchant_id = v_m), '[]'::jsonb),
        'has_bank_details', EXISTS (SELECT 1 FROM public.merchant_payout_accounts WHERE merchant_id = v_m AND account_number IS NOT NULL)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_earnings() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_earnings() TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_set_payout_account(
    p_bank_name text, p_account_holder text, p_account_number text, p_account_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_m uuid;
BEGIN
    SELECT merchant_id INTO v_m FROM public.profiles WHERE id = auth.uid();
    IF v_m IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'This account is not linked to a business.'); END IF;
    IF COALESCE(trim(p_bank_name), '') = '' OR COALESCE(trim(p_account_holder), '') = '' OR COALESCE(trim(p_account_number), '') !~ '^[0-9 -]{5,30}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the bank, the account holder name and the account number (digits only).');
    END IF;
    IF EXISTS (SELECT 1 FROM public.merchant_payout_accounts WHERE merchant_id = v_m) THEN
        UPDATE public.merchant_payout_accounts SET bank_name = trim(p_bank_name), account_holder = trim(p_account_holder),
               account_number = regexp_replace(p_account_number, '[^0-9]', '', 'g'), account_type = p_account_type, updated_at = now()
         WHERE merchant_id = v_m;
    ELSE
        INSERT INTO public.merchant_payout_accounts (merchant_id, bank_name, account_holder, account_number, account_type)
        VALUES (v_m, trim(p_bank_name), trim(p_account_holder), regexp_replace(p_account_number, '[^0-9]', '', 'g'), p_account_type);
    END IF;
    -- Never log the account number itself.
    INSERT INTO public.business_audit_log (merchant_id, actor, action, detail)
    VALUES (v_m, auth.uid(), 'bank_details_set', jsonb_build_object('bank', trim(p_bank_name), 'last4', right(regexp_replace(p_account_number, '[^0-9]', '', 'g'), 4)));
    RETURN jsonb_build_object('success', true, 'last4', right(regexp_replace(p_account_number, '[^0-9]', '', 'g'), 4));
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_set_payout_account(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_payout_account(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_request_payout() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    v_m uuid; v_name text; v_payout uuid; v_prop uuid;
    v_room integer := 0; v_lobby integer := 0; v_bal integer; v_take integer; r record;
BEGIN
    SELECT p.merchant_id, m.name INTO v_m, v_name FROM public.profiles p JOIN public.merchants m ON m.id = p.merchant_id WHERE p.id = auth.uid();
    IF v_m IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'This account is not linked to a business.'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.merchant_payout_accounts WHERE merchant_id = v_m AND account_number IS NOT NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Add your bank details first, so we know where to send the money.');
    END IF;
    -- Serialise requests for this business (and the wallet it draws on).
    PERFORM 1 FROM public.merchants WHERE id = v_m FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.business_payouts WHERE merchant_id = v_m AND status IN ('requested', 'approved')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have a payout being processed. You can request another once it is paid.');
    END IF;

    INSERT INTO public.business_payouts (merchant_id, requested_by) VALUES (v_m, auth.uid()) RETURNING id INTO v_payout;

    FOR r IN SELECT * FROM public._business_unpaid_items(v_m) WHERE source_type = 'room' LOOP
        INSERT INTO public.business_payout_items (payout_id, source_type, source_id, amount_cents) VALUES (v_payout, 'room', r.source_id, r.amount_cents);
        v_room := v_room + r.amount_cents;
    END LOOP;
    -- Lobby share only up to what the wallet actually holds; oldest first.
    v_bal := GREATEST(public._business_wallet_balance(v_m), 0);
    FOR r IN SELECT * FROM public._business_unpaid_items(v_m) WHERE source_type = 'lobby' ORDER BY occurred_at LOOP
        EXIT WHEN v_lobby + r.amount_cents > v_bal;
        INSERT INTO public.business_payout_items (payout_id, source_type, source_id, amount_cents) VALUES (v_payout, 'lobby', r.source_id, r.amount_cents);
        v_lobby := v_lobby + r.amount_cents;
    END LOOP;

    IF v_room + v_lobby = 0 THEN
        DELETE FROM public.business_payouts WHERE id = v_payout;
        RETURN jsonb_build_object('success', false, 'error', 'There is nothing to pay out yet.');
    END IF;
    UPDATE public.business_payouts SET room_cents = v_room, lobby_cents = v_lobby WHERE id = v_payout;

    INSERT INTO public.g_proposed_actions (department, action_type, title, reasoning, payload, category, amount_cents)
    VALUES ('finance', 'approve_business_payout',
            format('Pay %s TT$%s', v_name, to_char((v_room + v_lobby) / 100.0, 'FM999,999,990.00')),
            format('%s asked to be paid. Rooms (their own rate x guests, completed stays): TT$%s. Lobby tap share (1%% commission in their wallet): TT$%s. Approving marks it ready to pay; then send the bank transfer and mark it paid with the reference.',
                   v_name, to_char(v_room / 100.0, 'FM999,999,990.00'), to_char(v_lobby / 100.0, 'FM999,999,990.00')),
            jsonb_build_object('payout_id', v_payout, 'merchant_id', v_m),
            'money', v_room + v_lobby)
    RETURNING id INTO v_prop;
    UPDATE public.business_payouts SET proposal_id = v_prop WHERE id = v_payout;

    INSERT INTO public.business_audit_log (merchant_id, actor, action, detail)
    VALUES (v_m, auth.uid(), 'payout_requested', jsonb_build_object('payout_id', v_payout, 'room_cents', v_room, 'lobby_cents', v_lobby));
    RETURN jsonb_build_object('success', true, 'payout_id', v_payout, 'room_cents', v_room, 'lobby_cents', v_lobby, 'total_cents', v_room + v_lobby);
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_request_payout() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merchant_request_payout() TO authenticated;

-- Called by g_execute_action's approve_business_payout handler (service role).
CREATE OR REPLACE FUNCTION public.business_payout_approve(p_proposal_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_pa public.g_proposed_actions%ROWTYPE; v_bp public.business_payouts%ROWTYPE;
BEGIN
    SELECT * INTO v_pa FROM public.g_proposed_actions WHERE id = p_proposal_id;
    IF NOT FOUND OR v_pa.action_type <> 'approve_business_payout' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not a payout proposal.');
    END IF;
    SELECT * INTO v_bp FROM public.business_payouts WHERE id = (v_pa.payload->>'payout_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_bp.status <> 'requested' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This payout is no longer waiting for approval.');
    END IF;
    UPDATE public.business_payouts SET status = 'approved', decided_by = v_pa.decided_by, decided_at = now() WHERE id = v_bp.id;
    INSERT INTO public.business_audit_log (merchant_id, actor, action, detail)
    VALUES (v_bp.merchant_id, v_pa.decided_by, 'payout_approved', jsonb_build_object('payout_id', v_bp.id, 'total_cents', v_bp.total_cents));
    RETURN jsonb_build_object('success', true, 'payout_id', v_bp.id, 'status', 'approved');
END;
$$;
REVOKE ALL ON FUNCTION public.business_payout_approve(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_payout_approve(uuid) TO service_role;

-- A rejected or expired proposal releases the payout's items.
CREATE OR REPLACE FUNCTION public.release_business_payout_on_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.action_type = 'approve_business_payout' AND NEW.status IN ('rejected', 'expired') AND OLD.status IS DISTINCT FROM NEW.status THEN
        UPDATE public.business_payouts SET status = 'rejected', decided_by = NEW.decided_by, decided_at = now(),
               reject_reason = CASE WHEN NEW.status = 'expired' THEN 'Not reviewed in time. Request it again.' ELSE 'Not approved. Contact G868 for details.' END
         WHERE id = (NEW.payload->>'payout_id')::uuid AND status = 'requested';
        DELETE FROM public.business_payout_items WHERE payout_id = (NEW.payload->>'payout_id')::uuid
           AND EXISTS (SELECT 1 FROM public.business_payouts WHERE id = (NEW.payload->>'payout_id')::uuid AND status = 'rejected');
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_release_business_payout ON public.g_proposed_actions;
CREATE TRIGGER trg_release_business_payout AFTER UPDATE OF status ON public.g_proposed_actions
    FOR EACH ROW EXECUTE FUNCTION public.release_business_payout_on_decision();

-- After the bank transfer: mark paid. The lobby part leaves the wallet here.
CREATE OR REPLACE FUNCTION public.admin_mark_business_payout_paid(p_payout_id uuid, p_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_bp public.business_payouts%ROWTYPE; v_owner uuid; v_bal integer;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Admins only.');
    END IF;
    IF COALESCE(trim(p_reference), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the bank transfer reference.');
    END IF;
    SELECT * INTO v_bp FROM public.business_payouts WHERE id = p_payout_id FOR UPDATE;
    IF NOT FOUND OR v_bp.status <> 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only an approved payout can be marked paid.');
    END IF;
    IF v_bp.lobby_cents > 0 THEN
        SELECT created_by INTO v_owner FROM public.merchants WHERE id = v_bp.merchant_id;
        -- Lock the owner's wallet row, then check ledger truth before debiting.
        PERFORM 1 FROM public.wallets WHERE user_id = v_owner FOR UPDATE;
        v_bal := public._business_wallet_balance(v_bp.merchant_id);
        IF v_owner IS NULL OR v_bal < v_bp.lobby_cents THEN
            RETURN jsonb_build_object('success', false, 'error', 'The wallet no longer holds the lobby share. Reject and ask the business to request again.');
        END IF;
        INSERT INTO public.wallet_transactions (user_id, amount, currency, transaction_type, description, reference_id, status)
        VALUES (v_owner, -v_bp.lobby_cents, 'TTD', 'payout', 'Lobby tap share paid out by bank transfer', p_payout_id::text, 'completed');
    END IF;
    UPDATE public.business_payouts SET status = 'paid', paid_reference = trim(p_reference), paid_at = now() WHERE id = v_bp.id;
    INSERT INTO public.business_audit_log (merchant_id, actor, action, detail)
    VALUES (v_bp.merchant_id, auth.uid(), 'payout_paid', jsonb_build_object('payout_id', v_bp.id, 'total_cents', v_bp.total_cents, 'reference', trim(p_reference)));
    RETURN jsonb_build_object('success', true, 'payout_id', v_bp.id, 'status', 'paid');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_mark_business_payout_paid(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_business_payout_paid(uuid, text) TO authenticated;

INSERT INTO public.g_action_types (action_type, execution_mode, category_default, description, payload_schema, is_enabled)
VALUES ('approve_business_payout', 'handler', 'money',
        'A business (hotel) asked to be paid its room money (own rate x guests, completed stays) and its 1% lobby tap share. Approving marks it ready; the bank transfer is then made by hand and marked paid.',
        '{"required": ["payout_id", "merchant_id"]}'::jsonb, true)
ON CONFLICT (action_type) DO UPDATE SET execution_mode = EXCLUDED.execution_mode, description = EXCLUDED.description,
    payload_schema = EXCLUDED.payload_schema, is_enabled = true;
