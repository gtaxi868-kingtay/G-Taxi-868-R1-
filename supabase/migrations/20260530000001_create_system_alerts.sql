CREATE TABLE IF NOT EXISTS system_alerts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL CHECK (type IN (
                    'RECONCILIATION_FAILURE',
                    'PAYMENT_ANOMALY',
                    'GPS_SPOOF_ESCALATION',
                    'STATE_MACHINE_VIOLATION',
                    'RATE_LIMIT_BURST',
                    'ADMIN_OVERRIDE'
                )),
    severity    TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    title       TEXT NOT NULL,
    details     JSONB DEFAULT '{}',
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'system_alerts'
    AND policyname = 'Admins can read system_alerts'
  ) THEN
    CREATE POLICY "Admins can read system_alerts" ON system_alerts
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'system_alerts'
    AND policyname = 'Service role only can insert system_alerts'
  ) THEN
    CREATE POLICY "Service role only can insert system_alerts" ON system_alerts
      FOR INSERT WITH CHECK (false);
  END IF;
END $$;

CREATE INDEX idx_system_alerts_type ON system_alerts(type);
CREATE INDEX idx_system_alerts_severity ON system_alerts(severity);
CREATE INDEX idx_system_alerts_created ON system_alerts(created_at DESC);
CREATE INDEX idx_system_alerts_unresolved ON system_alerts(created_at DESC) WHERE resolved_at IS NULL;
