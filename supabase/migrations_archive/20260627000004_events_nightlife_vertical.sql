-- Events & Nightlife Vertical
-- Generalizes the carnival/fete system to support ALL event types:
--   fetes, concerts, parties, bar nights, sports, festivals.
-- Carnival bands become a subset of event_organizers (is_band = true).
--
-- ── RELATIONSHIP TO EXISTING CARNIVAL TABLES ───────────────────────────────
-- carnival_events + carnival_bands + band_revshare_ledger STAY unchanged.
-- This migration adds NEW tables alongside them. Carnival tables remain the
-- canonical source for band-specific data. The new events tables handle
-- everything else (promoters, concerts, general nightlife).
-- When an event is carnival-related, events.band_id references carnival_bands.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. EVENT ORGANIZERS --------------------------------------------------------
-- Generalizes carnival_bands. A promoter, venue owner, or event company.
-- Carnival bands are flagged with is_band = true.
CREATE TABLE IF NOT EXISTS public.event_organizers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    description      TEXT DEFAULT '',
    logo_url         TEXT DEFAULT '',
    contact_email    TEXT DEFAULT '',
    website_url      TEXT DEFAULT '',
    is_band          BOOLEAN NOT NULL DEFAULT false,
    revshare_percent INTEGER NOT NULL DEFAULT 5 CHECK (revshare_percent >= 0 AND revshare_percent <= 100),
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. EVENTS ------------------------------------------------------------------
-- Generalizes carnival_events. Every event type: fete, concert, party, bar,
-- sports, festival. Optionally linked to a carnival band via band_id.
CREATE TABLE IF NOT EXISTS public.events (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizer_id       UUID REFERENCES public.event_organizers(id) ON DELETE CASCADE,
    band_id            UUID REFERENCES public.carnival_bands(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    description        TEXT DEFAULT '',
    event_type         TEXT NOT NULL DEFAULT 'fete'
                       CHECK (event_type IN ('fete','concert','party','bar','festival','sports','cultural','other')),
    category           TEXT NOT NULL DEFAULT 'nightlife'
                       CHECK (category IN ('carnival','music','nightlife','sports','cultural','food','other')),
    venue              TEXT DEFAULT '',
    lat                DOUBLE PRECISION,
    lng                DOUBLE PRECISION,
    event_date         TIMESTAMPTZ NOT NULL,
    ticket_price_cents INTEGER DEFAULT 0,
    ticket_url         TEXT DEFAULT '',
    is_active          BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. EVENT REVSHARE LEDGER ---------------------------------------------------
-- Generalizes band_revshare_ledger. Tracks per-ride revshare earned by any
-- event organizer (band, promoter, venue).
CREATE TABLE IF NOT EXISTS public.event_revshare_ledger (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id          UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    organizer_id     UUID NOT NULL REFERENCES public.event_organizers(id) ON DELETE CASCADE,
    event_id         UUID REFERENCES public.events(id) ON DELETE SET NULL,
    rider_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fare_cents       INTEGER NOT NULL DEFAULT 0,
    revshare_cents   INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'cancelled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_events_organizer ON public.events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON public.events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_type ON public.events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_category ON public.events(category);
CREATE INDEX IF NOT EXISTS idx_event_organizers_band ON public.event_organizers(id) WHERE is_band = true;
CREATE INDEX IF NOT EXISTS idx_event_revshare_organizer ON public.event_revshare_ledger(organizer_id);
CREATE INDEX IF NOT EXISTS idx_event_revshare_ride ON public.event_revshare_ledger(ride_id);

-- UPDATED_AT TRIGGERS
CREATE OR REPLACE FUNCTION public.update_event_organizers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_organizers_updated_at ON public.event_organizers;
CREATE TRIGGER trg_event_organizers_updated_at
    BEFORE UPDATE ON public.event_organizers
    FOR EACH ROW EXECUTE FUNCTION public.update_event_organizers_updated_at();

DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;
CREATE TRIGGER trg_events_updated_at
    BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION public.update_event_organizers_updated_at();

-- RLS
ALTER TABLE public.event_organizers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_revshare_ledger ENABLE ROW LEVEL SECURITY;

-- Event organizers: public read, admin write
CREATE POLICY "Event organizers are publicly readable"
    ON public.event_organizers FOR SELECT
    USING (true);

CREATE POLICY "Admins can manage event organizers"
    ON public.event_organizers FOR ALL
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- Events: public read for active events, admin write
CREATE POLICY "Active events are publicly readable"
    ON public.events FOR SELECT
    USING (is_active = true);

CREATE POLICY "Admins can manage events"
    ON public.events FOR ALL
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- Event revshare: users read own, admin reads all
CREATE POLICY "Users can read their event revshare"
    ON public.event_revshare_ledger FOR SELECT
    USING (rider_id = auth.uid());

CREATE POLICY "Admins can manage event revshare"
    ON public.event_revshare_ledger FOR ALL
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- FEATURE FLAG
INSERT INTO public.system_feature_flags (id, is_active, description)
VALUES ('events_active', false, 'Events & Nightlife vertical -- concerts, parties, bar nights, festivals')
ON CONFLICT (id) DO NOTHING;

-- VERTICAL SETTINGS
INSERT INTO public.vertical_settings (vertical_name, display_name, is_enabled, enabled_regions,
    requires_subscription, commission_rate_percent, icon_name, sort_order, config)
VALUES (
    'events',
    'Events & Nightlife',
    false,
    '{}',
    false,
    12,
    'calendar',
    8,
    '{"tagline": "Fetes, concerts & nightlife", "revshare_pct": 5, "driver_split_pct": 81}'
)
ON CONFLICT (vertical_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    commission_rate_percent = EXCLUDED.commission_rate_percent,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order,
    config = EXCLUDED.config,
    updated_at = now();

-- SEED: copy existing carnival bands into event_organizers
INSERT INTO public.event_organizers (name, description, is_band, revshare_percent, is_active)
SELECT name, description, true, revshare_percent, is_active
FROM public.carnival_bands
ON CONFLICT DO NOTHING;

-- SEED: real T&T fete promoters & nightlife organizers
INSERT INTO public.event_organizers (name, description, is_band, revshare_percent, is_active) VALUES
    ('Dream Team', 'Premier fete promoters -- Section X, Dream Weekend', false, 5, true),
    ('Xtreme Events', 'Xcess, Xtreme, and the biggest carnival fetes', false, 5, true),
    ('ISL Events', 'Island Social Life -- Sea, Lime & Soca', false, 5, true),
    ('Soka In Moka', 'The iconic pre-carnival event series', false, 5, true),
    ('Pure Entertainment', 'Pure Fete, Pure Soca, Pure Vibes', false, 5, true),
    ('FeteU', 'Student-friendly fetes across T&T', false, 5, true),
    ('Kaiso Events', 'Calypso tents and cultural events', false, 5, true),
    ('TriniJazz', 'Annual Trinidad & Tobago Jazz Experience', false, 3, true)
ON CONFLICT DO NOTHING;

-- ADMIN RPCS

CREATE OR REPLACE FUNCTION public.admin_get_organizers(p_include_bands BOOLEAN DEFAULT true)
RETURNS SETOF public.event_organizers
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_include_bands THEN
    RETURN QUERY SELECT * FROM public.event_organizers ORDER BY name;
  ELSE
    RETURN QUERY SELECT * FROM public.event_organizers WHERE is_band = false ORDER BY name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_organizer(
  p_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL,
  p_is_band BOOLEAN DEFAULT NULL,
  p_revshare_percent INTEGER DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.event_organizers SET
      name = COALESCE(p_name, name),
      description = COALESCE(p_description, description),
      logo_url = COALESCE(p_logo_url, logo_url),
      contact_email = COALESCE(p_contact_email, contact_email),
      website_url = COALESCE(p_website_url, website_url),
      is_band = COALESCE(p_is_band, is_band),
      revshare_percent = COALESCE(p_revshare_percent, revshare_percent),
      is_active = COALESCE(p_is_active, is_active)
    WHERE id = p_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.event_organizers (name, description, logo_url, contact_email, website_url, is_band, revshare_percent, is_active)
    VALUES (p_name, COALESCE(p_description, ''), COALESCE(p_logo_url, ''), COALESCE(p_contact_email, ''), COALESCE(p_website_url, ''), COALESCE(p_is_band, false), COALESCE(p_revshare_percent, 5), COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_events(
  p_organizer_id UUID DEFAULT NULL,
  p_event_type TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS SETOF public.events
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.events
    WHERE (p_organizer_id IS NULL OR organizer_id = p_organizer_id)
      AND (p_event_type IS NULL OR event_type = p_event_type)
      AND (p_category IS NULL OR category = p_category)
    ORDER BY event_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_event(
  p_id UUID DEFAULT NULL,
  p_organizer_id UUID DEFAULT NULL,
  p_band_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_event_type TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_venue TEXT DEFAULT NULL,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_event_date TIMESTAMPTZ DEFAULT NULL,
  p_ticket_price_cents INTEGER DEFAULT NULL,
  p_ticket_url TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.events SET
      organizer_id = COALESCE(p_organizer_id, organizer_id),
      band_id = COALESCE(p_band_id, band_id),
      name = COALESCE(p_name, name),
      description = COALESCE(p_description, description),
      event_type = COALESCE(p_event_type, event_type),
      category = COALESCE(p_category, category),
      venue = COALESCE(p_venue, venue),
      lat = COALESCE(p_lat, lat),
      lng = COALESCE(p_lng, lng),
      event_date = COALESCE(p_event_date, event_date),
      ticket_price_cents = COALESCE(p_ticket_price_cents, ticket_price_cents),
      ticket_url = COALESCE(p_ticket_url, ticket_url),
      is_active = COALESCE(p_is_active, is_active)
    WHERE id = p_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.events (organizer_id, band_id, name, description, event_type, category, venue, lat, lng, event_date, ticket_price_cents, ticket_url, is_active)
    VALUES (p_organizer_id, p_band_id, p_name, COALESCE(p_description, ''), COALESCE(p_event_type, 'fete'), COALESCE(p_category, 'nightlife'), COALESCE(p_venue, ''), p_lat, p_lng, p_event_date, COALESCE(p_ticket_price_cents, 0), COALESCE(p_ticket_url, ''), COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_toggle_events_flag()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_active BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  UPDATE public.system_feature_flags
  SET is_active = NOT is_active, updated_at = now()
  WHERE id = 'events_active'
  RETURNING is_active INTO v_active;
  RETURN v_active;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_organizer_revshare(
  p_organizer_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, ride_id UUID, organizer_id UUID, event_id UUID, rider_id UUID, fare_cents INTEGER, revshare_cents INTEGER, status TEXT, created_at TIMESTAMPTZ, rider_email TEXT, organizer_name TEXT, event_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT rl.id, rl.ride_id, rl.organizer_id, rl.event_id, rl.rider_id, rl.fare_cents, rl.revshare_cents, rl.status, rl.created_at,
         p.email AS rider_email, eo.name AS organizer_name, ev.name AS event_name
  FROM public.event_revshare_ledger rl
  LEFT JOIN public.profiles p ON p.id = rl.rider_id
  LEFT JOIN public.event_organizers eo ON eo.id = rl.organizer_id
  LEFT JOIN public.events ev ON ev.id = rl.event_id
  WHERE (p_organizer_id IS NULL OR rl.organizer_id = p_organizer_id)
    AND (p_status IS NULL OR rl.status = p_status)
  ORDER BY rl.created_at DESC;
END;
$$;
