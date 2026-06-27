CREATE TABLE puck_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_node_id uuid REFERENCES kiosk_nodes(id),
  puck_tag_uid text,
  event_type text NOT NULL CHECK (event_type IN (
    'tap','scan','ride_requested','ride_completed','first_ride',
    'revenue','heartbeat','status_change','battery_alert'
  )),
  territory_id uuid REFERENCES territories(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_puck_events_node ON puck_events(kiosk_node_id);
CREATE INDEX idx_puck_events_type ON puck_events(event_type);
CREATE INDEX idx_puck_events_territory ON puck_events(territory_id);
CREATE INDEX idx_puck_events_created ON puck_events(created_at DESC);

ALTER TABLE puck_events ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "puck_events admins full access"
  ON puck_events
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Commanders read events in their territory
CREATE POLICY "puck_events commanders read own territory"
  ON puck_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pod_commanders pc
      WHERE pc.user_id = auth.uid()
      AND pc.territory_id = puck_events.territory_id
    )
  );

-- Service role full access (edge functions)
CREATE POLICY "puck_events service role full access"
  ON puck_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
