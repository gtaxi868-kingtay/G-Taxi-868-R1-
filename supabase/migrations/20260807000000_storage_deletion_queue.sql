-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE DELETION QUEUE + account-deletion safety fix
-- (2026-08-07)
--
-- WHY A QUEUE AND NOT A DIRECT DELETE
-- ----------------------------------
-- Deleting a row from storage.objects does NOT remove the underlying file.
-- It removes the pointer and leaves the bytes orphaned — which is strictly
-- WORSE than doing nothing: the record that the file exists is gone, so
-- nothing can ever find it to delete it. The only supported way to remove
-- both is the storage API (`storage.from(bucket).remove([...])`), which lives
-- outside the database.
--
-- So SQL never touches storage. It writes an instruction here, and the
-- process_storage_deletions edge function carries it out. The queue is the
-- safety property:
--   * nothing is lost if the drain fails — the row stays pending
--   * every attempt is counted and every error is kept
--   * a stuck queue is visible in one query instead of being silent
--   * the worst failure mode is "files not yet deleted", never "files
--     orphaned and unfindable"
--
-- KNOWN OPERATIONAL GAP, STATED NOT HIDDEN
-- ----------------------------------------
-- public.platform_cron_secret() currently returns EMPTY. Every cron-driven
-- edge call therefore 401s at the gateway. The cron job below is scheduled
-- and correct, and it will start draining the moment that secret is set in
-- Vault AND as the function's PLATFORM_CRON_SECRET env var. Until then the
-- queue accumulates safely and an admin can drain it by calling the function
-- directly. This is exactly why the design is a queue: the missing secret
-- delays the work, it does not lose it.
--
-- WHAT IS DELIBERATELY NOT QUEUED
-- -------------------------------
-- driver-documents and driver_credentials. Those are regulatory and
-- insurance evidence with a 7-year retention (see
-- docs/legal/DATA_RETENTION_AND_DELETION.md 3.4). Deleting them on account
-- closure would destroy the proof that we checked a driver's licence.
--
-- ON package_reservations.passport_image_url: the column exists in the
-- schema but NOTHING in this codebase writes it — there is no passport
-- upload path in any app. There is therefore no orphaned passport image to
-- collect, and this file does not invent a URL parser for a format that has
-- never been produced. If a passport upload is built later, it must enqueue
-- through queue_storage_deletion() at the point the row is redacted.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.storage_deletion_queue (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id    text NOT NULL,
    object_path  text NOT NULL,
    reason       text NOT NULL,
    status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','done','failed','skipped')),
    attempts     integer NOT NULL DEFAULT 0,
    last_error   text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (bucket_id, object_path)
);

CREATE INDEX IF NOT EXISTS storage_deletion_queue_pending_idx
    ON public.storage_deletion_queue (status, requested_at)
    WHERE status = 'pending';

ALTER TABLE public.storage_deletion_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_deletion_queue FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_deletion_queue FROM anon, authenticated;

COMMENT ON TABLE public.storage_deletion_queue IS
'Files that must be removed from storage. SQL enqueues; the process_storage_deletions edge function performs the actual delete through the storage API. Never delete storage.objects rows directly — that orphans the bytes instead of removing them.';

-- ---------------------------------------------------------------------------
-- queue_storage_deletion — the single writer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_storage_deletion(
    p_bucket_id   text,
    p_object_path text,
    p_reason      text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_bucket_id IS NULL OR p_object_path IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.storage_deletion_queue (bucket_id, object_path, reason)
    VALUES (p_bucket_id, p_object_path, p_reason)
    ON CONFLICT (bucket_id, object_path) DO NOTHING
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;   -- enqueuing must never break the operation that asked
END;
$$;

REVOKE ALL ON FUNCTION public.queue_storage_deletion(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_storage_deletion(text,text,text) TO service_role;

-- ---------------------------------------------------------------------------
-- anonymise_user — same contract, now also queues the person's files.
--
-- Files are matched two ways because this codebase uses both conventions:
-- storage.objects.owner (set by the uploading client) and a `<user_id>/...`
-- path prefix. Matching only one would silently miss half.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymise_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_tomb text := 'deleted-' || left(md5(p_user_id::text), 12);
    v_out  jsonb := '{}'::jsonb;
    v_n    integer;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'user_id required');
    END IF;

    UPDATE public.profiles SET
        full_name              = 'Deleted user',
        email                  = v_tomb || '@deleted.invalid',
        phone_number           = NULL,
        avatar_url             = NULL,
        push_token             = NULL,
        emergency_contact_name = NULL,
        emergency_contact_phone= NULL,
        national_id_hash       = NULL,
        nfc_uid                = NULL,
        notification_enabled   = false
    WHERE id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('profiles', v_n);

    UPDATE public.drivers SET
        name                   = 'Deleted driver',
        phone_number           = NULL,
        push_token             = NULL,
        emergency_contact_name = NULL,
        emergency_contact_phone= NULL,
        bank_details           = NULL,
        is_online              = false,
        lat = NULL, lng = NULL, location = NULL
    WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('drivers', v_n);

    DELETE FROM public.saved_places WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('saved_places', v_n);

    DELETE FROM public.g_rider_memory WHERE rider_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('assistant_memory', v_n);

    DELETE FROM public.g_rider_reminders WHERE rider_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('assistant_reminders', v_n);

    DELETE FROM public.passenger_details WHERE rider_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('passport_records', v_n);

    UPDATE public.rides
       SET pickup_address = NULL, dropoff_address = NULL
     WHERE rider_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('ride_addresses_cleared', v_n);

    DELETE FROM public.ride_messages WHERE sender_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('ride_messages', v_n);

    -- Files. driver-documents and driver_credentials are excluded on purpose:
    -- regulatory evidence, 7-year retention.
    BEGIN
        INSERT INTO public.storage_deletion_queue (bucket_id, object_path, reason)
        SELECT o.bucket_id, o.name, 'account_deletion'
          FROM storage.objects o
         WHERE o.bucket_id IN ('rider_profiles','receipts','merchant-intake-photos','avatars','verification-photos')
           AND (o.owner = p_user_id OR o.name LIKE p_user_id::text || '/%')
        ON CONFLICT (bucket_id, object_path) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_out := v_out || jsonb_build_object('files_queued_for_deletion', v_n);
    EXCEPTION WHEN OTHERS THEN
        v_out := v_out || jsonb_build_object('files_queued_for_deletion', 'error: ' || SQLERRM);
    END;

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'affected', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymise_user(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- request_account_deletion — SAFETY FIX: stop setting profiles.suspended.
--
-- profiles.suspended is the ADMIN BAN flag (supabase/functions/admin sets it
-- for a banned rider). Overloading it with "this person asked to leave" is
-- wrong twice over:
--
--   1. It corrupts the admin's ban list — a departing user would appear
--      indistinguishable from someone removed for abuse.
--   2. It is a trap waiting to spring. Nothing reads it at sign-in TODAY, but
--      the obvious future change — block suspended accounts from signing in —
--      would lock a user out of the very screen holding their Cancel button,
--      during the grace period that exists precisely so they can change their
--      mind. A 30-day undo you cannot reach is not an undo.
--
-- The account_deletion_requests row is the marker. It needs no second one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_uid   uuid := auth.uid();
    v_days  integer;
    v_when  timestamptz;
    v_bal   numeric;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'not signed in');
    END IF;

    SELECT retention_days INTO v_days
      FROM public.data_retention_policy WHERE category = 'account_anonymisation';
    v_when := now() + ((COALESCE(v_days, 30))::text || ' days')::interval;

    SELECT COALESCE(SUM(amount), 0) INTO v_bal
      FROM public.wallet_transactions WHERE user_id = v_uid AND status = 'completed';

    INSERT INTO public.account_deletion_requests (user_id, scheduled_at, status)
    VALUES (v_uid, v_when, 'pending')
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'pending', requested_at = now(), scheduled_at = v_when,
          completed_at = NULL, hold_reason = NULL;

    RETURN jsonb_build_object(
        'success', true,
        'scheduled_at', v_when,
        'grace_days', COALESCE(v_days, 30),
        'wallet_balance_cents', v_bal,
        'warning', CASE WHEN v_bal > 0
                        THEN 'You have money in your wallet. Withdraw it before the grace period ends — it cannot be returned afterwards.'
                        END);
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

-- cancel_account_deletion no longer needs to un-suspend anything.
CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_n   integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'not signed in');
    END IF;

    -- 'on_hold' is cancellable too: a user whose deletion is paused for an
    -- open dispute must still be able to withdraw the request entirely.
    UPDATE public.account_deletion_requests
       SET status = 'cancelled', hold_reason = NULL
     WHERE user_id = v_uid AND status IN ('pending','on_hold');
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'no pending deletion request');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated;

-- ---------------------------------------------------------------------------
-- get_my_deletion_status — what the app shows. Own row only, by construction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_deletion_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row RECORD;
    v_bal numeric;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'not signed in');
    END IF;

    SELECT * INTO v_row FROM public.account_deletion_requests WHERE user_id = v_uid;

    SELECT COALESCE(SUM(amount), 0) INTO v_bal
      FROM public.wallet_transactions WHERE user_id = v_uid AND status = 'completed';

    IF v_row IS NULL OR v_row.status IN ('cancelled','completed') THEN
        RETURN jsonb_build_object('pending', false, 'wallet_balance_cents', v_bal);
    END IF;

    RETURN jsonb_build_object(
        'pending',              true,
        'status',               v_row.status,
        'requested_at',         v_row.requested_at,
        'scheduled_at',         v_row.scheduled_at,
        'hold_reason',          v_row.hold_reason,
        'wallet_balance_cents', v_bal);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_deletion_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_deletion_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- Cron for the drain. Correct and scheduled; inert until the cron secret is
-- set (see the header note). A queue that waits is safe; a delete that half
-- happens is not.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('storage-deletion-drain')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage-deletion-drain');

SELECT cron.schedule('storage-deletion-drain', '45 3 * * *', $cron$
  SELECT net.http_post(
    url     := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/process_storage_deletions',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'x-cron-secret', public.platform_cron_secret()),
    body    := '{}'::jsonb);
$cron$);
