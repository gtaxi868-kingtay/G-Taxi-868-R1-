-- ── Escape group demand-aggregator tables ───────────────────────────────
-- 1. flight_cache:  Amadeus API snapshot for route/departure-date combos
-- 2. lodging_cache: Booking.com API snapshot for location/check-in combos
-- 3. escape_group_participants:  riders who join a package (intent → paid)
-- 4. passenger_details:          passport/ID collected post-confirmation
-- 5. group_booking_alerts:       admin fail-safe delay/reschedule log

-- ── 1. flight_cache ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flight_cache (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_code      TEXT NOT NULL,         -- POS, TAB, etc.
    destination_code TEXT NOT NULL,
    departure_date   DATE NOT NULL,
    flight_number    TEXT NOT NULL,
    airline_code     TEXT NOT NULL,          -- BW (Caribbean Airlines)
    departure_time   TIME NOT NULL,
    arrival_time     TIME NOT NULL,
    available_seats  INTEGER NOT NULL,
    fare_cents       INTEGER NOT NULL,       -- lowest available fare
    fare_class       TEXT NOT NULL DEFAULT 'economy',
    currency         TEXT NOT NULL DEFAULT 'TTD',
    raw_json         JSONB,                   -- full Amadeus response
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
    UNIQUE (origin_code, destination_code, departure_date, flight_number, fare_class)
);

CREATE INDEX idx_flight_cache_route ON public.flight_cache (origin_code, destination_code, departure_date);

-- ── 2. lodging_cache ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lodging_cache (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id       TEXT NOT NULL,          -- Booking.com property ID
    property_name     TEXT NOT NULL,
    location          TEXT NOT NULL,          -- city / area
    check_in_date     DATE NOT NULL,
    check_out_date    DATE NOT NULL,
    room_type         TEXT NOT NULL DEFAULT 'standard',
    available_rooms   INTEGER NOT NULL,
    price_per_night_cents INTEGER NOT NULL,
    currency          TEXT NOT NULL DEFAULT 'TTD',
    total_price_cents INTEGER NOT NULL,
    image_url         TEXT,
    rating            NUMERIC(2,1),           -- 1.0 - 5.0
    raw_json          JSONB,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '6 hours'),
    UNIQUE (external_id, check_in_date, check_out_date, room_type)
);

CREATE INDEX idx_lodging_cache_location ON public.lodging_cache (location, check_in_date);

-- ── 3. escape_group_participants ────────────────────────────────────────
-- Tracks each rider's intent → commitment → paid status for a package.
CREATE TYPE public.escape_participant_status AS ENUM (
    'intent_pending',     -- joined but not yet charged
    'payment_pending',    -- auto-charge attempted, awaiting confirmation
    'confirmed',          -- paid and booked
    'passport_pending',   -- paid, needs passport/ID to finalize
    'travel_ready',       -- all docs collected
    'cancelled',
    'refunded'
);

CREATE TABLE IF NOT EXISTS public.escape_group_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id      UUID NOT NULL REFERENCES public.escape_packages(id) ON DELETE CASCADE,
    rider_id        UUID NOT NULL REFERENCES auth.users(id),
    status          public.escape_participant_status NOT NULL DEFAULT 'intent_pending',
    party_size      INTEGER NOT NULL DEFAULT 1,
    time_preference TEXT,                    -- morning / afternoon / evening
    pickup_note     TEXT,                    -- airport pickup location
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    charged_at      TIMESTAMPTZ,
    confirmed_at    TIMESTAMPTZ,
    paid_cents      INTEGER NOT NULL DEFAULT 0,
    stripe_pi_id    TEXT,                    -- PaymentIntent ID when charged
    UNIQUE (package_id, rider_id)
);

CREATE INDEX idx_escape_participant_package ON public.escape_group_participants (package_id);
CREATE INDEX idx_escape_participant_rider ON public.escape_group_participants (rider_id);

-- ── 4. passenger_details ─────────────────────────────────────────────────
-- Collected AFTER payment confirmed — passport/ID needed for flight booking.
CREATE TABLE IF NOT EXISTS public.passenger_details (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id  UUID NOT NULL REFERENCES public.escape_group_participants(id) ON DELETE CASCADE,
    rider_id        UUID NOT NULL REFERENCES auth.users(id),
    full_name       TEXT NOT NULL,
    date_of_birth   DATE NOT NULL,
    nationality     TEXT NOT NULL DEFAULT 'TT',
    passport_number TEXT,
    passport_expiry DATE,
    id_type         TEXT DEFAULT 'passport',
    id_number       TEXT,
    emergency_name  TEXT,
    emergency_phone TEXT,
    dietary_notes   TEXT,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at     TIMESTAMPTZ,
    UNIQUE (participant_id)
);

-- ── 5. group_booking_alerts ───────────────────────────────────────────────
-- Admin fail-safe: delay notifications, reschedule requests, refund log.
CREATE TABLE IF NOT EXISTS public.group_booking_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id      UUID NOT NULL REFERENCES public.escape_packages(id) ON DELETE CASCADE,
    alert_type      TEXT NOT NULL CHECK (alert_type IN (
                        'delay', 'reschedule_request', 'reschedule_rider_initiated',
                        'reschedule_accepted', 'reschedule_declined',
                        'refund_initiated', 'refund_completed'
                    )),
    message         TEXT NOT NULL,
    created_by      UUID REFERENCES auth.users(id),
    acknowledged    BOOLEAN NOT NULL DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_group_booking_alerts_package ON public.group_booking_alerts (package_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.flight_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lodging_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escape_group_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passenger_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_booking_alerts ENABLE ROW LEVEL SECURITY;

-- Cache tables: readable by all authenticated users, writable only via edge functions (service_role)
CREATE POLICY "flight_cache_read_all" ON public.flight_cache FOR SELECT USING (true);
CREATE POLICY "lodging_cache_read_all" ON public.lodging_cache FOR SELECT USING (true);

-- Participants: rider sees own, admin sees all
CREATE POLICY "participants_own" ON public.escape_group_participants
    FOR SELECT USING (rider_id = auth.uid());
CREATE POLICY "participants_admin" ON public.escape_group_participants
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Passenger details: rider sees own, admin sees all
CREATE POLICY "passenger_own" ON public.passenger_details
    FOR SELECT USING (rider_id = auth.uid());
CREATE POLICY "passenger_admin" ON public.passenger_details
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Alerts: admin only
CREATE POLICY "alerts_admin" ON public.group_booking_alerts
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "alerts_read_rider" ON public.group_booking_alerts
    FOR SELECT USING (
        package_id IN (
            SELECT package_id FROM public.escape_group_participants WHERE rider_id = auth.uid()
        )
    );

-- ── Remove obsolete purchased_seat block from escape_packages ────────────
-- The group model replaces static allocated_guests with live participant tracking.
-- allocated_guests is now computed via a view rather than manually incremented.
-- No column changes needed — allocated_guests remains for backward compat.

NOTIFY pgrst, 'reload schema';
