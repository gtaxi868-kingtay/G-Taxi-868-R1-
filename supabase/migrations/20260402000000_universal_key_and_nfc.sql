-- 🎫 G-TAXI UNIVERSAL KEY & NFC IDENTITY SCHEMA
-- This migration builds the 'Physical-Digital' bridge for the 868.

-- 1. ENFORCE GLOBAL GUARD RAIL (National ID Hash)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS national_id_hash TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id);
COMMENT ON COLUMN profiles.national_id_hash IS 'Hashed National ID used to link Rider, Driver, and Merchant roles for debt enforcement.';

-- 2. IDENTITY TAGS (The Physical Pillar)
CREATE TABLE IF NOT EXISTS identity_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tag_uid TEXT UNIQUE NOT NULL,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    tag_type TEXT CHECK (tag_type IN ('RIDER', 'DRIVER', 'MERCHANT')),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_tapped_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_identity_tags_uid ON identity_tags(tag_uid);
CREATE INDEX idx_identity_tags_profile ON identity_tags(profile_id);

-- 3. MERCHANT API KEYS (The Digital Glue)
CREATE TABLE IF NOT EXISTS merchant_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    key_hash TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    scopes TEXT[] DEFAULT '{ride:summon, order:read}'::text[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_merchant_keys_merchant ON merchant_api_keys(merchant_id);

-- 4. RLS SEMANTIC LOCKDOWN
ALTER TABLE identity_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_api_keys ENABLE ROW LEVEL SECURITY;

-- Profiles can see their own tags
CREATE POLICY "Users can view own identity tags" ON identity_tags
    FOR SELECT USING (auth.uid() = profile_id);

-- Merchants can see their own API keys
CREATE POLICY "Merchants can view own API keys" ON merchant_api_keys
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.merchant_id = merchant_api_keys.merchant_id
        )
    );

-- 5. THE AUTO-FORCLOSURE FUNCTION (Debt Bridge)
CREATE OR REPLACE FUNCTION check_global_debt_blocking()
RETURNS TRIGGER AS $$
BEGIN
    -- If a user has a balance < -$50.00 TTD ($5000 cents), block them.
    -- This check happens across all apps hitting the database.
    IF EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = NEW.rider_id -- for rides/orders table
        AND balance_cents < -5000
    ) THEN
        RAISE EXCEPTION 'GLOBAL_DEBT_BLOCK: Account suspended across all G-Taxi services. Settle outstanding balance to resume.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to rides and orders
CREATE TRIGGER tr_check_debt_on_ride 
BEFORE INSERT ON rides 
FOR EACH ROW EXECUTE FUNCTION check_global_debt_blocking();

CREATE TRIGGER tr_check_debt_on_order 
BEFORE INSERT ON orders 
FOR EACH ROW EXECUTE FUNCTION check_global_debt_blocking();
