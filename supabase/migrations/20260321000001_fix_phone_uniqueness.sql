-- Fix 4 (Corrected): Prevent Cross-Table Fraud
-- Enforce phone number uniqueness across profiles (riders) and drivers tables

-- Function that enforces cross-table phone uniqueness
CREATE OR REPLACE FUNCTION enforce_phone_uniqueness()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Skip if phone_number is null
  IF NEW.phone_number IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if phone exists in profiles table
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE phone_number = NEW.phone_number
    AND id != NEW.id  -- exclude self on update
  ) THEN
    RAISE EXCEPTION
      'Phone number % is already registered as a rider',
      NEW.phone_number;
  END IF;

  -- Check if phone exists in drivers table
  IF EXISTS (
    SELECT 1 FROM public.drivers
    WHERE phone_number = NEW.phone_number
    AND id != NEW.id  -- exclude self on update
  ) THEN
    RAISE EXCEPTION
      'Phone number % is already registered as a driver',
      NEW.phone_number;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on profiles table
DROP TRIGGER IF EXISTS trg_profiles_phone_unique ON public.profiles;
CREATE TRIGGER trg_profiles_phone_unique
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_phone_uniqueness();

-- Trigger on drivers table
DROP TRIGGER IF EXISTS trg_drivers_phone_unique ON public.drivers;
CREATE TRIGGER trg_drivers_phone_unique
  BEFORE INSERT OR UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION enforce_phone_uniqueness();
