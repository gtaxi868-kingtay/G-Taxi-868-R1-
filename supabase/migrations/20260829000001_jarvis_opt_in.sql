-- Add memory opt-in flag for privacy compliance
ALTER TABLE user_psychological_profiles 
ADD COLUMN IF NOT EXISTS memory_opt_in BOOLEAN DEFAULT FALSE;

-- Update the RPC to respect the opt-in flag
CREATE OR REPLACE FUNCTION update_user_memory(
    p_user_id UUID,
    p_like TEXT DEFAULT NULL,
    p_dislike TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_opt_in BOOLEAN;
BEGIN
    -- Security check: Ensure the caller is either the user themselves or a service role
    IF current_setting('request.jwt.claim.role', true) != 'service_role' AND auth.uid() != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: You can only update your own memory profile.';
    END IF;

    -- Create base profile if it doesn't exist (still false for opt_in by default)
    INSERT INTO user_psychological_profiles (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    -- Check if user has opted in
    SELECT memory_opt_in INTO v_opt_in 
    FROM user_psychological_profiles 
    WHERE user_id = p_user_id;

    IF v_opt_in != TRUE THEN
        RAISE EXCEPTION 'Privacy Error: User has not opted in to memory tracking.';
    END IF;

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

-- Function to allow agent to toggle opt-in when user agrees
CREATE OR REPLACE FUNCTION enable_memory_tracking(p_user_id UUID) 
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF current_setting('request.jwt.claim.role', true) != 'service_role' AND auth.uid() != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    INSERT INTO user_psychological_profiles (user_id, memory_opt_in)
    VALUES (p_user_id, TRUE)
    ON CONFLICT (user_id) DO UPDATE 
    SET memory_opt_in = TRUE, updated_at = NOW();
END;
$$;
