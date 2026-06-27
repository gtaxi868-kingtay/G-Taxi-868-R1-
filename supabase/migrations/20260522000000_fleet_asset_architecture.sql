-- =============================================================================
-- MIGRATION: 20260522000000_fleet_asset_architecture.sql
-- FLEET-AS-A-SERVICE: Dealership Brokerage + Fleet Leasing + Regional Settings
-- =============================================================================
-- This migration injects three new financial modules:
--   1. DEALERSHIP BROKERAGE ENGINE: Dealer partners, vehicle inventory, sales
--   2. FLEET LEASING ENGINE: Fleet vehicles, leases, per-ride deduction
--   3. REGIONAL SETTINGS ENGINE: Multi-region currency/compliance/pricing
--
-- Uses PRODUCTION column names (user_id, transaction_type, amount — never
-- wallet_id, type, or amount_cents for wallet_transactions).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- Drop empty tables that have obsolete schemas so they get recreated properly
DROP TABLE IF EXISTS dealer_partners CASCADE;
DROP TABLE IF EXISTS vehicle_inventory CASCADE;
DROP TABLE IF EXISTS vehicle_sales CASCADE;
DROP TABLE IF EXISTS fleet_vehicles CASCADE;
DROP TABLE IF EXISTS fleet_leases CASCADE;
DROP TABLE IF EXISTS lease_payments CASCADE;
DROP TABLE IF EXISTS region_settings CASCADE;

-- =============================================================================
-- MODULE 3: REGIONAL SETTINGS (created first because it's a FK target)
-- =============================================================================

CREATE TABLE IF NOT EXISTS region_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'TTD',
    currency_symbol TEXT NOT NULL DEFAULT 'TT$',
    locale          TEXT NOT NULL DEFAULT 'en-TT',
    timezone        TEXT NOT NULL DEFAULT 'America/Port_of_Spain',

    -- Take-rate defaults (can be overridden per driver via commission_tier)
    default_commission_rate      NUMERIC(5,2) NOT NULL DEFAULT 22.00,
    default_driver_payout_rate   NUMERIC(5,2) NOT NULL DEFAULT 81.00,
    default_merchant_split_rate  NUMERIC(5,2) NOT NULL DEFAULT 5.00,

    -- Pricing defaults
    min_fare_cents              INTEGER NOT NULL DEFAULT 2200,
    base_fare_cents             INTEGER NOT NULL DEFAULT 1600,
    per_km_cents                INTEGER NOT NULL DEFAULT 175,
    per_min_cents               INTEGER NOT NULL DEFAULT 95,
    cancellation_fee_cents      INTEGER NOT NULL DEFAULT 500,
    max_wait_seconds            INTEGER NOT NULL DEFAULT 180,
    wait_fee_per_min_cents      INTEGER NOT NULL DEFAULT 90,
    gridlock_surcharge_cents    INTEGER NOT NULL DEFAULT 1500,
    gridlock_delay_threshold_seconds INTEGER NOT NULL DEFAULT 900,

    -- GPS enforcement defaults
    gps_proximity_dropoff_meters  INTEGER NOT NULL DEFAULT 150,
    gps_proximity_pickup_meters   INTEGER NOT NULL DEFAULT 120,

    -- Matching defaults
    max_offered_radius_meters   INTEGER NOT NULL DEFAULT 5000,
    ride_offer_ttl_seconds      INTEGER NOT NULL DEFAULT 30,

    -- Fleet lease defaults
    lease_daily_rate_cents      INTEGER NOT NULL DEFAULT 3000,
    lease_mileage_rate_cents    INTEGER NOT NULL DEFAULT 50,

    -- Wallet/credit limits
    driver_online_debt_limit_cents  INTEGER NOT NULL DEFAULT 60000,
    ride_creation_debt_limit_cents  INTEGER NOT NULL DEFAULT 60000,
    min_wallet_topup_cents          INTEGER NOT NULL DEFAULT 2000,
    max_wallet_topup_cents          INTEGER NOT NULL DEFAULT 100000,

    -- Compliance & legal config (JSON blob for per-region insurance APIs, regulators)
    compliance_config           JSONB DEFAULT '{}',
    metadata                    JSONB DEFAULT '{}',

    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_region_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_region_settings_updated_at ON region_settings;
CREATE TRIGGER trg_region_settings_updated_at
    BEFORE UPDATE ON region_settings
    FOR EACH ROW EXECUTE FUNCTION update_region_settings_timestamp();

COMMENT ON TABLE region_settings IS
    'Multi-region configuration. One row per operational country/territory. '
    'Controls currency, pricing, compliance, and lease defaults. '
    'Add a new row to expand into a new region with zero code changes.';

-- =============================================================================
-- MODULE 1: DEALERSHIP BROKERAGE ENGINE
-- =============================================================================

-- Dealer Partners: dealerships that sell vehicles through our platform
CREATE TABLE IF NOT EXISTS dealer_partners (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name       TEXT NOT NULL,
    registration_number TEXT,
    tax_id              TEXT,
    address             TEXT,
    phone               TEXT NOT NULL,
    email               TEXT,
    contact_name        TEXT,
    commission_type     TEXT NOT NULL DEFAULT 'percentage'
                        CHECK (commission_type IN ('percentage', 'fixed')),
    commission_value    NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_terms_days  INTEGER NOT NULL DEFAULT 30,
    bank_details        JSONB DEFAULT '{}',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    region_id           UUID REFERENCES region_settings(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_partners_region ON dealer_partners(region_id);
CREATE INDEX IF NOT EXISTS idx_dealer_partners_active ON dealer_partners(is_active);

-- Vehicle Inventory: each vehicle listed by a dealer
CREATE TABLE IF NOT EXISTS vehicle_inventory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id       UUID NOT NULL REFERENCES dealer_partners(id) ON DELETE CASCADE,
    make            TEXT NOT NULL,
    model           TEXT NOT NULL,
    year            INTEGER NOT NULL,
    vin             TEXT,
    color           TEXT,
    license_plate   TEXT,
    vehicle_type    TEXT NOT NULL DEFAULT 'standard'
                    CHECK (vehicle_type IN ('standard', 'xl', 'premium', 'eco')),
    price_cents     INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'sold', 'reserved', 'discontinued')),
    image_url       TEXT,
    specifications  JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inventory_dealer ON vehicle_inventory(dealer_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_inventory_status ON vehicle_inventory(status);

-- Vehicle Sales: lead-to-sale lifecycle tracking
CREATE TABLE IF NOT EXISTS vehicle_sales (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id              UUID NOT NULL REFERENCES vehicle_inventory(id),
    dealer_id               UUID NOT NULL REFERENCES dealer_partners(id),
    driver_id               UUID NOT NULL REFERENCES drivers(id),
    buyer_id                UUID REFERENCES auth.users(id),

    status                  TEXT NOT NULL DEFAULT 'lead'
                            CHECK (status IN (
                                'lead',
                                'test_drive_scheduled',
                                'financing_pending',
                                'financing_approved',
                                'sale_completed',
                                'cancelled'
                            )),

    -- Brokerage fee (our commission on the sale)
    brokerage_fee_cents     INTEGER,
    brokerage_fee_percent   NUMERIC(5,2),

    -- Invoice tracking
    brokerage_invoice_id    TEXT,
    brokerage_invoiced_at   TIMESTAMPTZ,
    brokerage_paid_at       TIMESTAMPTZ,

    -- Financing
    financing_partner       TEXT,
    financing_approved_at   TIMESTAMPTZ,
    sale_price_cents        INTEGER,
    sale_completed_at       TIMESTAMPTZ,

    -- Referral / attribution
    referred_by             UUID REFERENCES auth.users(id),

    notes                   TEXT,
    metadata                JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_sales_dealer ON vehicle_sales(dealer_id);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vehicle_sales' AND column_name='driver_id') THEN
        CREATE INDEX IF NOT EXISTS idx_vehicle_sales_driver ON vehicle_sales(driver_id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_vehicle_sales_status ON vehicle_sales(status);

-- =============================================================================
-- MODULE 2: FLEET LEASING ENGINE
-- =============================================================================

-- Fleet Vehicles: vehicles we own and lease to drivers
CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_inventory_id    UUID REFERENCES vehicle_inventory(id),
    make                    TEXT NOT NULL,
    model                   TEXT NOT NULL,
    year                    INTEGER NOT NULL,
    vin                     TEXT,
    license_plate           TEXT NOT NULL,
    vehicle_type            TEXT NOT NULL DEFAULT 'standard',
    ownership_type          TEXT NOT NULL DEFAULT 'owned'
                            CHECK (ownership_type IN (
                                'owned',
                                'leased_from_partner',
                                'financed'
                            )),
    owner_partner_id        UUID REFERENCES dealer_partners(id),
    acquisition_cost_cents  INTEGER,
    current_value_cents     INTEGER,
    status                  TEXT NOT NULL DEFAULT 'available'
                            CHECK (status IN (
                                'available',
                                'leased',
                                'maintenance',
                                'retired',
                                'sold'
                            )),
    is_roadworthy           BOOLEAN NOT NULL DEFAULT true,
    last_maintenance_at     TIMESTAMPTZ,
    next_maintenance_due_at TIMESTAMPTZ,
    odometer_km             INTEGER DEFAULT 0,
    region_id               UUID REFERENCES region_settings(id) ON DELETE SET NULL,
    metadata                JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_status ON fleet_vehicles(status);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_region ON fleet_vehicles(region_id);

-- Fleet Leases: lease agreements between us and drivers
CREATE TABLE IF NOT EXISTS fleet_leases (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_vehicle_id        UUID NOT NULL REFERENCES fleet_vehicles(id),
    driver_id               UUID NOT NULL REFERENCES drivers(id),

    start_date              DATE NOT NULL,
    end_date                DATE,
    lease_type              TEXT NOT NULL DEFAULT 'daily'
                            CHECK (lease_type IN ('daily', 'weekly', 'mileage', 'hybrid')),

    -- Fee structure
    daily_rate_cents        INTEGER NOT NULL DEFAULT 3000,
    mileage_rate_cents      INTEGER NOT NULL DEFAULT 50,
    weekly_minimum_cents    INTEGER,

    -- Deposit
    security_deposit_cents  INTEGER NOT NULL DEFAULT 0,
    deposit_paid            BOOLEAN NOT NULL DEFAULT false,

    -- Status
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'terminated', 'completed')),
    termination_reason      TEXT,
    terminated_at           TIMESTAMPTZ,

    region_id               UUID REFERENCES region_settings(id) ON DELETE SET NULL,
    metadata                JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_leases_driver ON fleet_leases(driver_id);
CREATE INDEX IF NOT EXISTS idx_fleet_leases_vehicle ON fleet_leases(fleet_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_leases_status ON fleet_leases(status);

-- Lease Payments: individual deductions (daily, mileage, or hybrid)
CREATE TABLE IF NOT EXISTS lease_payments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id                UUID NOT NULL REFERENCES fleet_leases(id),
    ride_id                 UUID REFERENCES rides(id) ON DELETE SET NULL,

    amount_cents            INTEGER NOT NULL,
    mileage_km              INTEGER,
    deduction_type          TEXT NOT NULL
                            CHECK (deduction_type IN (
                                'daily',
                                'mileage',
                                'weekly_minimum',
                                'hybrid'
                            )),

    billing_period_start    DATE NOT NULL,
    billing_period_end      DATE NOT NULL,

    -- Deduction source
    deducted_from_ride      BOOLEAN NOT NULL DEFAULT false,
    deducted_at             TIMESTAMPTZ,

    paid_directly           BOOLEAN NOT NULL DEFAULT false,
    paid_at                 TIMESTAMPTZ,
    payment_reference       TEXT,

    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'deducted', 'failed', 'waived')),

    wallet_transaction_id   UUID REFERENCES wallet_transactions(id),
    metadata                JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lease_payments_lease ON lease_payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_payments_ride ON lease_payments(ride_id);
CREATE INDEX IF NOT EXISTS idx_lease_payments_status ON lease_payments(status);

-- =============================================================================
-- ALTER EXISTING TABLES: Add fleet & region columns to core tables
-- =============================================================================

-- Rides: track which region, fleet lease, and settlement breakdown
ALTER TABLE rides
    ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES region_settings(id),
    ADD COLUMN IF NOT EXISTS fleet_lease_id UUID REFERENCES fleet_leases(id),
    ADD COLUMN IF NOT EXISTS lease_deduction_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS reserve_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_rides_region ON rides(region_id);
CREATE INDEX IF NOT EXISTS idx_rides_fleet_lease ON rides(fleet_lease_id);

-- Drivers: track region assignment and active fleet lease
ALTER TABLE drivers
    ADD COLUMN IF NOT EXISTS fleet_lease_id UUID REFERENCES fleet_leases(id),
    ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES region_settings(id);

CREATE INDEX IF NOT EXISTS idx_drivers_fleet_lease ON drivers(fleet_lease_id);
CREATE INDEX IF NOT EXISTS idx_drivers_region ON drivers(region_id);

-- Platform Revenue Logs: track lease income, reserve, and regional breakdown
ALTER TABLE platform_revenue_logs
    ADD COLUMN IF NOT EXISTS reserve_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES region_settings(id),
    ADD COLUMN IF NOT EXISTS fleet_lease_id UUID REFERENCES fleet_leases(id),
    ADD COLUMN IF NOT EXISTS lease_deduction_cents INTEGER NOT NULL DEFAULT 0;

-- Wallet Transactions: add lease deduction/income and capital_reserve types
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check
    CHECK (transaction_type IN (
        'topup', 'ride_payment', 'refund', 'bonus',
        'driver_payout', 'tip', 'commission_fee',
        'cancellation_fee', 'leakage_fine', 'debt_recovery',
        'payout', 'debt_repayment',
        'lease_deduction', 'lease_income',
        'capital_reserve'
    ));

-- =============================================================================
-- RPC: get_or_create_region_settings
-- Returns existing region settings by code, or creates them if not found.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_or_create_region_settings(
    p_code       TEXT,
    p_name       TEXT DEFAULT NULL,
    p_currency   TEXT DEFAULT 'TTD'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
BEGIN
    INSERT INTO region_settings (code, name, currency)
    VALUES (
        p_code,
        COALESCE(p_name, p_code),
        p_currency
    )
    ON CONFLICT (code) DO UPDATE
        SET code = region_settings.code  -- no-op, just to get RETURNING
    RETURNING row_to_json(region_settings)::JSONB INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_or_create_region_settings(TEXT, TEXT, TEXT) IS
    'Upserts a region by code. Returns full row as JSONB.';

-- =============================================================================
-- RPC: calculate_lease_daily_fee
-- Returns the daily lease fee amount for a driver's active lease on a given date.
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_lease_daily_fee(
    p_driver_id UUID,
    p_date      DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
    has_active_lease    BOOLEAN,
    lease_id            UUID,
    daily_rate_cents    INTEGER,
    already_charged     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_lease_id          UUID;
    v_daily_rate_cents  INTEGER;
    v_already_charged   BOOLEAN;
BEGIN
    SELECT fl.id, fl.daily_rate_cents
    INTO v_lease_id, v_daily_rate_cents
    FROM fleet_leases fl
    WHERE fl.driver_id = p_driver_id
      AND fl.status = 'active'
    LIMIT 1;

    IF v_lease_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, 0, false;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM lease_payments
        WHERE lease_id = v_lease_id
          AND billing_period_start <= p_date
          AND billing_period_end >= p_date
          AND deduction_type = 'daily'
          AND status = 'deducted'
    ) INTO v_already_charged;

    RETURN QUERY SELECT true, v_lease_id, v_daily_rate_cents, v_already_charged;
END;
$$;

COMMENT ON FUNCTION calculate_lease_daily_fee(UUID, DATE) IS
    'Checks if a driver has an active lease and whether daily fee was already charged for a given date.';

-- =============================================================================
-- RPC: apply_lease_daily_fees
-- Applies daily lease fees for ALL active daily/hybrid leases. Called by cron.
-- =============================================================================

CREATE OR REPLACE FUNCTION apply_lease_daily_fees(
    p_date DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
    lease_id        UUID,
    driver_user_id  UUID,
    amount_cents    INTEGER,
    success         BOOLEAN,
    error_message   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_platform_id UUID := '00000000-0000-0000-0000-000000000000';
    v_lease RECORD;
    v_driver_user_id UUID;
    v_balance INTEGER;
    v_wallet_txn_id UUID;
    v_lease_payment_id UUID;
BEGIN
    FOR v_lease IN
        SELECT fl.id, fl.daily_rate_cents, fl.lease_type, d.user_id, d.id AS driver_id
        FROM fleet_leases fl
        JOIN drivers d ON d.id = fl.driver_id
        WHERE fl.status = 'active'
          AND fl.lease_type IN ('daily', 'hybrid')
          AND NOT EXISTS (
              SELECT 1 FROM lease_payments lp
              WHERE lp.lease_id = fl.id
                AND lp.billing_period_start <= p_date
                AND lp.billing_period_end >= p_date
                AND lp.deduction_type = 'daily'
                AND lp.status = 'deducted'
          )
    LOOP
        v_driver_user_id := v_lease.user_id;

        SELECT COALESCE(SUM(amount), 0) INTO v_balance
        FROM wallet_transactions
        WHERE user_id = v_driver_user_id;

        IF v_balance < v_lease.daily_rate_cents THEN
            INSERT INTO lease_payments (
                lease_id, amount_cents, deduction_type,
                billing_period_start, billing_period_end,
                status, metadata
            ) VALUES (
                v_lease.id, v_lease.daily_rate_cents, 'daily',
                p_date, p_date, 'failed',
                jsonb_build_object('error', 'Insufficient balance', 'balance_cents', v_balance)
            );
            RETURN QUERY SELECT v_lease.id, v_driver_user_id, v_lease.daily_rate_cents, false, 'Insufficient balance';
            CONTINUE;
        END IF;

        INSERT INTO wallet_transactions (
            user_id, amount, transaction_type, description, status
        ) VALUES (
            v_driver_user_id, -v_lease.daily_rate_cents,
            'lease_deduction',
            format('Daily fleet lease fee (%s)', p_date),
            'completed'
        )
        RETURNING id INTO v_wallet_txn_id;

        INSERT INTO wallet_transactions (
            user_id, amount, transaction_type, description, status
        ) VALUES (
            v_platform_id, v_lease.daily_rate_cents,
            'lease_income',
            format('Daily fleet lease income (%s)', p_date),
            'completed'
        );

        INSERT INTO lease_payments (
            lease_id, amount_cents, deduction_type,
            billing_period_start, billing_period_end,
            status, deducted_from_ride, deducted_at,
            wallet_transaction_id
        ) VALUES (
            v_lease.id, v_lease.daily_rate_cents, 'daily',
            p_date, p_date, 'deducted', false, now(),
            v_wallet_txn_id
        )
        RETURNING id INTO v_lease_payment_id;

        RETURN QUERY SELECT v_lease.id, v_driver_user_id, v_lease.daily_rate_cents, true, NULL::TEXT;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION apply_lease_daily_fees(DATE) IS
    'Batch applies daily lease fees for all active daily/hybrid leases. Intended for cron invocation.';

-- =============================================================================
-- RPC: get_dealer_brokerage_report
-- Returns brokerage summary for a dealer over a date range.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_dealer_brokerage_report(
    p_dealer_id   UUID,
    p_start_date  DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
    p_end_date    DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
    total_sales             BIGINT,
    total_brokerage_cents   BIGINT,
    total_sale_price_cents  BIGINT,
    pending_cents           BIGINT,
    paid_cents              BIGINT,
    invoiced_cents          BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT AS total_sales,
        COALESCE(SUM(vs.brokerage_fee_cents), 0)::BIGINT AS total_brokerage_cents,
        COALESCE(SUM(vs.sale_price_cents), 0)::BIGINT AS total_sale_price_cents,
        COALESCE(SUM(vs.brokerage_fee_cents) FILTER (WHERE vs.status = 'financing_approved'), 0)::BIGINT AS pending_cents,
        COALESCE(SUM(vs.brokerage_fee_cents) FILTER (WHERE vs.brokerage_paid_at IS NOT NULL), 0)::BIGINT AS paid_cents,
        COALESCE(SUM(vs.brokerage_fee_cents) FILTER (WHERE vs.brokerage_invoiced_at IS NOT NULL AND vs.brokerage_paid_at IS NULL), 0)::BIGINT AS invoiced_cents
    FROM vehicle_sales vs
    WHERE vs.dealer_id = p_dealer_id
      AND vs.created_at >= p_start_date
      AND vs.created_at < p_end_date + INTERVAL '1 day';
END;
$$;

COMMENT ON FUNCTION get_dealer_brokerage_report(UUID, DATE, DATE) IS
    'Brokerage financial report for a dealer partner over a date range.';

-- =============================================================================
-- RPC: get_fleet_lease_report
-- Returns fleet lease financial summary for a given lease or driver.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_fleet_lease_report(
    p_lease_id  UUID DEFAULT NULL,
    p_driver_id UUID DEFAULT NULL,
    p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
    p_end_date   DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
    lease_id                UUID,
    driver_name             TEXT,
    total_deductions        BIGINT,
    total_deduction_cents   BIGINT,
    failed_deductions       BIGINT,
    failed_cents            BIGINT,
    daily_charges           BIGINT,
    mileage_charges         BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        fl.id AS lease_id,
        COALESCE(p.full_name, 'Unknown') AS driver_name,
        COUNT(lp.id)::BIGINT AS total_deductions,
        COALESCE(SUM(lp.amount_cents) FILTER (WHERE lp.status = 'deducted'), 0)::BIGINT AS total_deduction_cents,
        COUNT(lp.id) FILTER (WHERE lp.status = 'failed')::BIGINT AS failed_deductions,
        COALESCE(SUM(lp.amount_cents) FILTER (WHERE lp.status = 'failed'), 0)::BIGINT AS failed_cents,
        COUNT(lp.id) FILTER (WHERE lp.deduction_type = 'daily')::BIGINT AS daily_charges,
        COUNT(lp.id) FILTER (WHERE lp.deduction_type IN ('mileage', 'hybrid'))::BIGINT AS mileage_charges
    FROM fleet_leases fl
    JOIN drivers d ON d.id = fl.driver_id
    LEFT JOIN profiles p ON p.id = d.user_id
    LEFT JOIN lease_payments lp ON lp.lease_id = fl.id
        AND lp.created_at >= p_start_date
        AND lp.created_at < p_end_date + INTERVAL '1 day'
    WHERE (p_lease_id IS NULL OR fl.id = p_lease_id)
      AND (p_driver_id IS NULL OR fl.driver_id = p_driver_id)
    GROUP BY fl.id, p.full_name;
END;
$$;

COMMENT ON FUNCTION get_fleet_lease_report(UUID, UUID, DATE, DATE) IS
    'Fleet lease financial report aggregated by lease over a date range.';

-- =============================================================================
-- RPC: clone_region_settings
-- Clones an existing region's settings to create a new region.
-- =============================================================================

DROP FUNCTION IF EXISTS clone_region_settings(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION clone_region_settings(
    p_source_code     TEXT,
    p_target_code     TEXT,
    p_target_name     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_source region_settings%ROWTYPE;
    v_new_id UUID;
    v_result JSONB;
BEGIN
    SELECT * INTO v_source
    FROM region_settings
    WHERE code = p_source_code;

    IF v_source.id IS NULL THEN
        RETURN jsonb_build_object('error', format('Source region %s not found', p_source_code));
    END IF;

    INSERT INTO region_settings (
        code, name, currency, currency_symbol, locale, timezone,
        default_commission_rate, default_driver_payout_rate, default_merchant_split_rate,
        min_fare_cents, base_fare_cents, per_km_cents, per_min_cents,
        cancellation_fee_cents, max_wait_seconds, wait_fee_per_min_cents,
        gridlock_surcharge_cents, gridlock_delay_threshold_seconds,
        gps_proximity_dropoff_meters, gps_proximity_pickup_meters,
        max_offered_radius_meters, ride_offer_ttl_seconds,
        lease_daily_rate_cents, lease_mileage_rate_cents,
        driver_online_debt_limit_cents, ride_creation_debt_limit_cents,
        min_wallet_topup_cents, max_wallet_topup_cents,
        compliance_config, metadata, is_active
    ) VALUES (
        p_target_code,
        COALESCE(p_target_name, p_target_code),
        v_source.currency, v_source.currency_symbol, v_source.locale, v_source.timezone,
        v_source.default_commission_rate, v_source.default_driver_payout_rate, v_source.default_merchant_split_rate,
        v_source.min_fare_cents, v_source.base_fare_cents, v_source.per_km_cents, v_source.per_min_cents,
        v_source.cancellation_fee_cents, v_source.max_wait_seconds, v_source.wait_fee_per_min_cents,
        v_source.gridlock_surcharge_cents, v_source.gridlock_delay_threshold_seconds,
        v_source.gps_proximity_dropoff_meters, v_source.gps_proximity_pickup_meters,
        v_source.max_offered_radius_meters, v_source.ride_offer_ttl_seconds,
        v_source.lease_daily_rate_cents, v_source.lease_mileage_rate_cents,
        v_source.driver_online_debt_limit_cents, v_source.ride_creation_debt_limit_cents,
        v_source.min_wallet_topup_cents, v_source.max_wallet_topup_cents,
        v_source.compliance_config, v_source.metadata, v_source.is_active
    )
    RETURNING row_to_json(region_settings)::JSONB INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION clone_region_settings(TEXT, TEXT, TEXT) IS
    'Clones all settings from an existing region to create a new region with identical config.';

-- =============================================================================
-- RLS POLICIES FOR ALL NEW TABLES
-- =============================================================================

-- region_settings: Readable by all authenticated users, writable only by service_role
ALTER TABLE region_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read region settings" ON region_settings;
CREATE POLICY "Anyone can read region settings" ON region_settings FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Service role manages region settings" ON region_settings;
CREATE POLICY "Service role manages region settings" ON region_settings FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- dealer_partners: Admin + service_role only (sensitive financial data)
ALTER TABLE dealer_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and service role can read dealer partners" ON dealer_partners;
CREATE POLICY "Admins and service role can read dealer partners" ON dealer_partners FOR SELECT TO authenticated
    USING (auth.jwt() ->> 'role' IN ('admin', 'service_role'));

DROP POLICY IF EXISTS "Service role manages dealer partners" ON dealer_partners;
CREATE POLICY "Service role manages dealer partners" ON dealer_partners FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- vehicle_inventory: Drivers can browse available, service_role manages
ALTER TABLE vehicle_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can browse available inventory" ON vehicle_inventory;
CREATE POLICY "Drivers can browse available inventory" ON vehicle_inventory FOR SELECT TO authenticated
    USING (status = 'available');

DROP POLICY IF EXISTS "Service role manages inventory" ON vehicle_inventory;
CREATE POLICY "Service role manages inventory" ON vehicle_inventory FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- vehicle_sales: Driver sees own, dealer sees own leads, service_role manages
ALTER TABLE vehicle_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Driver sees own vehicle sales" ON vehicle_sales;
CREATE POLICY "Driver sees own vehicle sales" ON vehicle_sales FOR SELECT
    USING (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Dealer sees own sales" ON vehicle_sales;
CREATE POLICY "Dealer sees own sales" ON vehicle_sales FOR SELECT
    USING (dealer_id IN (SELECT id FROM dealer_partners WHERE id = dealer_id));

DROP POLICY IF EXISTS "Service role manages vehicle sales" ON vehicle_sales;
CREATE POLICY "Service role manages vehicle sales" ON vehicle_sales FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- fleet_vehicles: Drivers can browse available, service_role manages
ALTER TABLE fleet_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can browse available fleet vehicles" ON fleet_vehicles;
CREATE POLICY "Drivers can browse available fleet vehicles" ON fleet_vehicles FOR SELECT TO authenticated
    USING (status = 'available' OR status = 'leased');

DROP POLICY IF EXISTS "Service role manages fleet vehicles" ON fleet_vehicles;
CREATE POLICY "Service role manages fleet vehicles" ON fleet_vehicles FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- fleet_leases: Driver sees own lease, service_role manages
ALTER TABLE fleet_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Driver sees own lease" ON fleet_leases;
CREATE POLICY "Driver sees own lease" ON fleet_leases FOR SELECT
    USING (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role manages leases" ON fleet_leases;
CREATE POLICY "Service role manages leases" ON fleet_leases FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- lease_payments: Driver sees own, service_role manages
ALTER TABLE lease_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Driver sees own lease payments" ON lease_payments;
CREATE POLICY "Driver sees own lease payments" ON lease_payments FOR SELECT
    USING (lease_id IN (
        SELECT fl.id FROM fleet_leases fl
        JOIN drivers d ON d.id = fl.driver_id
        WHERE d.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Service role manages lease payments" ON lease_payments;
CREATE POLICY "Service role manages lease payments" ON lease_payments FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- =============================================================================
-- GRANT EXECUTE on new RPCs to service_role
-- =============================================================================

GRANT EXECUTE ON FUNCTION get_or_create_region_settings(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION calculate_lease_daily_fee(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION apply_lease_daily_fees(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION get_dealer_brokerage_report(UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION get_fleet_lease_report(UUID, UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION clone_region_settings(TEXT, TEXT, TEXT) TO service_role;

-- =============================================================================
-- SEED: Insert Trinidad and Tobago as the default region
-- =============================================================================

INSERT INTO region_settings (
    code, name, currency, currency_symbol, locale, timezone,
    default_commission_rate, default_driver_payout_rate, default_merchant_split_rate,
    min_fare_cents, base_fare_cents, per_km_cents, per_min_cents,
    cancellation_fee_cents, max_wait_seconds, wait_fee_per_min_cents,
    gridlock_surcharge_cents, gridlock_delay_threshold_seconds,
    gps_proximity_dropoff_meters, gps_proximity_pickup_meters,
    max_offered_radius_meters, ride_offer_ttl_seconds,
    lease_daily_rate_cents, lease_mileage_rate_cents,
    driver_online_debt_limit_cents, ride_creation_debt_limit_cents,
    min_wallet_topup_cents, max_wallet_topup_cents,
    compliance_config
) VALUES (
    'TT', 'Trinidad and Tobago', 'TTD', 'TT$', 'en-TT', 'America/Port_of_Spain',
    22.00, 81.00, 5.00,
    2200, 1600, 175, 95,
    500, 180, 90,
    1500, 900,
    150, 120,
    5000, 30,
    3000, 50,
    60000, 60000,
    2000, 100000,
    jsonb_build_object(
        'insurance_api', NULL,
        'regulatory_body', 'Ministry of Works and Transport',
        'taxi_license_required', true,
        'h_plate_required', true,
        'psv_badge_required', true,
        'data_protection_law', 'Data Protection Act 2011',
        'consumer_protection_law', 'Consumer Protection and Safety Act'
    )
) ON CONFLICT (code) DO NOTHING;

COMMIT;
