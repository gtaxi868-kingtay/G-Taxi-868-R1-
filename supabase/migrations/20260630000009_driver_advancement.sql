-- ─── DRIVER RANK ───
DO $$ BEGIN
  CREATE TYPE driver_rank AS ENUM ('driver', 'senior_driver', 'commander_candidate');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rank driver_rank NOT NULL DEFAULT 'driver';

-- ─── PROMOTION LOG ───
CREATE TABLE promotion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES drivers(id) NOT NULL,
  from_rank driver_rank,
  to_rank driver_rank NOT NULL,
  authorized_by uuid REFERENCES profiles(id),
  promotion_score numeric CHECK (promotion_score BETWEEN 0 AND 100),
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_promotion_log_driver ON promotion_log(driver_id);
CREATE INDEX idx_promotion_log_created ON promotion_log(created_at DESC);

ALTER TABLE promotion_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pl admins full access"
  ON promotion_log
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "pl commanders read own territory"
  ON promotion_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pod_commanders pc
      JOIN drivers d ON d.id = promotion_log.driver_id
      WHERE pc.user_id = auth.uid() AND pc.territory_id = d.territory_id
    )
  );

CREATE POLICY "pl service role full access"
  ON promotion_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── TENURE TRACKING ───
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS territory_joined_at timestamptz;
