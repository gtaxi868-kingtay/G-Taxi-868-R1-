ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'
CHECK (role IN ('user', 'driver', 'admin'));
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
