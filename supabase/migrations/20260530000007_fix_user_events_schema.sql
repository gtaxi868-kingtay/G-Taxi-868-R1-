-- Fix the schema mismatch causing ride crashes
-- Renaming 'metadata' to 'payload' to match the existing edge function code
-- Adding 'metadata' back as a separate column for future-proofing
ALTER TABLE public.user_events 
RENAME COLUMN metadata TO payload;

ALTER TABLE public.user_events 
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

