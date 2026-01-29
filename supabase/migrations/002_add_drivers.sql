-- Create drivers table
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id), -- Optional: link to auth user if driver app exists
  name text not null,
  vehicle_model text not null,
  plate_number text not null,
  rating numeric(3, 2) default 5.0,
  phone_number text,
  vehicle_color text,
  vehicle_image_url text,
  
  -- Location (for Ghost Cars)
  lat double precision,
  lng double precision,
  heading double precision default 0,
  is_online boolean default false,
  status text default 'offline', -- 'offline', 'online', 'busy'
  
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- RLS Policies
alter table public.drivers enable row level security;

-- Everyone can view online drivers (for Ghost Cars)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'drivers' 
        AND policyname = 'Public drivers are viewable by everyone'
    ) THEN
        create policy "Public drivers are viewable by everyone"
        on public.drivers for select
        using (true);
    END IF;
END $$;

-- Only service role can update driver locations (for now, or driver app later)
-- Only service role can update driver locations (for now, or driver app later)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'drivers' 
        AND policyname = 'Service role can update drivers'
    ) THEN
        create policy "Service role can update drivers"
        on public.drivers for all
        using (auth.role() = 'service_role');
    END IF;
END $$;

-- Seed Data: Ghost Drivers (Mock Data)
-- Piarco / Trincity area
insert into public.drivers (name, vehicle_model, plate_number, rating, is_online, status, lat, lng, heading)
values 
('Marcus Johnson', 'Toyota Corolla', 'PDA 1234', 4.9, true, 'online', 10.601, -61.339, 45),
('Sarah Lee', 'Honda Civic', 'PDB 5678', 4.8, true, 'online', 10.598, -61.342, 90),
('David Chen', 'Nissan Versa', 'PDC 9012', 4.7, true, 'online', 10.595, -61.335, 180),
('Priya Singh', 'Hyundai Elantra', 'PDD 3456', 4.9, true, 'online', 10.605, -61.330, 270),
('Jason Thomas', 'Kia Cerato', 'PDE 7890', 4.6, true, 'online', 10.600, -61.345, 135);

-- Enable Realtime for drivers
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'drivers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
    END IF;
END $$;
