-- Migration: 011_locations_table.sql
-- Creates a read-only public locations table for Trinidad with RLS

-- Create locations table
CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    category TEXT DEFAULT 'other',
    popularity_score INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique locations
    CONSTRAINT unique_location UNIQUE (name, address)
);

-- Create index for fast text search
CREATE INDEX IF NOT EXISTS idx_locations_name_search ON public.locations USING gin(to_tsvector('english', name || ' ' || address));
CREATE INDEX IF NOT EXISTS idx_locations_category ON public.locations (category);
CREATE INDEX IF NOT EXISTS idx_locations_popularity ON public.locations (popularity_score DESC);

-- Enable RLS
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-runs)
DROP POLICY IF EXISTS "locations_public_read" ON public.locations;
DROP POLICY IF EXISTS "locations_service_insert" ON public.locations;
DROP POLICY IF EXISTS "locations_service_update" ON public.locations;
DROP POLICY IF EXISTS "locations_service_delete" ON public.locations;

-- PUBLIC READ-ONLY policy (anyone can read, nobody can modify)
CREATE POLICY "locations_public_read" ON public.locations
    FOR SELECT
    USING (true);

-- Only service_role can insert/update/delete (for admin seeding)
CREATE POLICY "locations_service_insert" ON public.locations
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "locations_service_update" ON public.locations
    FOR UPDATE
    TO service_role
    USING (true);

CREATE POLICY "locations_service_delete" ON public.locations
    FOR DELETE
    TO service_role
    USING (true);

-- Seed with popular Trinidad locations
INSERT INTO public.locations (name, address, latitude, longitude, category, popularity_score) VALUES
-- Airports
('Piarco International Airport', 'Golden Grove Road, Piarco', 10.5956, -61.3372, 'airport', 100),
('ANR Robinson International Airport', 'Crown Point, Tobago', 11.1497, -60.8322, 'airport', 90),

-- Malls & Shopping
('Trincity Mall', 'Churchill Roosevelt Highway, Trincity', 10.6108, -61.3511, 'mall', 95),
('Gulf City Mall', 'South Trunk Road, La Romaine', 10.2833, -61.4667, 'mall', 90),
('West Mall', 'Western Main Road, Westmoorings', 10.6833, -61.5500, 'mall', 88),
('Long Circular Mall', 'Long Circular Road, St. James', 10.6667, -61.5333, 'mall', 85),
('Price Plaza Chaguanas', 'Price Plaza, Chaguanas', 10.5167, -61.4000, 'mall', 87),
('C3 Centre', 'Corinth, San Fernando', 10.2833, -61.4500, 'mall', 82),
('Ellerslie Plaza', 'Boissiere Village, Maraval', 10.6833, -61.5333, 'mall', 80),
('Grand Bazaar', 'Churchill Roosevelt Highway, Valsayn', 10.6333, -61.4000, 'mall', 75),
('Falls at West Mall', 'Western Main Road, Westmoorings', 10.6850, -61.5520, 'mall', 78),
('MovieTowne', 'Invaders Bay, Port of Spain', 10.6533, -61.5283, 'entertainment', 92),
('MovieTowne Chaguanas', 'Main Road, Chaguanas', 10.5200, -61.4100, 'entertainment', 85),

-- Hospitals & Medical
('Eric Williams Medical Sciences Complex', 'Uriah Butler Highway, Champ Fleurs', 10.6333, -61.4167, 'hospital', 95),
('Port of Spain General Hospital', 'Charlotte Street, Port of Spain', 10.6500, -61.5167, 'hospital', 93),
('San Fernando General Hospital', 'Independence Avenue, San Fernando', 10.2833, -61.4667, 'hospital', 90),
('Sangre Grande Hospital', 'Ojoe Road, Sangre Grande', 10.5833, -61.1333, 'hospital', 85),
('Arima Health Facility', 'Tumpuna Road, Arima', 10.6333, -61.2833, 'hospital', 80),
('West Shore Medical', 'Western Main Road, Cocorite', 10.6667, -61.5500, 'hospital', 88),
('St. Clair Medical Centre', 'Elizabeth Street, St. Clair', 10.6667, -61.5167, 'hospital', 85),
('Couva District Health Facility', 'Southern Main Road, Couva', 10.4167, -61.4500, 'hospital', 78),

-- Government & Civic
('Red House (Parliament)', 'Abercromby Street, Port of Spain', 10.6547, -61.5086, 'government', 90),
('Hall of Justice', 'Knox Street, Port of Spain', 10.6556, -61.5075, 'government', 88),
('Immigration Division', 'Frederick Street, Port of Spain', 10.6528, -61.5097, 'government', 85),
('Licensing Office Caroni', 'Factory Road, Chaguanas', 10.5167, -61.4000, 'government', 80),
('Licensing Office Frederick Street', 'Frederick Street, Port of Spain', 10.6528, -61.5097, 'government', 82),
('Arima Borough Corporation', 'Hollis Avenue, Arima', 10.6333, -61.2833, 'government', 75),
('San Fernando City Corporation', 'Harris Promenade, San Fernando', 10.2833, -61.4667, 'government', 78),

-- Universities & Education
('University of the West Indies St. Augustine', 'St. Augustine', 10.6417, -61.3997, 'education', 95),
('University of Trinidad and Tobago', 'Wallerfield, Arima', 10.6000, -61.2667, 'education', 88),
('COSTAATT', 'Champ Fleurs', 10.6333, -61.4167, 'education', 82),
('University of the Southern Caribbean', 'Maracas, St. Joseph', 10.6667, -61.4333, 'education', 78),

-- Beaches & Recreation
('Maracas Beach', 'North Coast Road, Maracas Bay', 10.7583, -61.4292, 'beach', 98),
('Las Cuevas Beach', 'North Coast Road, Las Cuevas', 10.7667, -61.3833, 'beach', 90),
('Tyrico Beach', 'North Coast Road, Tyrico Bay', 10.7667, -61.4000, 'beach', 85),
('Blanchisseuse Beach', 'Blanchisseuse Road, Blanchisseuse', 10.7833, -61.3167, 'beach', 80),
('Manzanilla Beach', 'Manzanilla Main Road, Manzanilla', 10.4833, -61.0333, 'beach', 82),
('Mayaro Beach', 'Mayaro Main Road, Mayaro', 10.2833, -61.0000, 'beach', 85),

-- Major Landmarks
('Queen''s Park Savannah', 'Queens Park West, Port of Spain', 10.6718, -61.5175, 'landmark', 98),
('Brian Lara Promenade', 'Independence Square, Port of Spain', 10.6500, -61.5103, 'landmark', 90),
('President''s House', 'Queens Park West, Port of Spain', 10.6750, -61.5200, 'landmark', 85),
('Magnificent Seven', 'Maraval Road, Port of Spain', 10.6750, -61.5167, 'landmark', 88),
('Caroni Bird Sanctuary', 'Butler Highway, Caroni', 10.5667, -61.4500, 'landmark', 82),
('Temple in the Sea', 'Waterloo, Carapichaima', 10.4333, -61.4833, 'landmark', 85),

-- Towns & Villages (Central Points)
('Port of Spain', 'Frederick Street, Downtown', 10.6603, -61.5086, 'town', 100),
('San Fernando', 'High Street, San Fernando', 10.2803, -61.4681, 'town', 95),
('Chaguanas', 'Main Road, Chaguanas', 10.5172, -61.4111, 'town', 93),
('Arima', 'Queen Street, Arima', 10.6325, -61.2833, 'town', 90),
('Sangre Grande', 'Eastern Main Road, Sangre Grande', 10.5833, -61.1306, 'town', 85),
('Point Fortin', 'Main Road, Point Fortin', 10.1833, -61.6833, 'town', 80),
('Siparia', 'High Street, Siparia', 10.1500, -61.5000, 'town', 78),
('Princes Town', 'High Street, Princes Town', 10.2667, -61.3667, 'town', 77),
('Scarborough', 'Main Street, Scarborough, Tobago', 11.1833, -60.7333, 'town', 88),
('Tunapuna', 'Eastern Main Road, Tunapuna', 10.6500, -61.3833, 'town', 82),
('Curepe', 'Southern Main Road, Curepe', 10.6333, -61.4000, 'town', 80),
('St. Augustine', 'Eastern Main Road, St. Augustine', 10.6417, -61.3997, 'town', 85),
('Diego Martin', 'Diego Martin Main Road', 10.7000, -61.5667, 'town', 82),
('Maraval', 'Maraval Road, Maraval', 10.6833, -61.5333, 'town', 80),
('St. James', 'Western Main Road, St. James', 10.6667, -61.5333, 'town', 83),
('Woodbrook', 'Ariapita Avenue, Woodbrook', 10.6583, -61.5250, 'town', 85),
('Debe', 'SS Erin Road, Debe', 10.2167, -61.4500, 'town', 72),
('Penal', 'Penal Main Road, Penal', 10.1667, -61.4667, 'town', 70),
('Rio Claro', 'Rio Claro Main Road, Rio Claro', 10.3000, -61.1833, 'town', 68),
('Couva', 'Southern Main Road, Couva', 10.4167, -61.4667, 'town', 78),
('Claxton Bay', 'Southern Main Road, Claxton Bay', 10.3500, -61.4667, 'town', 72),
('La Brea', 'Main Road, La Brea', 10.2333, -61.6167, 'town', 70),
('Fyzabad', 'High Street, Fyzabad', 10.1833, -61.5500, 'town', 72),
('Gasparillo', 'Southern Main Road, Gasparillo', 10.3167, -61.4333, 'town', 70),
('Cunupia', 'Munroe Road, Cunupia', 10.5500, -61.3833, 'town', 70),
('El Dorado', 'Golden Grove Road, Piarco', 10.6000, -61.3500, 'town', 72),
('Barataria', 'Eastern Main Road, Barataria', 10.6500, -61.4500, 'town', 75),
('San Juan', 'Eastern Main Road, San Juan', 10.6500, -61.4500, 'town', 78),

-- Hotels
('Hyatt Regency Trinidad', 'Wrightson Road, Port of Spain', 10.6500, -61.5167, 'hotel', 92),
('Marriott Port of Spain', 'Invaders Bay Tower, Port of Spain', 10.6533, -61.5283, 'hotel', 90),
('Hilton Trinidad', 'Lady Young Road, Port of Spain', 10.6667, -61.5000, 'hotel', 88),
('Kapok Hotel', 'Cotton Hill, St. Clair', 10.6700, -61.5200, 'hotel', 85),
('Radisson Hotel', 'Wrightson Road, Port of Spain', 10.6500, -61.5200, 'hotel', 82),
('Courtyard by Marriott', 'Invaders Bay, Port of Spain', 10.6533, -61.5283, 'hotel', 80),

-- Business Districts
('Independence Square', 'Independence Square, Port of Spain', 10.6500, -61.5103, 'business', 90),
('Long Circular Road', 'Long Circular Road, St. James', 10.6667, -61.5333, 'business', 82),
('Ariapita Avenue', 'Ariapita Avenue, Woodbrook', 10.6583, -61.5250, 'business', 85),
('Frederick Street', 'Frederick Street, Port of Spain', 10.6528, -61.5097, 'business', 88),
('Charlotte Street', 'Charlotte Street, Port of Spain', 10.6500, -61.5167, 'business', 80),
('Cross Crossing', 'Cross Crossing, San Fernando', 10.2833, -61.4667, 'business', 78),

-- Sports Venues
('Hasely Crawford Stadium', 'Mucurapo Road, Port of Spain', 10.6653, -61.5328, 'sports', 88),
('Queen''s Park Oval', 'Tragarete Road, Port of Spain', 10.6667, -61.5167, 'sports', 92),
('Dwight Yorke Stadium', 'Bacolet, Tobago', 11.1833, -60.7500, 'sports', 80),
('Ato Boldon Stadium', 'Balmain, Couva', 10.4167, -61.4500, 'sports', 85),
('Larry Gomes Stadium', 'Malabar, Arima', 10.6333, -61.2833, 'sports', 78),

-- Religious Sites
('Holy Trinity Cathedral', 'Abercromby Street, Port of Spain', 10.6547, -61.5086, 'religious', 80),
('ISKCON Temple', 'Longdenville, Chaguanas', 10.5000, -61.4167, 'religious', 75),
('Cathedral of the Immaculate Conception', 'Independence Square, Port of Spain', 10.6500, -61.5103, 'religious', 78),
('Jama Masjid Mosque', 'Queen Street, Port of Spain', 10.6528, -61.5097, 'religious', 75)

ON CONFLICT (name, address) DO NOTHING;

-- Create function for location search
CREATE OR REPLACE FUNCTION search_locations(search_term TEXT, result_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    name TEXT,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    category TEXT,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.id,
        l.name,
        l.address,
        l.latitude,
        l.longitude,
        l.category,
        ts_rank(to_tsvector('english', l.name || ' ' || l.address), plainto_tsquery('english', search_term)) AS rank
    FROM public.locations l
    WHERE 
        l.name ILIKE '%' || search_term || '%' 
        OR l.address ILIKE '%' || search_term || '%'
        OR to_tsvector('english', l.name || ' ' || l.address) @@ plainto_tsquery('english', search_term)
    ORDER BY 
        popularity_score DESC,
        rank DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to all (read-only function)
GRANT EXECUTE ON FUNCTION search_locations TO anon, authenticated;

COMMENT ON TABLE public.locations IS 'Read-only public table of Trinidad locations for search';
COMMENT ON FUNCTION search_locations IS 'Search locations by name or address, returns top matches by popularity';
