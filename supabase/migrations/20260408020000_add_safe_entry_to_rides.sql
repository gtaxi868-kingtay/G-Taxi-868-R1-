-- supabase/migrations/20260408020000_add_safe_entry_to_rides.sql
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS safe_entry BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.rides.safe_entry IS 'When true, driver is instructed to wait until rider is safely inside their destination before closing the ride.';
