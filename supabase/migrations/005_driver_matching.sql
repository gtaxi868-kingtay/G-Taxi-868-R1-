-- Enable PostGIS extension for geospatial queries
create extension if not exists postgis with schema extensions;

-- Add geography column to drivers table
-- We use GEOGRAPHY(POINT) for accurate distance calculations on the earth's surface
alter table public.drivers 
add column if not exists location extensions.geography(POINT);

-- Create Index for fast spatial searches (The "Hexagon" equivalent)
create index if not exists drivers_location_idx
on public.drivers
using GIST (location);

-- Function to sync lat/lng to location column automatically
-- This ensures backward compatibility with existing code using lat/lng
create or replace function public.sync_driver_location()
returns trigger as $$
begin
    -- Create point from lng/lat (Note: PostGIS uses Longitude first!)
    if new.lat is not null and new.lng is not null then
        new.location = extensions.ST_SetSRID(extensions.ST_MakePoint(new.lng, new.lat), 4326)::extensions.geography;
    end if;
    return new;
end;
$$ language plpgsql;

-- Trigger to run the sync on every insert/update
create trigger sync_driver_location_trigger
before insert or update on public.drivers
for each row
execute function public.sync_driver_location();

-- Backfill existing drivers
update public.drivers
set location = extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography
where lat is not null and lng is not null;

-- RPC Function: Get Nearby Drivers
-- Used by the Edge Function to find drivers efficiently
create or replace function public.get_nearby_drivers(
    center_lat float,
    center_lng float,
    radius_meters float
)
returns table (
    id uuid,
    name text,
    vehicle_model text,
    plate_number text,
    rating numeric,
    phone_number text,
    lat numeric,
    lng numeric,
    heading numeric,
    dist_meters float
)
language plpgsql
security definer
as $$
begin
    return query
    select
        d.id,
        d.name,
        d.vehicle_model,
        d.plate_number,
        d.rating,
        d.phone_number,
        d.lat,
        d.lng,
        d.heading,
        extensions.ST_Distance(
            d.location,
            extensions.ST_SetSRID(extensions.ST_MakePoint(center_lng, center_lat), 4326)::extensions.geography
        ) as dist_meters
    from
        public.drivers d
    where
        d.is_online = true
        and d.status = 'online'
        and extensions.ST_DWithin(
            d.location,
            extensions.ST_SetSRID(extensions.ST_MakePoint(center_lng, center_lat), 4326)::extensions.geography,
            radius_meters
        )
    order by
        dist_meters asc;
end;
$$;

-- Seed the "System Test Driver" (Bot)
-- Fixed UUID allows us to reliably target this driver for testing
insert into public.drivers (
    id, 
    name, 
    vehicle_model, 
    plate_number, 
    rating, 
    phone_number, 
    lat, 
    lng, 
    is_online, 
    status
)
values (
    '00000000-0000-0000-0000-000000000000', -- Fixed UUID
    'G-Taxi Bot 🤖', 
    'Cyber Taxi', 
    'TEST-AI', 
    5.0, 
    '+1 868 000 0000', 
    10.65, -- Generic generic location
    -61.50, 
    true, 
    'online'
)
on conflict (id) do update 
set is_online = true, status = 'online'; -- Ensure bot is always online after migration
