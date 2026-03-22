-- Enable driver registration feature flag
INSERT INTO system_feature_flags (id, is_active)
VALUES ('driver_registration_active', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;
