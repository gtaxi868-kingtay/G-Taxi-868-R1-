-- Applied to production 2026-09-07 via apply_migration. Captured here because
-- anything applied straight to prod and not written down is silently lost on a
-- rebuild.
--
-- Growth messaging: admin welcome messages + "zone is full" download invites.
--
-- Two links are involved and NEITHER has a real destination yet: the mobile
-- apps have never been built for distribution and nothing is deployed at a
-- public URL. So both links come from g_config.app_links instead of being
-- hardcoded — messages work today pointing at the front door, and the day the
-- app ships you edit ONE config row and every future message updates.

alter table public.territories
  add column if not exists driver_capacity integer,
  add column if not exists capacity_reached_at timestamptz;

comment on column public.territories.driver_capacity is
  'Target number of VERIFIED drivers for this zone. When reached, the zone is "full" and its people get the download link. NULL = no target set, zone never triggers.';
comment on column public.territories.capacity_reached_at is
  'Set once, the first time driver_capacity was met. Presence of this timestamp is what stops the sweep re-firing.';

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_role text not null check (recipient_role in ('rider','driver','merchant','commander')),
  recipient_id uuid,
  phone text not null,
  template text not null,
  territory_id uuid references public.territories(id),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  channel text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.outbound_messages is
  'Every WhatsApp the platform sends a person. Exists mainly as an idempotency ledger: the capacity sweep runs on a schedule, and without the unique index below it would re-send "your zone is live" to the same phone on every single run.';

create unique index if not exists outbound_messages_once
  on public.outbound_messages (recipient_role, coalesce(recipient_id::text, phone), template);

create index if not exists outbound_messages_territory_idx
  on public.outbound_messages (territory_id, template);

alter table public.outbound_messages enable row level security;
revoke all on public.outbound_messages from anon, authenticated;

insert into public.g_config (key, value)
values ('app_links', jsonb_build_object(
  'rider_download_url',    'https://g-taxi.com/get',
  'driver_download_url',   'https://g-taxi.com/drive',
  'merchant_download_url', 'https://g-taxi.com/merchant',
  'profile_link_base',     'https://g-taxi.com/p',
  'note', 'Placeholder front-door URLs. Replace with real store links once the Expo apps are built and published; every future message picks it up with no redeploy.'
))
on conflict (key) do nothing;

create or replace function public.territories_newly_full()
returns table (territory_id uuid, territory_name text, verified_drivers bigint, capacity integer)
language sql
security definer
set search_path = public
as $$
  select t.id, t.name, count(d.id) as verified_drivers, t.driver_capacity
  from public.territories t
  join public.drivers d
    on d.territory_id = t.id
   and d.is_verified = true
  where t.is_active
    and t.driver_capacity is not null
    and t.capacity_reached_at is null
  group by t.id, t.name, t.driver_capacity
  having count(d.id) >= t.driver_capacity;
$$;

revoke all on function public.territories_newly_full() from anon, authenticated;

-- Hourly sweep. Inert until a zone is deliberately armed with a driver_capacity
-- (all are NULL today) — that is the launch cutoff, enforced structurally
-- rather than by a date.
select cron.schedule(
  'zone-capacity-invite-hourly',
  '20 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ffbbuafgeypvkpcuvdnv.supabase.co/functions/v1/notify_admins',
    headers := jsonb_build_object('x-cron-secret', public.platform_cron_secret(),
                                  'Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'capacity_sweep'),
    timeout_milliseconds := 25000
  );
  $cron$
);
