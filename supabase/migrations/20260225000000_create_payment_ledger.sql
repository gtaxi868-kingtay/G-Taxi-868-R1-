-- Migration: 20260225000000_create_payment_ledger.sql
-- Phase 3 Fix 3.1 — Create payment_ledger table
-- This table is the canonical record of all payment events.
-- Written to by server-side RPCs only (no direct user inserts).
--
-- NOTE: DROP … CASCADE ensures a stale table from a previously-failed run
-- does not silently block re-creation via IF NOT EXISTS, which would leave
-- the table with the wrong schema and cause policy column-not-found errors.

BEGIN;
-- Drop any stale version so this migration is safe to re-run.
DROP TABLE IF EXISTS public.payment_ledger CASCADE;
CREATE TABLE public.payment_ledger (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id          UUID NOT NULL REFERENCES public.rides(id),
    user_id          UUID NOT NULL REFERENCES public.profiles(id),
    amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    currency         TEXT NOT NULL DEFAULT 'TTD',
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'refunded')),
    provider         TEXT NOT NULL DEFAULT 'wallet'
                       CHECK (provider IN ('wallet', 'stripe', 'cash')),
    provider_ref     TEXT,
    stripe_event_id  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;
-- Users can only read their own ledger entries.
CREATE POLICY "Users view own ledger entries" ON public.payment_ledger
    FOR SELECT USING (auth.uid() = user_id);
-- No user should ever insert directly — only server-side RPCs (SECURITY DEFINER) write here.
CREATE POLICY "No direct inserts by users" ON public.payment_ledger
    FOR INSERT WITH CHECK (false);
-- Indexes for common query patterns.
CREATE INDEX idx_payment_ledger_ride ON public.payment_ledger(ride_id);
CREATE INDEX idx_payment_ledger_user ON public.payment_ledger(user_id);
COMMIT;
