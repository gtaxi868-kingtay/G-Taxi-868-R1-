-- Replaces the local Mac launchd "jarvis-health" script (osascript notifications
-- every 5 min, laptop-dependent, broken output) with a real in-system health
-- monitor: runs on pg_cron (server-side, always on, no laptop needed), writes
-- into the existing system_alerts table, readable from admin web and mobile
-- via a normal Supabase client query — no new edge function required, so this
-- doesn't touch the function-count cap at all.
--
-- g_config already had an 'edge_watchdog' key (min_failures:3, window_minutes:30)
-- that nothing read. This is that department, actually wired.
--
-- Split into an unguarded _internal function (cron calls this — pg_cron has no
-- JWT/auth.uid(), so an admin-role check on the function cron calls would
-- always fail) and a guarded public wrapper (what admin web/mobile calls).

create or replace function public.g_system_health_summary_internal()
returns table(check_name text, status text, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cron_failures integer;
  v_queue_backlog integer;
  v_unresolved_critical integer;
  v_llm_spent numeric;
  v_llm_budget numeric;
begin
  select count(*) into v_cron_failures
  from cron.job_run_details jrd
  where jrd.start_time > now() - interval '30 minutes' and jrd.status = 'failed';

  select count(*) into v_queue_backlog
  from public.event_queue eq
  where eq.completed_at is null
    and eq.status != 'completed'
    and eq.created_at < now() - interval '15 minutes';

  select count(*) into v_unresolved_critical
  from public.system_alerts
  where severity = 'CRITICAL' and resolved_at is null;

  select coalesce(sum(est_cost_usd), 0) into v_llm_spent
  from public.g_llm_usage
  where day = current_date;

  select (value #>> '{}')::numeric into v_llm_budget
  from public.g_config where key = 'daily_llm_budget_usd';

  return query
    select 'cron_failures'::text,
      case when v_cron_failures >= 3 then 'critical' when v_cron_failures >= 1 then 'warning' else 'ok' end,
      v_cron_failures::text || ' failed cron run(s) in the last 30 minutes'
    union all
    select 'event_queue_backlog',
      case when v_queue_backlog >= 50 then 'critical' when v_queue_backlog >= 10 then 'warning' else 'ok' end,
      v_queue_backlog::text || ' event(s) stuck unprocessed for 15+ minutes'
    union all
    select 'unresolved_critical_alerts',
      case when v_unresolved_critical >= 1 then 'critical' else 'ok' end,
      v_unresolved_critical::text || ' unresolved CRITICAL alert(s)'
    union all
    select 'llm_budget',
      case
        when v_llm_budget is null then 'ok'
        when v_llm_spent >= v_llm_budget then 'critical'
        when v_llm_spent >= v_llm_budget * 0.8 then 'warning'
        else 'ok'
      end,
      '$' || round(v_llm_spent, 2)::text || ' spent today of $' || coalesce(v_llm_budget::text, 'unset') || ' daily budget';
end;
$$;

-- Public, admin-gated wrapper — this is what admin web/mobile calls.
create or replace function public.g_system_health_summary()
returns table(check_name text, status text, detail text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Forbidden: admin only';
  end if;

  return query select * from public.g_system_health_summary_internal();
end;
$$;

-- Sweep: turns any non-'ok' summary row into a system_alerts row, but only if
-- one for that check isn't already open — keeps this from spamming a new row
-- every 5 minutes for the same ongoing issue (the exact "blank notification
-- every few minutes" problem this whole thing replaces). Calls the internal,
-- unguarded function since pg_cron has no auth.uid() to pass the admin check.
create or replace function public.g_system_health_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check record;
begin
  for v_check in select * from public.g_system_health_summary_internal() where status != 'ok'
  loop
    if not exists (
      select 1 from public.system_alerts
      where type = 'g_health_' || v_check.check_name and resolved_at is null
    ) then
      insert into public.system_alerts (type, severity, title, details)
      values (
        'g_health_' || v_check.check_name,
        upper(v_check.status),
        'G health check: ' || v_check.check_name,
        jsonb_build_object('detail', v_check.detail, 'checked_at', now())
      );
    end if;
  end loop;

  update public.system_alerts
  set resolved_at = now()
  where type like 'g_health_%'
    and resolved_at is null
    and type not in (
      select 'g_health_' || check_name from public.g_system_health_summary_internal() where status != 'ok'
    );
end;
$$;

revoke all on function public.g_system_health_summary_internal() from public, anon, authenticated;
revoke all on function public.g_system_health_summary() from public, anon;
revoke all on function public.g_system_health_sweep() from public, anon, authenticated;

grant execute on function public.g_system_health_summary_internal() to service_role;
grant execute on function public.g_system_health_summary() to authenticated, service_role;
grant execute on function public.g_system_health_sweep() to service_role;

select cron.schedule(
  'g-system-health-sweep',
  '*/5 * * * *',
  $$select public.g_system_health_sweep();$$
);
