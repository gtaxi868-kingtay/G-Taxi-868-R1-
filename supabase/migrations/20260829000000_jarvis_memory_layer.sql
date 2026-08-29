-- Jarvis Memory Layer (AGY SDK)

-- Psychological profiles track user preferences, likes, dislikes, and habits
CREATE TABLE IF NOT EXISTS user_psychological_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    likes TEXT[] DEFAULT '{}',
    dislikes TEXT[] DEFAULT '{}',
    commute_habits JSONB DEFAULT '{}',
    risk_tolerance VARCHAR(50) DEFAULT 'moderate',
    loyalty_score NUMERIC DEFAULT 0,
    last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Market notes track broader business intelligence, trends, and M&A opportunities
CREATE TABLE IF NOT EXISTS market_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(100) NOT NULL, -- e.g., 'hotel_acquisition', 'competitor_pricing', 'traffic_trend'
    topic VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    confidence_score NUMERIC DEFAULT 0.0,
    source_url TEXT,
    created_by UUID REFERENCES auth.users(id), -- Nullable, since an agent might create it
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_psychological_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_notes ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own profile"
    ON user_psychological_profiles FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service roles can manage all profiles"
    ON user_psychological_profiles FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Service roles can manage market notes"
    ON market_notes FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- Create function to update user memory (callable by AGY agents)
CREATE OR REPLACE FUNCTION update_user_memory(
    p_user_id UUID,
    p_like TEXT DEFAULT NULL,
    p_dislike TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Security check: Ensure the caller is either the user themselves or a service role
    IF current_setting('request.jwt.claim.role', true) != 'service_role' AND auth.uid() != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: You can only update your own memory profile.';
    END IF;

    INSERT INTO user_psychological_profiles (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    IF p_like IS NOT NULL THEN
        UPDATE user_psychological_profiles
        SET likes = array_append(likes, p_like),
            updated_at = NOW()
        WHERE user_id = p_user_id AND NOT (likes @> ARRAY[p_like]);
    END IF;

    IF p_dislike IS NOT NULL THEN
        UPDATE user_psychological_profiles
        SET dislikes = array_append(dislikes, p_dislike),
            updated_at = NOW()
        WHERE user_id = p_user_id AND NOT (dislikes @> ARRAY[p_dislike]);
    END IF;
END;
$$;
