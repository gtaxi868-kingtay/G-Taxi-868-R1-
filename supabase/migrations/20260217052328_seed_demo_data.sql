-- 1. Ensure schema is correct
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
-- 2. Seed Bot Drivers (Trinidad)
-- POS Area
INSERT INTO public.drivers (id, name, lat, lng, vehicle_model, plate_number, status, is_online, is_bot)
VALUES (
    gen_random_uuid(), 
    'Ricardo (Bot)', 
    10.65, 
    -61.51, 
    'Toyota Corolla', 
    'PDC 1234', 
    'online', 
    true, 
    true
) ON CONFLICT DO NOTHING;
-- San Fernando Area
INSERT INTO public.drivers (id, name, lat, lng, vehicle_model, plate_number, status, is_online, is_bot)
VALUES (
    gen_random_uuid(), 
    'Sarita (Bot)', 
    10.28, 
    -61.45, 
    'Hyundai Elantra', 
    'PDS 5678', 
    'online', 
    true, 
    true
) ON CONFLICT DO NOTHING;
-- Arima Area
INSERT INTO public.drivers (id, name, lat, lng, vehicle_model, plate_number, status, is_online, is_bot)
VALUES (
    gen_random_uuid(), 
    'Kevin (Bot)', 
    10.63, 
    -61.28, 
    'Nissan Sylphy', 
    'PDR 9012', 
    'online', 
    true, 
    true
) ON CONFLICT DO NOTHING;
-- 3. Notify PostgREST
NOTIFY pgrst, 'reload schema';
