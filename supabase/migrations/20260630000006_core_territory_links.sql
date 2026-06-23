-- Add territory_id to drivers
ALTER TABLE drivers ADD COLUMN territory_id uuid REFERENCES territories(id);
CREATE INDEX idx_drivers_territory ON drivers(territory_id);

-- Add territory_id to merchants
ALTER TABLE merchants ADD COLUMN territory_id uuid REFERENCES territories(id);
CREATE INDEX idx_merchants_territory ON merchants(territory_id);

-- Add territory_id to rides
ALTER TABLE rides ADD COLUMN territory_id uuid REFERENCES territories(id);
CREATE INDEX idx_rides_territory ON rides(territory_id);
