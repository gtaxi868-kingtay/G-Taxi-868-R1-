-- Split-payment race-condition fix.
--
-- create_split_session / join_split_session / confirm_split_payment (edge functions)
-- had two real bugs, found by direct code review against the live schema:
--
-- 1. join_split_session: checked "session not full" then inserted the participant
--    as two separate unguarded statements (TOCTOU). Two concurrent joins on the
--    last open seat could both pass the check and both insert, overfilling the
--    session past participant_count.
--
-- 2. confirm_split_payment: read wallets.balance_cents then inserted a debit into
--    wallet_transactions as two separate unguarded statements — the exact pattern
--    CLAUDE.md rule #4 prohibits. It also never skipped already-'charged'
--    participants, so a retry after a partial failure would double-charge anyone
--    who succeeded on the first pass. process_wallet_debit_hardened already exists
--    live, is hardcoded for transaction_type='split_payment', and does this
--    correctly (advisory lock + SELECT FOR UPDATE) — it was just never called.
--
-- Both RPCs below lock the split_sessions row for the duration of their
-- check-then-write unit, closing the race at the source instead of in
-- application code (which cannot express a cross-statement lock over
-- PostgREST/edge-function round trips).

create or replace function public.split_session_join_atomic(p_session_id uuid, p_user_id uuid)
returns table(success boolean, error_message text, participant_id uuid)
language plpgsql
as $$
declare
  v_session record;
  v_existing uuid;
  v_count integer;
  v_participant_id uuid := gen_random_uuid();
begin
  select * into v_session from public.split_sessions where id = p_session_id for update;

  if v_session is null then
    return query select false, 'Session not found'::text, null::uuid;
    return;
  end if;

  if v_session.status <> 'collecting' then
    return query select false, 'Session is not collecting participants'::text, null::uuid;
    return;
  end if;

  if v_session.expires_at < now() then
    update public.split_sessions set status = 'expired', updated_at = now() where id = p_session_id;
    return query select false, 'Session expired'::text, null::uuid;
    return;
  end if;

  select id into v_existing from public.split_participants
    where session_id = p_session_id and user_id = p_user_id;
  if v_existing is not null then
    return query select false, 'Already joined this session'::text, null::uuid;
    return;
  end if;

  select count(*) into v_count from public.split_participants
    where session_id = p_session_id and user_id <> v_session.creator_id;
  if v_count >= v_session.participant_count - 1 then
    return query select false, 'Session is full'::text, null::uuid;
    return;
  end if;

  insert into public.split_participants (id, session_id, user_id, amount_cents, status)
  values (v_participant_id, p_session_id, p_user_id, v_session.share_cents, 'confirmed');

  return query select true, null::text, v_participant_id;
exception
  when others then
    return query select false, sqlerrm, null::uuid;
end;
$$;

create or replace function public.split_session_confirm_atomic(p_session_id uuid, p_creator_id uuid)
returns table(charged_count integer, failed_count integer, session_status text)
language plpgsql
as $$
declare
  v_session record;
  v_participant record;
  v_debit record;
  v_failed integer := 0;
  v_charged integer := 0;
begin
  select * into v_session from public.split_sessions where id = p_session_id for update;

  if v_session is null then
    raise exception 'Session not found';
  end if;

  if v_session.creator_id <> p_creator_id then
    raise exception 'Only the creator can confirm payment';
  end if;

  if v_session.status <> 'collecting' then
    raise exception 'Session already %', v_session.status;
  end if;

  if (select count(*) from public.split_participants where session_id = p_session_id) < v_session.participant_count - 1 then
    raise exception 'Not all participants have joined yet';
  end if;

  if exists (
    select 1 from public.split_participants
    where session_id = p_session_id and status not in ('confirmed', 'charged')
  ) then
    raise exception 'Some participants have not confirmed';
  end if;

  -- Only charge participants not already charged (prior partial run) — makes
  -- this RPC safe to retry after a failure without double-billing anyone.
  for v_participant in
    select * from public.split_participants
    where session_id = p_session_id and status = 'confirmed'
  loop
    select * into v_debit from public.process_wallet_debit_hardened(
      v_participant.user_id,
      v_participant.amount_cents,
      'Group split — ' || coalesce(v_session.title, 'Group Ride'),
      v_session.ride_id
    );

    if v_debit.success then
      update public.split_participants
        set status = 'charged', charged_at = now()
        where id = v_participant.id;
    else
      v_failed := v_failed + 1;
    end if;
  end loop;

  select count(*) into v_charged from public.split_participants
    where session_id = p_session_id and status = 'charged';

  if v_failed = 0 then
    update public.split_sessions set status = 'confirmed', updated_at = now() where id = p_session_id;
  end if;

  return query
    select v_charged, v_failed,
      (select status::text from public.split_sessions where id = p_session_id);
end;
$$;

revoke all on function public.split_session_join_atomic(uuid, uuid) from public, anon;
revoke all on function public.split_session_confirm_atomic(uuid, uuid) from public, anon;
grant execute on function public.split_session_join_atomic(uuid, uuid) to service_role;
grant execute on function public.split_session_confirm_atomic(uuid, uuid) to service_role;
