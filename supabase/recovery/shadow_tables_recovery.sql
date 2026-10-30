-- =====================================================================
-- G868 SHADOW TABLES RECOVERY — reconstructed from the LIVE database
-- catalogues (information_schema.columns, pg_constraint, pg_index,
-- pg_trigger, pg_policies) on 2026-10-30. Project ffbbuafgeypvkpcuvdnv.
-- These 25 tables exist live but have NO CREATE TABLE anywhere in the
-- repo. USE ONLY on a fresh rebuild-from-repo, after repo migrations.
-- Column types use pg_catalog format_type (exact). Identity/generated
-- evidence and RLS policies are preserved; policies are reproduced as
-- catalog evidence comments plus the ENABLE statement — review them
-- before relying on the reconstruction for access control.
-- =====================================================================

-- ===== airport_coordinates =====
-- airport_coordinates — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."airport_coordinates" (
  "code" text NOT NULL,
  "name" text NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  CONSTRAINT "airport_coordinates_pkey" PRIMARY KEY (code)
);

-- RLS: not enabled on live table.


-- ===== carrier_policies =====
-- carrier_policies — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."carrier_policies" (
  "carrier_name" text NOT NULL,
  "name_submission_deadline_days" integer DEFAULT 32 NOT NULL,
  "min_group_size" integer DEFAULT 10,
  "notes" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "carrier_policies_min_group_size_check" CHECK ((min_group_size > 0)),
  CONSTRAINT "carrier_policies_name_submission_deadline_days_check" CHECK ((name_submission_deadline_days > 0)),
  CONSTRAINT "carrier_policies_pkey" PRIMARY KEY (carrier_name)
);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "carrier_policies_admin_read" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
ALTER TABLE public."carrier_policies" ENABLE ROW LEVEL SECURITY;

-- Trigger on live table (extracted via pg_get_triggerdef):
CREATE TRIGGER trg_normalize_carrier_name BEFORE INSERT OR UPDATE ON public.carrier_policies FOR EACH ROW EXECUTE FUNCTION normalize_carrier_name();


-- ===== cash_withdrawal_codes =====
-- cash_withdrawal_codes — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."cash_withdrawal_codes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "driver_id" uuid NOT NULL,
  "amount_cents" integer NOT NULL,
  "code" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "fee_cents" integer DEFAULT 0,
  "deducted_at" timestamp with time zone DEFAULT now(),
  "redeemed_at" timestamp with time zone,
  "redeemed_by" text,
  "redeemed_by_agent_id" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "cash_withdrawal_codes_amount_cents_check" CHECK ((amount_cents >= 5000)),
  CONSTRAINT "cash_withdrawal_codes_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'redeemed'::text, 'expired'::text, 'cancelled'::text]))),
  CONSTRAINT "cash_withdrawal_codes_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  CONSTRAINT "cash_withdrawal_codes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "cash_withdrawal_codes_pkey" PRIMARY KEY (id),
  CONSTRAINT "cash_withdrawal_codes_code_key" UNIQUE (code)
);
CREATE INDEX idx_cash_withdrawal_codes_code ON public.cash_withdrawal_codes USING btree (code);
CREATE INDEX idx_cash_withdrawal_codes_expires ON public.cash_withdrawal_codes USING btree (expires_at) WHERE (status = 'active'::text);
CREATE INDEX idx_cash_withdrawal_codes_status ON public.cash_withdrawal_codes USING btree (status);
CREATE INDEX idx_cash_withdrawal_codes_user ON public.cash_withdrawal_codes USING btree (user_id);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "cash_withdrawal_codes_self" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(user_id = auth.uid()) with_check=None
ALTER TABLE public."cash_withdrawal_codes" ENABLE ROW LEVEL SECURITY;


-- ===== commander_payout_accounts =====
-- commander_payout_accounts — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."commander_payout_accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "commander_id" uuid NOT NULL,
  "bank_name" text NOT NULL,
  "account_holder" text NOT NULL,
  "account_number" text NOT NULL,
  "account_type" text DEFAULT 'savings'::text,
  "routing_number" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "commander_payout_accounts_commander_id_fkey" FOREIGN KEY (commander_id) REFERENCES pod_commanders(id) ON DELETE CASCADE,
  CONSTRAINT "commander_payout_accounts_pkey" PRIMARY KEY (id),
  CONSTRAINT "commander_payout_accounts_commander_id_bank_name_key" UNIQUE (commander_id, bank_name)
);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "commander_payout_accounts_self" cmd=ALL permissive=PERMISSIVE roles={public} qual=(commander_id IN ( SELECT pod_commanders.id
   FROM pod_commanders
  WHERE (pod_commanders.user_id = auth.uid()))) with_check=(commander_id IN ( SELECT pod_commanders.id
   FROM pod_commanders
  WHERE (pod_commanders.user_id = auth.uid())))
ALTER TABLE public."commander_payout_accounts" ENABLE ROW LEVEL SECURITY;


-- ===== compliance_queue =====
-- compliance_queue — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."compliance_queue" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL,
  "document_type" text NOT NULL,
  "document_url" text NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now(),
  "status" text DEFAULT 'pending'::text NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "rejection_reason" text,
  "notes" text,
  "expiry_date" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "compliance_queue_document_type_check" CHECK ((document_type = ANY (ARRAY['insurance'::text, 'license'::text, 'vehicle_registration'::text, 'psv_badge'::text, 'other'::text]))),
  CONSTRAINT "compliance_queue_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
  CONSTRAINT "compliance_queue_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  CONSTRAINT "compliance_queue_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT "compliance_queue_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_compliance_queue_driver ON public.compliance_queue USING btree (driver_id);
CREATE INDEX idx_compliance_queue_status ON public.compliance_queue USING btree (status, submitted_at);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "compliance_queue_admin_all" cmd=ALL permissive=PERMISSIVE roles={public} qual=(auth.uid() IN ( SELECT profiles.id
   FROM profiles
  WHERE (profiles.role = 'admin'::user_role))) with_check=(auth.uid() IN ( SELECT profiles.id
   FROM profiles
  WHERE (profiles.role = 'admin'::user_role)))
--   policy "compliance_queue_driver_insert" cmd=INSERT permissive=PERMISSIVE roles={public} qual=None with_check=(driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid())))
--   policy "compliance_queue_driver_select_own" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))) with_check=None
ALTER TABLE public."compliance_queue" ENABLE ROW LEVEL SECURITY;


-- ===== cross_zone_safety_pending =====
-- cross_zone_safety_pending — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."cross_zone_safety_pending" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "ride_id" uuid NOT NULL,
  "driver_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "escalated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cross_zone_safety_pending_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES drivers(id),
  CONSTRAINT "cross_zone_safety_pending_ride_id_fkey" FOREIGN KEY (ride_id) REFERENCES rides(id),
  CONSTRAINT "cross_zone_safety_pending_pkey" PRIMARY KEY (id),
  CONSTRAINT "cross_zone_safety_pending_ride_id_key" UNIQUE (ride_id)
);

-- RLS: not enabled on live table.


-- ===== deposit_savings_transactions =====
-- deposit_savings_transactions — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."deposit_savings_transactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "savings_id" uuid NOT NULL,
  "driver_user_id" uuid NOT NULL,
  "transaction_type" text NOT NULL,
  "amount" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "gross_earnings" integer,
  "withhold_percentage" numeric,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deposit_savings_transactions_transaction_type_check" CHECK ((transaction_type = ANY (ARRAY['withholding'::text, 'refund'::text]))),
  CONSTRAINT "deposit_savings_transactions_driver_user_id_fkey" FOREIGN KEY (driver_user_id) REFERENCES auth.users(id),
  CONSTRAINT "deposit_savings_transactions_savings_id_fkey" FOREIGN KEY (savings_id) REFERENCES driver_deposit_savings(id),
  CONSTRAINT "deposit_savings_transactions_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_deposit_tx_savings ON public.deposit_savings_transactions USING btree (savings_id);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "admin_sees_all_savings_tx" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
--   policy "driver_sees_own_savings_tx" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(driver_user_id = auth.uid()) with_check=None
ALTER TABLE public."deposit_savings_transactions" ENABLE ROW LEVEL SECURITY;


-- ===== driver_deposit_savings =====
-- driver_deposit_savings — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."driver_deposit_savings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "driver_user_id" uuid NOT NULL,
  "target_vehicle_class_key" text NOT NULL,
  "deposit_target" integer NOT NULL,
  "amount_saved" integer DEFAULT 0 NOT NULL,
  "withhold_percentage" numeric NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "converted_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "refund_amount" integer,
  "retained_amount" integer,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "driver_deposit_savings_amount_saved_check" CHECK ((amount_saved >= 0)),
  CONSTRAINT "driver_deposit_savings_deposit_target_check" CHECK ((deposit_target > 0)),
  CONSTRAINT "driver_deposit_savings_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'ready_for_assignment'::text, 'converted'::text, 'refunded'::text]))),
  CONSTRAINT "driver_deposit_savings_withhold_percentage_check" CHECK (((withhold_percentage >= 0.05) AND (withhold_percentage <= 0.30))),
  CONSTRAINT "driver_deposit_savings_driver_user_id_fkey" FOREIGN KEY (driver_user_id) REFERENCES auth.users(id),
  CONSTRAINT "driver_deposit_savings_target_vehicle_class_key_fkey" FOREIGN KEY (target_vehicle_class_key) REFERENCES vehicle_classes(key),
  CONSTRAINT "driver_deposit_savings_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_deposit_savings_driver ON public.driver_deposit_savings USING btree (driver_user_id);
CREATE UNIQUE INDEX idx_deposit_savings_one_active_per_driver ON public.driver_deposit_savings USING btree (driver_user_id) WHERE (status = ANY (ARRAY['active'::text, 'ready_for_assignment'::text]));

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "admin_sees_all_savings" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
--   policy "driver_sees_own_savings" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(driver_user_id = auth.uid()) with_check=None
ALTER TABLE public."driver_deposit_savings" ENABLE ROW LEVEL SECURITY;


-- ===== driver_leases =====
-- driver_leases — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."driver_leases" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL,
  "fleet_vehicle_id" uuid,
  "term_finance_agreement_id" text,
  "lease_provider" text DEFAULT 'term_finance'::text NOT NULL,
  "daily_deduction_cents" integer DEFAULT 15000 NOT NULL,
  "weekly_deduction_cents" integer GENERATED ALWAYS AS ((daily_deduction_cents * 7)) STORED,
  "total_lease_cents" integer,
  "paid_to_date_cents" integer DEFAULT 0,
  "remaining_balance_cents" integer GENERATED ALWAYS AS ((total_lease_cents - paid_to_date_cents)) STORED,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "driver_approved_at" timestamp with time zone,
  "term_finance_approved_at" timestamp with time zone,
  "auto_deduct_enabled" boolean DEFAULT true,
  "gps_relay_id" text,
  "gps_relay_enabled" boolean DEFAULT false,
  "gps_last_ping_at" timestamp with time zone,
  "insurance_policy_number" text,
  "insurance_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "national_id" text,
  "date_of_birth" date,
  "residential_address" text,
  CONSTRAINT "driver_leases_lease_provider_check" CHECK ((lease_provider = ANY (ARRAY['term_finance'::text, 'g_taxi_fleet'::text, 'partner'::text]))),
  CONSTRAINT "driver_leases_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'defaulted'::text, 'paid_off'::text, 'repossessed'::text, 'cancelled'::text]))),
  CONSTRAINT "driver_leases_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  CONSTRAINT "driver_leases_fleet_vehicle_id_fkey" FOREIGN KEY (fleet_vehicle_id) REFERENCES fleet_vehicles(id) ON DELETE SET NULL,
  CONSTRAINT "driver_leases_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_driver_leases_driver ON public.driver_leases USING btree (driver_id);
CREATE INDEX idx_driver_leases_remaining ON public.driver_leases USING btree (remaining_balance_cents, status) WHERE (status = 'active'::text);
CREATE INDEX idx_driver_leases_status ON public.driver_leases USING btree (status);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "driver_leases_admin_all" cmd=ALL permissive=PERMISSIVE roles={public} qual=(auth.uid() IN ( SELECT profiles.id
   FROM profiles
  WHERE (profiles.role = 'admin'::user_role))) with_check=(auth.uid() IN ( SELECT profiles.id
   FROM profiles
  WHERE (profiles.role = 'admin'::user_role)))
--   policy "driver_leases_driver_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))) with_check=None
ALTER TABLE public."driver_leases" ENABLE ROW LEVEL SECURITY;


-- ===== driver_partner_usage =====
-- driver_partner_usage — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."driver_partner_usage" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "driver_user_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "partner_service_id" uuid NOT NULL,
  "listed_price_cents" integer NOT NULL,
  "discount_pct" numeric NOT NULL,
  "driver_paid_cents" integer NOT NULL,
  "commission_pct" numeric NOT NULL,
  "commission_cents" integer NOT NULL,
  "status" text DEFAULT 'claimed'::text NOT NULL,
  "dispute_reason" text,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at" timestamp with time zone,
  "confirmed_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "driver_partner_usage_status_check" CHECK ((status = ANY (ARRAY['claimed'::text, 'confirmed'::text, 'disputed'::text]))),
  CONSTRAINT "driver_partner_usage_confirmed_by_fkey" FOREIGN KEY (confirmed_by) REFERENCES profiles(id),
  CONSTRAINT "driver_partner_usage_driver_user_id_fkey" FOREIGN KEY (driver_user_id) REFERENCES auth.users(id),
  CONSTRAINT "driver_partner_usage_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES service_partners(id),
  CONSTRAINT "driver_partner_usage_partner_service_id_fkey" FOREIGN KEY (partner_service_id) REFERENCES partner_services(id),
  CONSTRAINT "driver_partner_usage_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_driver_partner_usage_driver ON public.driver_partner_usage USING btree (driver_user_id);
CREATE INDEX idx_driver_partner_usage_partner ON public.driver_partner_usage USING btree (partner_id);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "driver_partner_usage_admin_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
--   policy "driver_partner_usage_own_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(driver_user_id = auth.uid()) with_check=None
ALTER TABLE public."driver_partner_usage" ENABLE ROW LEVEL SECURITY;


-- ===== escape_lane_fare_baseline =====
-- escape_lane_fare_baseline — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."escape_lane_fare_baseline" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "origin_code" text NOT NULL,
  "destination_code" text NOT NULL,
  "fare_cents" integer NOT NULL,
  "currency" text DEFAULT 'TTD'::text NOT NULL,
  "source" text NOT NULL,
  "source_url" text,
  "as_of_date" date NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "escape_lane_fare_baseline_fare_cents_check" CHECK ((fare_cents > 0)),
  CONSTRAINT "escape_lane_fare_baseline_pkey" PRIMARY KEY (id),
  CONSTRAINT "escape_lane_fare_baseline_origin_code_destination_code_key" UNIQUE (origin_code, destination_code)
);

-- RLS: not enabled on live table.


-- ===== g_action_types =====
-- g_action_types — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."g_action_types" (
  "action_type" text NOT NULL,
  "execution_mode" text NOT NULL,
  "category_default" text NOT NULL,
  "description" text NOT NULL,
  "payload_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "g_action_types_category_default_check" CHECK ((category_default = ANY (ARRAY['money'::text, 'people'::text, 'public'::text, 'config'::text, 'other'::text]))),
  CONSTRAINT "g_action_types_execution_mode_check" CHECK ((execution_mode = ANY (ARRAY['handler'::text, 'manual_ack'::text, 'advisory'::text]))),
  CONSTRAINT "g_action_types_pkey" PRIMARY KEY (action_type)
);

-- RLS: not enabled on live table.


-- ===== g_memory =====
-- g_memory — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."g_memory" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "department" text,
  "entity_type" text,
  "entity_key" text,
  "entity_id" uuid,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "source" text NOT NULL,
  "source_ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confidence" numeric(3,2) DEFAULT 0.70 NOT NULL,
  "embedding" vector(768),
  "embedding_model" text,
  "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(body, ''::text)))) STORED,
  "supersedes_id" uuid,
  "superseded_by_id" uuid,
  "valid_until" timestamp with time zone,
  "content_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_referenced_at" timestamp with time zone,
  "reference_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "g_memory_body_check" CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1500))),
  CONSTRAINT "g_memory_confidence_check" CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
  CONSTRAINT "g_memory_kind_check" CHECK ((kind = ANY (ARRAY['observation'::text, 'decision'::text, 'directive'::text, 'outcome'::text, 'entity_fact'::text, 'open_thread'::text]))),
  CONSTRAINT "g_memory_scope_check" CHECK ((scope = ANY (ARRAY['platform'::text, 'department'::text, 'entity'::text]))),
  CONSTRAINT "g_memory_source_check" CHECK ((source = ANY (ARRAY['agent_run'::text, 'chat'::text, 'execution_outcome'::text, 'owner_directive'::text, 'system'::text]))),
  CONSTRAINT "g_memory_title_check" CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200))),
  CONSTRAINT "g_memory_superseded_by_id_fkey" FOREIGN KEY (superseded_by_id) REFERENCES g_memory(id),
  CONSTRAINT "g_memory_supersedes_id_fkey" FOREIGN KEY (supersedes_id) REFERENCES g_memory(id),
  CONSTRAINT "g_memory_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX g_memory_dedupe ON public.g_memory USING btree (content_hash) WHERE (superseded_by_id IS NULL);
CREATE INDEX g_memory_embedding_hnsw ON public.g_memory USING hnsw (embedding vector_cosine_ops) WHERE (superseded_by_id IS NULL);
CREATE INDEX g_memory_entity ON public.g_memory USING btree (entity_type, entity_id) WHERE ((entity_id IS NOT NULL) AND (superseded_by_id IS NULL));
CREATE INDEX g_memory_scope_dept ON public.g_memory USING btree (scope, department, kind, created_at DESC) WHERE (superseded_by_id IS NULL);
CREATE INDEX g_memory_tsv_gin ON public.g_memory USING gin (search_tsv);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "g_memory_admin_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(( SELECT (profiles.role)::text AS role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = 'admin'::text) with_check=None
ALTER TABLE public."g_memory" ENABLE ROW LEVEL SECURITY;


-- ===== group_discount_tiers =====
-- group_discount_tiers — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."group_discount_tiers" (
  "min_group_size" integer NOT NULL,
  "discount_percent" numeric NOT NULL,
  CONSTRAINT "group_discount_tiers_discount_percent_check" CHECK (((discount_percent >= (0)::numeric) AND (discount_percent <= (100)::numeric))),
  CONSTRAINT "group_discount_tiers_min_group_size_check" CHECK ((min_group_size > 0)),
  CONSTRAINT "group_discount_tiers_pkey" PRIMARY KEY (min_group_size)
);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "group_discount_tiers_admin_read" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
ALTER TABLE public."group_discount_tiers" ENABLE ROW LEVEL SECURITY;


-- ===== merchant_audit_log =====
-- merchant_audit_log — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."merchant_audit_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "old_status" text,
  "new_status" text,
  "changed_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "merchant_audit_log_merchant_id_fkey" FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  CONSTRAINT "merchant_audit_log_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_merchant_audit_log_merchant ON public.merchant_audit_log USING btree (merchant_id);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "admin_reads_merchant_audit_log" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
ALTER TABLE public."merchant_audit_log" ENABLE ROW LEVEL SECURITY;


-- ===== merchant_cash_deposits =====
-- merchant_cash_deposits — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."merchant_cash_deposits" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "merchant_id" uuid NOT NULL,
  "initiated_by" uuid NOT NULL,
  "driver_user_id" uuid NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "idempotency_key" text NOT NULL,
  "reference_note" text,
  "expires_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid,
  "merchant_transaction_id" uuid,
  "driver_transaction_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "merchant_cash_deposits_amount_cents_check" CHECK ((amount_cents > 0)),
  CONSTRAINT "merchant_cash_deposits_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'expired'::text, 'cancelled'::text]))),
  CONSTRAINT "merchant_cash_deposits_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES auth.users(id),
  CONSTRAINT "merchant_cash_deposits_driver_transaction_id_fkey" FOREIGN KEY (driver_transaction_id) REFERENCES wallet_transactions(id),
  CONSTRAINT "merchant_cash_deposits_driver_user_id_fkey" FOREIGN KEY (driver_user_id) REFERENCES auth.users(id),
  CONSTRAINT "merchant_cash_deposits_initiated_by_fkey" FOREIGN KEY (initiated_by) REFERENCES auth.users(id),
  CONSTRAINT "merchant_cash_deposits_merchant_id_fkey" FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  CONSTRAINT "merchant_cash_deposits_merchant_transaction_id_fkey" FOREIGN KEY (merchant_transaction_id) REFERENCES wallet_transactions(id),
  CONSTRAINT "merchant_cash_deposits_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_merchant_cash_deposits_driver ON public.merchant_cash_deposits USING btree (driver_user_id, status);
CREATE INDEX idx_merchant_cash_deposits_expiry ON public.merchant_cash_deposits USING btree (expires_at) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX idx_merchant_cash_deposits_idempotency ON public.merchant_cash_deposits USING btree (merchant_id, idempotency_key);
CREATE INDEX idx_merchant_cash_deposits_merchant ON public.merchant_cash_deposits USING btree (merchant_id, status);
CREATE UNIQUE INDEX idx_merchant_cash_deposits_one_pending_per_driver ON public.merchant_cash_deposits USING btree (driver_user_id) WHERE (status = 'pending'::text);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "admin_sees_all_deposits" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
--   policy "driver_sees_own_deposits" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(driver_user_id = auth.uid()) with_check=None
--   policy "merchant_sees_own_deposits" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(merchant_id IN ( SELECT merchants.id
   FROM merchants
  WHERE (merchants.created_by = auth.uid())
UNION
 SELECT merchant_staff.merchant_id
   FROM merchant_staff
  WHERE ((merchant_staff.user_id = auth.uid()) AND merchant_staff.is_active))) with_check=None
ALTER TABLE public."merchant_cash_deposits" ENABLE ROW LEVEL SECURITY;


-- ===== partner_services =====
-- partner_services — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."partner_services" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "partner_id" uuid NOT NULL,
  "name" text NOT NULL,
  "price_cents" integer NOT NULL,
  "driver_discount_pct" numeric NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "partner_services_driver_discount_pct_check" CHECK (((driver_discount_pct > (0)::numeric) AND (driver_discount_pct <= (50)::numeric))),
  CONSTRAINT "partner_services_price_cents_check" CHECK ((price_cents > 0)),
  CONSTRAINT "partner_services_partner_id_fkey" FOREIGN KEY (partner_id) REFERENCES service_partners(id),
  CONSTRAINT "partner_services_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_partner_services_partner ON public.partner_services USING btree (partner_id);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "partner_services_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=true with_check=None
ALTER TABLE public."partner_services" ENABLE ROW LEVEL SECURITY;


-- ===== pricing_rules =====
-- pricing_rules — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."pricing_rules" (
  "country_code" text NOT NULL,
  "markup_percent" numeric NOT NULL,
  "subscriber_discount_percent" numeric DEFAULT 0 NOT NULL,
  "subscriber_discount_enabled" boolean DEFAULT false NOT NULL,
  "currency_code" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pricing_rules_markup_percent_check" CHECK ((markup_percent >= (0)::numeric)),
  CONSTRAINT "pricing_rules_subscriber_discount_percent_check" CHECK (((subscriber_discount_percent >= (0)::numeric) AND (subscriber_discount_percent <= (100)::numeric))),
  CONSTRAINT "pricing_rules_pkey" PRIMARY KEY (country_code)
);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "pricing_rules_admin_read" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
ALTER TABLE public."pricing_rules" ENABLE ROW LEVEL SECURITY;


-- ===== referral_reward_ride_ledger =====
-- referral_reward_ride_ledger — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."referral_reward_ride_ledger" (
  "reward_type" text NOT NULL,
  "ride_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referral_reward_ride_ledger_pkey" PRIMARY KEY (reward_type, ride_id)
);

-- RLS: ENABLED on live table (force=False). Policies on live table:
ALTER TABLE public."referral_reward_ride_ledger" ENABLE ROW LEVEL SECURITY;


-- ===== referral_rewards =====
-- referral_rewards — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."referral_rewards" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "rider_id" uuid NOT NULL,
  "driver_id" uuid NOT NULL,
  "rides_completed" smallint DEFAULT 0,
  "target_rides" smallint DEFAULT 5 NOT NULL,
  "reward_triggered" boolean DEFAULT false,
  "commission_boost_pct" numeric(3,1) DEFAULT 0,
  "boost_expires_at" timestamp with time zone,
  "boost_active" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "referral_rewards_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  CONSTRAINT "referral_rewards_rider_id_fkey" FOREIGN KEY (rider_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "referral_rewards_pkey" PRIMARY KEY (id),
  CONSTRAINT "referral_rewards_rider_id_driver_id_key" UNIQUE (rider_id, driver_id)
);
CREATE INDEX idx_referral_rewards_driver ON public.referral_rewards USING btree (driver_id);
CREATE INDEX idx_referral_rewards_reward_triggered ON public.referral_rewards USING btree (reward_triggered);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "referral_rewards_driver_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(driver_id IN ( SELECT drivers.id
   FROM drivers
  WHERE (drivers.user_id = auth.uid()))) with_check=None
ALTER TABLE public."referral_rewards" ENABLE ROW LEVEL SECURITY;


-- ===== service_partners =====
-- service_partners — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."service_partners" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "phone" text,
  "whatsapp" text,
  "territory_id" uuid,
  "commission_pct" numeric NOT NULL,
  "commission_owed_cents" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "service_partners_category_check" CHECK ((category = ANY (ARRAY['car_wash'::text, 'auto_repair'::text, 'auto_parts'::text, 'insurance'::text, 'fuel'::text, 'tires'::text, 'other'::text]))),
  CONSTRAINT "service_partners_commission_owed_cents_check" CHECK ((commission_owed_cents >= 0)),
  CONSTRAINT "service_partners_commission_pct_check" CHECK (((commission_pct > (0)::numeric) AND (commission_pct <= (50)::numeric))),
  CONSTRAINT "service_partners_territory_id_fkey" FOREIGN KEY (territory_id) REFERENCES territories(id),
  CONSTRAINT "service_partners_pkey" PRIMARY KEY (id)
);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "service_partners_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=true with_check=None
ALTER TABLE public."service_partners" ENABLE ROW LEVEL SECURITY;


-- ===== territory_vertical_unlock_thresholds =====
-- territory_vertical_unlock_thresholds — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."territory_vertical_unlock_thresholds" (
  "vertical_name" text NOT NULL,
  "rider_count_threshold" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "territory_vertical_unlock_threshold_rider_count_threshold_check" CHECK ((rider_count_threshold > 0)),
  CONSTRAINT "territory_vertical_unlock_thresholds_pkey" PRIMARY KEY (vertical_name)
);

-- RLS: not enabled on live table.


-- ===== transition_bonus_schedules =====
-- transition_bonus_schedules — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."transition_bonus_schedules" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "driver_user_id" uuid NOT NULL,
  "deposit_savings_id" uuid NOT NULL,
  "proposal_id" uuid,
  "monthly_bonus_cents" integer NOT NULL,
  "months_total" integer DEFAULT 6 NOT NULL,
  "months_paid" integer DEFAULT 0 NOT NULL,
  "next_payment_due_at" timestamp with time zone,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "transition_bonus_schedules_monthly_bonus_cents_check" CHECK ((monthly_bonus_cents > 0)),
  CONSTRAINT "transition_bonus_schedules_months_paid_check" CHECK ((months_paid >= 0)),
  CONSTRAINT "transition_bonus_schedules_months_total_check" CHECK ((months_total > 0)),
  CONSTRAINT "transition_bonus_schedules_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text]))),
  CONSTRAINT "transition_bonus_schedules_deposit_savings_id_fkey" FOREIGN KEY (deposit_savings_id) REFERENCES driver_deposit_savings(id),
  CONSTRAINT "transition_bonus_schedules_driver_user_id_fkey" FOREIGN KEY (driver_user_id) REFERENCES auth.users(id),
  CONSTRAINT "transition_bonus_schedules_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES g_proposed_actions(id),
  CONSTRAINT "transition_bonus_schedules_pkey" PRIMARY KEY (id),
  CONSTRAINT "transition_bonus_schedules_deposit_savings_id_key" UNIQUE (deposit_savings_id)
);
CREATE INDEX idx_transition_bonus_due ON public.transition_bonus_schedules USING btree (next_payment_due_at) WHERE (status = 'active'::text);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "transition_bonus_admin_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
--   policy "transition_bonus_driver_select" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(driver_user_id = auth.uid()) with_check=None
ALTER TABLE public."transition_bonus_schedules" ENABLE ROW LEVEL SECURITY;


-- ===== waitlist_submission_log =====
-- waitlist_submission_log — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."waitlist_submission_log" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "client_ip" inet,
  "phone_norm" text NOT NULL,
  "waitlist_id" uuid NOT NULL,
  CONSTRAINT "waitlist_submission_log_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_waitlist_submission_log_created ON public.waitlist_submission_log USING btree (created_at);
CREATE INDEX idx_waitlist_submission_log_ip ON public.waitlist_submission_log USING btree (client_ip, created_at) WHERE (client_ip IS NOT NULL);
CREATE INDEX idx_waitlist_submission_log_phone ON public.waitlist_submission_log USING btree (phone_norm, created_at);

-- RLS: ENABLED on live table (force=False). Policies on live table:
ALTER TABLE public."waitlist_submission_log" ENABLE ROW LEVEL SECURITY;


-- ===== withdrawal_requests =====
-- withdrawal_requests — schema reconstructed from LIVE catalogues 2026-10-30 (information_schema + pg_catalog). Shadow-layer recovery copy.

CREATE TABLE IF NOT EXISTS public."withdrawal_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "user_type" text NOT NULL,
  "amount_ttd" integer NOT NULL,
  "fee_ttd" integer DEFAULT 0 NOT NULL,
  "phone_number" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + '48:00:00'::interval) NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "republic_bank_reference" text,
  CONSTRAINT "withdrawal_requests_amount_ttd_check" CHECK ((amount_ttd > 0)),
  CONSTRAINT "withdrawal_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'completed'::text, 'expired'::text, 'failed'::text]))),
  CONSTRAINT "withdrawal_requests_user_type_check" CHECK ((user_type = ANY (ARRAY['rider'::text, 'driver'::text, 'pod_commander'::text]))),
  CONSTRAINT "withdrawal_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY (id)
);
CREATE INDEX idx_withdrawal_requests_requested_at ON public.withdrawal_requests USING btree (requested_at DESC);
CREATE INDEX idx_withdrawal_requests_status ON public.withdrawal_requests USING btree (status);
CREATE INDEX idx_withdrawal_requests_user ON public.withdrawal_requests USING btree (user_id, status);

-- RLS: ENABLED on live table (force=False). Policies on live table:
--   policy "Admins can view all withdrawal requests" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))) with_check=None
--   policy "Users can view own withdrawal requests" cmd=SELECT permissive=PERMISSIVE roles={public} qual=(auth.uid() = user_id) with_check=None
ALTER TABLE public."withdrawal_requests" ENABLE ROW LEVEL SECURITY;
