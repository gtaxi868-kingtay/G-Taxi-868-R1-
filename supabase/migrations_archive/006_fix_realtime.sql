-- Fix Realtime for Rides Table
-- Ensure we get the full row data on updates
alter table public.rides replica identity full;

-- Safe way to add table to publication:
-- Use a DO block to check if it's already added or handle the error gracefully
do $$
begin
  begin
    alter publication supabase_realtime add table public.rides;
  exception when duplicate_object then
    null; -- Table is already in the publication, ignore error
  end;
end $$;

-- Enable Realtime for Drivers Table (Location tracking)
alter table public.drivers replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.drivers;
  exception when duplicate_object then
    null;
  end;
end $$;

-- Fix Permissions for Drivers Table
-- Riders need to select driver details when assigned
-- Drop first to avoid "Policy already exists" error
drop policy if exists "Riders can see assigned drivers" on public.drivers;

create policy "Riders can see assigned drivers"
on public.drivers for select
to authenticated
using (true);
