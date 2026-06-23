-- Carnival / Fete Vertical
-- Mas band profiles, fete events, NFC keychain mapping, revshare tracking.
-- Each tap of a band-issued NFC keychain links rider -> band -> fete ride.

-- 1. CARNIVAL BANDS
CREATE TABLE IF NOT EXISTS public.carnival_bands (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    description      TEXT DEFAULT '',
    logo_url         TEXT DEFAULT '',
    contact_email    TEXT DEFAULT '',
    website_url      TEXT DEFAULT '',
    revshare_percent INTEGER NOT NULL DEFAULT 5 CHECK (revshare_percent >= 0 AND revshare_percent <= 100),
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. FETE EVENTS
CREATE TABLE IF NOT EXISTS public.carnival_events (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    band_id            UUID NOT NULL REFERENCES public.carnival_bands(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    description        TEXT DEFAULT '',
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

-- 3. BAND KEYCHAINS (NFC tags pre-programmed to a band)
CREATE TABLE IF NOT EXISTS public.band_keychains (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    band_id    UUID NOT NULL REFERENCES public.carnival_bands(id) ON DELETE CASCADE,
    tag_uid    TEXT NOT NULL UNIQUE,
    label      TEXT DEFAULT '',
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. BAND MEMBERS (rider -> band membership via keychain tap)
CREATE TABLE IF NOT EXISTS public.band_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    band_id     UUID NOT NULL REFERENCES public.carnival_bands(id) ON DELETE CASCADE,
    keychain_id UUID REFERENCES public.band_keychains(id) ON DELETE SET NULL,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (rider_id, band_id)
);

-- 5. BAND REVSHARE LEDGER (per-ride revshare earned by the band)
CREATE TABLE IF NOT EXISTS public.band_revshare_ledger (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id        UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    band_id        UUID NOT NULL REFERENCES public.carnival_bands(id) ON DELETE CASCADE,
    event_id       UUID REFERENCES public.carnival_events(id) ON DELETE SET NULL,
    rider_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fare_cents     INTEGER NOT NULL DEFAULT 0,
    revshare_cents INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_carnival_events_band ON public.carnival_events(band_id);
CREATE INDEX IF NOT EXISTS idx_carnival_events_date ON public.carnival_events(event_date);
CREATE INDEX IF NOT EXISTS idx_band_keychains_tag ON public.band_keychains(tag_uid);
CREATE INDEX IF NOT EXISTS idx_band_members_rider ON public.band_members(rider_id);
CREATE INDEX IF NOT EXISTS idx_band_members_band ON public.band_members(band_id);
CREATE INDEX IF NOT EXISTS idx_band_revshare_ride ON public.band_revshare_ledger(ride_id);
CREATE INDEX IF NOT EXISTS idx_band_revshare_band ON public.band_revshare_ledger(band_id);

-- UPDATED_AT TRIGGERS
CREATE OR REPLACE FUNCTION public.update_carnival_bands_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_carnival_bands_updated_at ON public.carnival_bands;
CREATE TRIGGER trg_carnival_bands_updated_at
    BEFORE UPDATE ON public.carnival_bands
    FOR EACH ROW EXECUTE FUNCTION public.update_carnival_bands_updated_at();

DROP TRIGGER IF EXISTS trg_carnival_events_updated_at ON public.carnival_events;
CREATE TRIGGER trg_carnival_events_updated_at
    BEFORE UPDATE ON public.carnival_events
    FOR EACH ROW EXECUTE FUNCTION public.update_carnival_bands_updated_at();

-- RLS
ALTER TABLE public.carnival_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carnival_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_keychains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_revshare_ledger ENABLE ROW LEVEL SECURITY;

-- Carnival bands: public read, admin write
CREATE POLICY "Carnival bands are publicly readable"
    ON public.carnival_bands FOR SELECT
    USING (true);

CREATE POLICY "Admins can manage carnival bands"
    ON public.carnival_bands FOR ALL
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- Carnival events: public read for active events, admin write
CREATE POLICY "Active carnival events are publicly readable"
    ON public.carnival_events FOR SELECT
    USING (is_active = true);

CREATE POLICY "Admins can manage carnival events"
    ON public.carnival_events FOR ALL
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- Band keychains: admin only (security by obscurity)
CREATE POLICY "Admins can manage band keychains"
    ON public.band_keychains FOR ALL
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- Band members: user reads own, admin reads all
CREATE POLICY "Users can read their own band memberships"
    ON public.band_members FOR SELECT
    USING (rider_id = auth.uid());

CREATE POLICY "Users can join a band"
    ON public.band_members FOR INSERT
    WITH CHECK (rider_id = auth.uid());

CREATE POLICY "Admins can manage all band memberships"
    ON public.band_members FOR ALL
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- Band revshare: users read own, admin reads all
CREATE POLICY "Users can read their band revshare"
    ON public.band_revshare_ledger FOR SELECT
    USING (rider_id = auth.uid());

CREATE POLICY "Admins can manage band revshare"
    ON public.band_revshare_ledger FOR ALL
    USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

-- FEATURE FLAG
INSERT INTO public.system_feature_flags (id, is_active, description)
VALUES ('carnival_active', false, 'Carnival/fete vertical -- band keychain NFC, fetes, revshare')
ON CONFLICT (id) DO NOTHING;

-- SEED: major T&T carnival bands
INSERT INTO public.carnival_bands (name, description, revshare_percent) VALUES
    ('TRIBE', 'TRIBE Carnival -- The Ultimate Carnival Experience', 5),
    ('BLISS', 'BLISS Carnival -- Feel the Energy', 5),
    ('Harts', 'Harts Carnival -- Where Art Meets Carnival', 5),
    ('Paparazzi', 'Paparazzi Carnival -- Picture Perfect', 5),
    ('Lost Tribe', 'Lost Tribe -- Find Yourself in the Music', 5),
    ('Yuma', 'Yuma Carnival -- Caribbean Soul', 5),
    ('Genesis', 'Genesis Carnival -- The Beginning of Greatness', 5),
    ('Legacy', 'Legacy Carnival -- Built for the Culture', 5)
ON CONFLICT DO NOTHING;

-- ADMIN RPCS

CREATE OR REPLACE FUNCTION public.admin_get_carnival_bands()
RETURNS SETOF public.carnival_bands
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.carnival_bands ORDER BY name;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_carnival_band(
  p_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL,
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
    UPDATE public.carnival_bands SET
      name = COALESCE(p_name, name),
      description = COALESCE(p_description, description),
      logo_url = COALESCE(p_logo_url, logo_url),
      contact_email = COALESCE(p_contact_email, contact_email),
      website_url = COALESCE(p_website_url, website_url),
      revshare_percent = COALESCE(p_revshare_percent, revshare_percent),
      is_active = COALESCE(p_is_active, is_active)
    WHERE id = p_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.carnival_bands (name, description, logo_url, contact_email, website_url, revshare_percent, is_active)
    VALUES (p_name, COALESCE(p_description, ''), COALESCE(p_logo_url, ''), COALESCE(p_contact_email, ''), COALESCE(p_website_url, ''), COALESCE(p_revshare_percent, 5), COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_carnival_events(p_band_id UUID DEFAULT NULL)
RETURNS SETOF public.carnival_events
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_band_id IS NOT NULL THEN
    RETURN QUERY SELECT * FROM public.carnival_events WHERE band_id = p_band_id ORDER BY event_date;
  ELSE
    RETURN QUERY SELECT * FROM public.carnival_events ORDER BY event_date;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_carnival_event(
  p_id UUID DEFAULT NULL,
  p_band_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
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
    UPDATE public.carnival_events SET
      band_id = COALESCE(p_band_id, band_id),
      name = COALESCE(p_name, name),
      description = COALESCE(p_description, description),
      venue = COALESCE(p_venue, venue),
      lat = COALESCE(p_lat, lat),
      lng = COALESCE(p_lng, lng),
      event_date = COALESCE(p_event_date, event_date),
      ticket_price_cents = COALESCE(p_ticket_price_cents, ticket_price_cents),
      ticket_url = COALESCE(p_ticket_url, ticket_url),
      is_active = COALESCE(p_is_active, is_active)
    WHERE id = p_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.carnival_events (band_id, name, description, venue, lat, lng, event_date, ticket_price_cents, ticket_url, is_active)
    VALUES (p_band_id, p_name, COALESCE(p_description, ''), COALESCE(p_venue, ''), p_lat, p_lng, p_event_date, COALESCE(p_ticket_price_cents, 0), COALESCE(p_ticket_url, ''), COALESCE(p_is_active, true))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_band_keychain(
  p_band_id UUID,
  p_tag_uid TEXT,
  p_label TEXT DEFAULT ''
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
  INSERT INTO public.band_keychains (band_id, tag_uid, label)
  VALUES (p_band_id, p_tag_uid, COALESCE(p_label, ''))
  ON CONFLICT (tag_uid) DO UPDATE SET band_id = p_band_id, label = COALESCE(p_label, band_keychains.label)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_band_revshare(
  p_band_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, ride_id UUID, band_id UUID, event_id UUID, rider_id UUID, fare_cents INTEGER, revshare_cents INTEGER, status TEXT, created_at TIMESTAMPTZ, rider_email TEXT, band_name TEXT, event_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT rl.id, rl.ride_id, rl.band_id, rl.event_id, rl.rider_id, rl.fare_cents, rl.revshare_cents, rl.status, rl.created_at,
         p.email AS rider_email, cb.name AS band_name, ce.name AS event_name
  FROM public.band_revshare_ledger rl
  LEFT JOIN public.profiles p ON p.id = rl.rider_id
  LEFT JOIN public.carnival_bands cb ON cb.id = rl.band_id
  LEFT JOIN public.carnival_events ce ON ce.id = rl.event_id
  WHERE (p_band_id IS NULL OR rl.band_id = p_band_id)
    AND (p_status IS NULL OR rl.status = p_status)
  ORDER BY rl.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_toggle_carnival_flag()
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
  WHERE id = 'carnival_active'
  RETURNING is_active INTO v_active;
  RETURN v_active;
END;
$$;
