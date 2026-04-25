ALTER TABLE public.saved_places 
ADD COLUMN IF NOT EXISTS icon TEXT;
-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
