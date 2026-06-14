-- Pricing update: T&T market-rate fares + 19% flat platform split
-- 2026-06-14
--
-- Research basis (TTD, June 2026):
--   Short trip 0-5km:  TTD $35-50 (avg rider fare)
--   Medium 5-15km:     TTD $60-100
--   Airport run ~25km: TTD $130-200
--
-- New fare math (sample: 5km / 12min):
--   Base $12 + 5km × $3.50 + 12min × $1.20 = $43.40  ✓ within $35-50
-- Sample 15km / 25min:
--   $12 + $52.50 + $30 = $94.50  ✓ within $60-100
-- Sample 25km / 35min (airport):
--   $12 + $87.50 + $42 = $141.50  ✓ within $130-200
--
-- Platform split (all rides):
--   Platform fee:    19% of gross (standard) / 16% loyalty (wallet ≥ TTD $500)
--   War chest:       1.5% of gross — sub-ledger within platform fee, NOT additional
--   Net platform:    17.5% of gross
--   Driver take-home: 81% of gross (standard) / 84% loyalty
--
-- Merchant dispatch premium: 25% surcharge on base fare when vendor_node_id is set.
-- Vendor commission default: 5% of gross (covers kickback while protecting platform margin).

UPDATE platform_config SET value_cents = 1200, updated_at = now() WHERE key = 'BASE_FARE_CENTS';
UPDATE platform_config SET value_cents = 350,  updated_at = now() WHERE key = 'PER_KM_CENTS';
UPDATE platform_config SET value_cents = 120,  updated_at = now() WHERE key = 'PER_MIN_CENTS';
UPDATE platform_config SET value_cents = 3500, updated_at = now() WHERE key = 'MIN_FARE_CENTS';

INSERT INTO platform_config (key, value_cents, description) VALUES
    ('MERCHANT_DISPATCH_PREMIUM_PCT', 25,  'Percentage surcharge on fares dispatched from a merchant kiosk (vendor_node_id set). Funds vendor commission and protects platform margin.'),
    ('PLATFORM_FEE_PCT',              19,  'Standard platform commission as an integer percentage (19 = 19%). War chest (1.5%) comes from inside this.'),
    ('LOYALTY_FEE_PCT',               16,  'Reduced platform fee for loyalty drivers (wallet balance ≥ TTD $500).'),
    ('CAPITAL_RESERVE_PCT_X10',       15,  'Capital reserve rate × 10 (15 = 1.5%). Sub-ledger within PLATFORM_FEE_PCT — not an additional charge.'),
    ('VENDOR_COMMISSION_DEFAULT_PCT', 5,   'Default vendor/kiosk commission as an integer percentage. Deducted from gross, paid to merchant wallet.')
ON CONFLICT (key) DO UPDATE SET
    value_cents = EXCLUDED.value_cents,
    description = EXCLUDED.description,
    updated_at  = now();

COMMENT ON TABLE platform_config IS 'Live pricing constants. Rider pays gross; platform keeps PLATFORM_FEE_PCT%; driver gets the rest. War chest (1.5%) is a sub-ledger inside platform fee — not an extra charge.';
