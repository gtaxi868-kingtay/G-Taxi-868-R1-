-- commander_applications: self-serve commander buy-in application.
--
-- admin/index.ts's manage_commanders action (list_applications, approve_application,
-- reject_application) already reads/writes this exact shape — it was written against
-- a table that was never created. This migration creates it to match that contract:
--   select('*') expects: id, user_id, status, phone, whatsapp, area, reviewed_by,
--     reviewed_at, review_notes, created_at
--   approve_application reads app.phone / app.whatsapp / app.area into pod_commanders.metrics
--
-- payment_status / amount_cents / wipay_* / paid_at are new — added so the WiPay
-- buy-in gate (commander_apply + wipay_webhook) can track payment before admin
-- ever sees the application as approvable.

create table public.commander_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),

  phone text,
  whatsapp text,
  area text,

  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'failed')),
  amount_cents integer not null default 50000 check (amount_cents > 0),
  wipay_order_id text unique,
  wipay_transaction_id text,
  paid_at timestamptz,

  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,

  created_at timestamptz not null default now()
);

create index idx_commander_applications_user_id on public.commander_applications(user_id);
create index idx_commander_applications_status on public.commander_applications(status);

-- One live (pending or paid-unreviewed) application per user at a time.
create unique index idx_commander_applications_one_pending_per_user
  on public.commander_applications(user_id)
  where status = 'pending';

alter table public.commander_applications enable row level security;

-- Applicant can read their own application (status, payment progress). All writes
-- go through commander_apply / wipay_webhook / admin (service role), matching the
-- payment_ledger / user_consents pattern already used elsewhere in this schema.
create policy "commander_applications_select_own"
  on public.commander_applications for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.commander_applications to authenticated;
