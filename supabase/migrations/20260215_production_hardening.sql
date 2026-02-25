-- PRODUCTION HARDENING SUITE: 2026-02-15
-- Covers Phases 2, 3, 4, 5, 9
-- IDEMPOTENT VERSION (Allows safe re-run)

-- ============================================================
-- PHASE 2: DATABASE STATE MACHINE HARD LOCK
-- ============================================================

-- Force Strict Lifecycle
CREATE OR REPLACE FUNCTION validate_ride_status_transition()
RETURNS TRIGGER AS $$
DECLARE
    old_status text := OLD.status::text;
    new_status text := NEW.status::text;
BEGIN
    if old_status = new_status THEN RETURN NEW; END IF;
    IF new_status = 'cancelled' THEN RETURN NEW; END IF;
    IF old_status = 'searching' AND new_status = 'assigned' THEN RETURN NEW; END IF;
    IF old_status = 'assigned' AND new_status = 'enroute' THEN RETURN NEW; END IF;
    IF old_status = 'assigned' AND new_status = 'arrived' THEN RETURN NEW; END IF;
    IF old_status = 'enroute' AND new_status = 'arrived' THEN RETURN NEW; END IF;
    IF old_status = 'arrived' AND new_status = 'in_progress' THEN RETURN NEW; END IF;

    IF old_status = 'in_progress' AND new_status = 'completed' THEN
        -- Check payment_status
        IF NEW.payment_method = 'cash' THEN RETURN NEW; END IF;
        IF NEW.payment_status = 'captured' THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Cannot complete ride without payment capture (Status: %, Method: %)', NEW.payment_status, NEW.payment_method;
    END IF;

    RAISE EXCEPTION 'Invalid Ride Status Transition: % -> %', old_status, new_status;
END;
$$ LANGUAGE plpgsql;

-- TRIGGER (Create constraint)
DROP TRIGGER IF EXISTS trg_validate_ride_status ON public.rides;
CREATE TRIGGER trg_validate_ride_status
    BEFORE UPDATE OF status ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION validate_ride_status_transition();


-- ============================================================
-- PHASE 3: MULTI-RAIL PAYMENT ARCHITECTURE
-- ============================================================

-- 3.1 ENUMS
DO $$ BEGIN
    CREATE TYPE payment_method_enum AS ENUM ('card', 'cash', 'wallet');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('pending', 'authorized', 'captured', 'failed', 'refunded');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3.2 Add Columns to rides
DO $$ BEGIN
    ALTER TABLE public.rides ADD COLUMN payment_status payment_status_enum DEFAULT 'pending';
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- 3.3 Ledger
CREATE TABLE IF NOT EXISTS public.payment_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES public.rides(id),
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'TTD',
    method payment_method_enum NOT NULL,
    provider TEXT NOT NULL,
    provider_reference TEXT,
    status payment_status_enum NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for ledger (Idempotent)
ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service Role Full Access Ledger' AND tablename = 'payment_ledger') THEN
        CREATE POLICY "Service Role Full Access Ledger" ON public.payment_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Rider View Own Ledger' AND tablename = 'payment_ledger') THEN
        CREATE POLICY "Rider View Own Ledger" ON public.payment_ledger FOR SELECT USING (
            EXISTS (SELECT 1 FROM rides WHERE rides.id = payment_ledger.ride_id AND rides.rider_id = auth.uid())
        );
    END IF;
END $$;


-- ============================================================
-- PHASE 4: CONCURRENCY LOCKDOWN
-- ============================================================

CREATE OR REPLACE FUNCTION accept_ride_offer(p_offer_id UUID) RETURNS BOOLEAN AS $$
DECLARE
    v_offer RECORD;
    v_ride_id UUID;
    v_ride_status public.ride_status;
BEGIN
    SELECT * INTO v_offer FROM ride_offers WHERE id = p_offer_id FOR UPDATE;
    IF v_offer IS NULL OR v_offer.status != 'pending' THEN RETURN FALSE; END IF;
    v_ride_id := v_offer.ride_id;
    SELECT status INTO v_ride_status FROM rides WHERE id = v_ride_id FOR UPDATE;
    IF v_ride_status != 'searching' AND v_ride_status != 'requested' THEN RETURN FALSE; END IF;
    UPDATE ride_offers SET status = 'accepted' WHERE id = p_offer_id;
    UPDATE ride_offers SET status = 'expired' WHERE ride_id = v_ride_id AND id != p_offer_id;
    UPDATE rides SET driver_id = v_offer.driver_id, status = 'assigned', updated_at = now() WHERE id = v_ride_id;
    UPDATE drivers SET status = 'busy' WHERE id = v_offer.driver_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- PHASE 5: DRIVER UPDATE PERMISSIONS
-- ============================================================

DROP POLICY IF EXISTS "Drivers update assigned rides" ON public.rides;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Drivers update status only' AND tablename = 'rides') THEN
        CREATE POLICY "Drivers update status only" ON public.rides 
        FOR UPDATE TO authenticated 
        USING (driver_id = auth.uid())
        WITH CHECK (driver_id = auth.uid());
    END IF;
END $$;

CREATE OR REPLACE FUNCTION prevent_driver_critical_edits() RETURNS TRIGGER AS $$
BEGIN
    IF (auth.uid() = OLD.driver_id) THEN
        IF NEW.total_fare_cents IS DISTINCT FROM OLD.total_fare_cents THEN RAISE EXCEPTION 'Drivers cannot edit fare'; END IF;
        IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN RAISE EXCEPTION 'Drivers cannot edit rider_id'; END IF;
        IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN RAISE EXCEPTION 'Drivers cannot edit payment status'; END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_driver_edits ON public.rides;
CREATE TRIGGER trg_prevent_driver_edits 
    BEFORE UPDATE ON public.rides 
    FOR EACH ROW EXECUTE FUNCTION prevent_driver_critical_edits();


-- ============================================================
-- PHASE 9: SAFETY STRUCTURE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES rides(id),
    sender_id UUID REFERENCES auth.users(id),
    location GEOGRAPHY(POINT, 4326),
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.incident_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES auth.users(id),
    offender_id UUID REFERENCES auth.users(id),
    ride_id UUID REFERENCES rides(id),
    category TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
