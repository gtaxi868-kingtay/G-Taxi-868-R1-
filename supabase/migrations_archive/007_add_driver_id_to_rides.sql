-- Add driver_id to rides table
-- This fixes the "Internal Error" in match_driver where it tries to assign a driver to a non-existent column.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'rides'
        AND column_name = 'driver_id'
    ) THEN
        ALTER TABLE public.rides ADD COLUMN driver_id UUID REFERENCES public.drivers(id);
    END IF;
END $$;
