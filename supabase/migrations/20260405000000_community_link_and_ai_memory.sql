-- Migration: Phase 16 Community Link & Bigger AI Brain (pgvector + Laundry)

-- 1. Enable pgvector for Long-Term Memory
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- 2. Create User Memories Table (The "Bigger Brain")
CREATE TABLE IF NOT EXISTS public.user_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL, -- Assuming Gemini text-embedding-004 layout or similar
    memory_text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast semantic search (HNSW is best for large datasets, IVFFlat for smaller. We use HNSW)
CREATE INDEX ON public.user_memories USING hnsw (embedding vector_cosine_ops);

-- 3. Enhance Identity Shield / Link Awareness in Rides
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS is_family_ride BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ride_persona TEXT DEFAULT 'STANDARD'; -- e.g., 'GRANNY', 'BOSS', 'LUNCH'

-- 4. Rider-Side AI Order Intake (Laundry Friction Removal)
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS rider_intake_photo_url TEXT,
ADD COLUMN IF NOT EXISTS ai_generated_list JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS merchant_verification_status TEXT DEFAULT 'pending'; -- 'pending', 'verified', 'rejected_return'

-- Add tracking for returned items
ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS is_return_trip BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS original_order_id UUID REFERENCES public.orders(id);
