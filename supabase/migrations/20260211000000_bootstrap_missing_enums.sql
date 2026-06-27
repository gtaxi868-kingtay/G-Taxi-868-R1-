-- BASELINE BOOTSTRAP — create enum types that exist in prod but were never
-- created by any committed migration (historical out-of-band drift). Without
-- these, a from-scratch replay (Supabase branching preview / fresh clone) fails,
-- e.g. 20260216010000_secure_payment_rpc.sql references public.payment_status_enum.
--
-- Sorts FIRST (20260211 < 20260212 baseline) so the types exist before first use.
-- Each guarded with duplicate_object catch => idempotent: creates on a fresh DB,
-- no-ops on prod where the types already exist (safe for `supabase db push`).
--
-- Definitions captured verbatim from prod (project ffbbuafgeypvkpcuvdnv) 2026-07-01.

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('rider', 'driver', 'admin', 'pod_commander', 'merchant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status_enum AS ENUM ('pending', 'authorized', 'captured', 'failed', 'refunded', 'confirmed', 'receipt_sent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_method_enum AS ENUM ('card', 'cash', 'wallet');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_status_type AS ENUM ('proposed', 'countered', 'signed', 'active', 'vested', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ledger_party AS ENUM ('escrow', 'platform_profit', 'trinidad_driver', 'tobago_driver', 'airline_block', 'villa_merchant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.settlement_method AS ENUM ('wipay_debit', 'smart_atm', 'bank_transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.split_session_status AS ENUM ('pending', 'collecting', 'confirmed', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
