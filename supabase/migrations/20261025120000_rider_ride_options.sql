-- Rider in-ride options: Safe Entry and music suggestions.
--
-- WHY: the rider app updated rides.safe_entry / entertainment_url /
-- entertainment_status directly. `authenticated` has no UPDATE grant on rides,
-- and the only rider UPDATE policy ("Riders cancel own rides") requires the row
-- to END as status='cancelled'. So Safe Entry silently did nothing and music
-- suggestions always failed (proven 2026-10-25 by running the update as a real
-- rider inside a rolled-back transaction: "permission denied for table rides").
--
-- FIX: one narrow SECURITY DEFINER function. A rider may change ONLY these
-- three fields, ONLY on their own ride, ONLY while it is live. No grant on the
-- rides table is widened.

create or replace function public.rider_set_ride_options(
    p_ride_id uuid,
    p_safe_entry boolean default null,
    p_entertainment_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_uid uuid := auth.uid();
    v_ride public.rides%rowtype;
begin
    if v_uid is null then
        return jsonb_build_object('success', false, 'error', 'Please sign in again.');
    end if;

    select * into v_ride from public.rides where id = p_ride_id for update;
    if not found or v_ride.rider_id <> v_uid then
        return jsonb_build_object('success', false, 'error', 'Ride not found.');
    end if;
    if v_ride.status::text not in ('searching', 'assigned', 'arrived', 'in_progress') then
        return jsonb_build_object('success', false, 'error', 'This ride is no longer active.');
    end if;

    if p_entertainment_url is not null then
        if length(p_entertainment_url) > 500
           or p_entertainment_url !~* '^https://([a-z0-9-]+\.)*(spotify\.com|youtube\.com|youtu\.be)/' then
            return jsonb_build_object('success', false, 'error', 'Please use a Spotify or YouTube link.');
        end if;
    end if;

    update public.rides set
        safe_entry = coalesce(p_safe_entry, safe_entry),
        entertainment_url = coalesce(p_entertainment_url, entertainment_url),
        entertainment_status = case when p_entertainment_url is not null then 'pending' else entertainment_status end
    where id = p_ride_id;

    return jsonb_build_object(
        'success', true,
        'safe_entry', coalesce(p_safe_entry, v_ride.safe_entry),
        'entertainment_status', case when p_entertainment_url is not null then 'pending' else v_ride.entertainment_status end
    );
end;
$$;

revoke all on function public.rider_set_ride_options(uuid, boolean, text) from public, anon;
grant execute on function public.rider_set_ride_options(uuid, boolean, text) to authenticated;
