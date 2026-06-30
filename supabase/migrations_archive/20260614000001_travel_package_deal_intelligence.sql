-- Add Rockefeller deal intelligence columns to travel_packages.
-- deal_phase: which negotiation tier sourced this rate
-- rate_expiry_at: when the wholesale rate quote lapses
-- rate_contact: who to call/email when the rate needs renegotiating
-- rate_source: audit trail of how the rate was obtained

ALTER TABLE travel_packages
    ADD COLUMN IF NOT EXISTS deal_phase TEXT
        CHECK (deal_phase IN ('phase_1', 'phase_2', 'phase_3')),
    ADD COLUMN IF NOT EXISTS rate_expiry_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rate_contact TEXT,
    ADD COLUMN IF NOT EXISTS rate_source TEXT;

-- Index so admin can quickly surface expiring rates
CREATE INDEX IF NOT EXISTS idx_travel_packages_rate_expiry
    ON travel_packages(rate_expiry_at)
    WHERE rate_expiry_at IS NOT NULL AND status = 'active';

COMMENT ON COLUMN travel_packages.deal_phase IS 'Rockefeller phase: phase_1=10% group desk, phase_2=50% last-seat block, phase_3=IATA consolidator';
COMMENT ON COLUMN travel_packages.rate_expiry_at IS 'Timestamp when the wholesale rate quote from the supplier lapses — admin must renegotiate before this date';
COMMENT ON COLUMN travel_packages.rate_contact IS 'Who to contact when the rate needs renewal (name, email, or phone)';
COMMENT ON COLUMN travel_packages.rate_source IS 'How the rate was sourced: CAL group quote, iCal, API, direct negotiation, etc.';
