-- G-TAXI HARDENING: Fix 6 - Mutual Blacklist
-- Infrastructure to ensure toxic matches never recur.

-- 1. Create blacklists table
CREATE TABLE IF NOT EXISTS public.blacklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- The person blocking
    blocked_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- The person being blocked
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, blocked_user_id)
);

-- 2. Indexes for fast lookup
CREATE INDEX idx_blacklists_user ON public.blacklists(user_id);
CREATE INDEX idx_blacklists_blocked ON public.blacklists(blocked_user_id);

-- 3. RLS Policies
ALTER TABLE public.blacklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own blacklist" ON public.blacklists 
    FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Service role full access blacklists" ON public.blacklists 
    FOR ALL TO service_role USING (true) WITH CHECK (true);
