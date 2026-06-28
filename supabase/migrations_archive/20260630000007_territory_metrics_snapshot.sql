CREATE TABLE territory_metrics_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id uuid REFERENCES territories(id) NOT NULL,
  snapshot_at timestamptz DEFAULT now(),

  -- Supply metrics
  total_drivers int NOT NULL DEFAULT 0,
  active_drivers int NOT NULL DEFAULT 0,
  online_drivers int NOT NULL DEFAULT 0,
  pending_drivers int NOT NULL DEFAULT 0,
  total_merchants int NOT NULL DEFAULT 0,
  active_merchants int NOT NULL DEFAULT 0,
  total_pucks int NOT NULL DEFAULT 0,
  live_pucks int NOT NULL DEFAULT 0,

  -- Demand metrics (7-day rolling)
  rides_last_7d int NOT NULL DEFAULT 0,
  completed_rides_last_7d int NOT NULL DEFAULT 0,
  unique_riders_last_7d int NOT NULL DEFAULT 0,
  total_revenue_cents bigint NOT NULL DEFAULT 0,
  avg_wait_time_seconds numeric,
  avg_ride_fare_cents numeric,

  -- Quality metrics
  avg_rating numeric,
  cancellation_rate numeric,
  driver_utilization_pct numeric,

  -- Growth metrics
  new_drivers_7d int NOT NULL DEFAULT 0,
  new_merchants_7d int NOT NULL DEFAULT 0,
  new_riders_7d int NOT NULL DEFAULT 0,

  UNIQUE (territory_id, snapshot_at)
);

CREATE INDEX idx_territory_metrics_territory ON territory_metrics_snapshot(territory_id);
CREATE INDEX idx_territory_metrics_snapshot_time ON territory_metrics_snapshot(territory_id, snapshot_at DESC);

ALTER TABLE territory_metrics_snapshot ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "tms admins full access"
  ON territory_metrics_snapshot
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Commanders read own territory snapshots
CREATE POLICY "tms commanders read own territory"
  ON territory_metrics_snapshot
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pod_commanders pc
      WHERE pc.user_id = auth.uid()
      AND pc.territory_id = territory_metrics_snapshot.territory_id
    )
  );

-- Service role full access (for cron compute function)
CREATE POLICY "tms service role full access"
  ON territory_metrics_snapshot
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
