-- Applied to production 2026-09-07 via apply_migration. Captured here because
-- anything applied straight to prod and not written down is silently lost on
-- a rebuild.
--
-- Waitlist gains a JSONB `details` column for role-specific extras collected
-- on the public site (driver vehicle type / plate; merchant category /
-- address), plus a one-shot RPC apps call right after signup to pre-fill
-- those fields instead of re-asking. Dry-run verified in a rolled-back
-- transaction before this was applied for real, and live-verified again
-- after (insert -> approve -> claim -> replay-blocked -> cleaned up).

alter table public.waitlist add column if not exists details jsonb not null default '{}'::jsonb;

comment on column public.waitlist.details is
  'Role-specific extras from the public signup form. drive: {vehicle_type, plate_number}. sell: {category, address}. ride: {}. Not schema-enforced by design — matches g_proposed_actions.payload and similar JSONB-extras patterns already in this codebase.';

-- Only matches an APPROVED row, and flips it to 'claimed' on match so a
-- waitlist entry can be consumed by exactly one real signup, never replayed.
create or replace function public.claim_waitlist_details(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row waitlist%rowtype;
begin
  if p_phone is null or length(trim(p_phone)) = 0 then
    return '{}'::jsonb;
  end if;

  select * into v_row
    from waitlist
   where phone = p_phone
     and status = 'approved'
   order by created_at desc
   limit 1;

  if not found then
    return '{}'::jsonb;
  end if;

  update waitlist set status = 'claimed' where id = v_row.id;

  return jsonb_build_object(
    'community', v_row.community,
    'user_type', v_row.user_type,
    'details', v_row.details
  );
end;
$$;

comment on function public.claim_waitlist_details(text) is
  'Called once by each app right after auth.signUp succeeds, keyed on the phone number the user just entered. Returns the matched approved waitlist row''s pre-fill data and marks it claimed so it cannot be reused for a second signup. Returns {} on no match, on an already-claimed row, or on a still-pending (not yet admin-approved) row.';

revoke all on function public.claim_waitlist_details(text) from public, anon;
grant execute on function public.claim_waitlist_details(text) to authenticated;
