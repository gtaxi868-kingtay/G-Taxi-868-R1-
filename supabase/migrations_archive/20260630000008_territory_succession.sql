-- ─── TERRITORY SUCCESSOR TABLE ───
CREATE TABLE territory_successors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id uuid REFERENCES territories(id) ON DELETE CASCADE NOT NULL,
  successor_id uuid REFERENCES profiles(id) NOT NULL,
  successor_driver_id uuid REFERENCES drivers(id),
  priority int NOT NULL CHECK (priority BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined','activated')),
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES profiles(id),
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (territory_id, priority),
  UNIQUE (territory_id, successor_id)
);

CREATE INDEX idx_ts_territory ON territory_successors(territory_id);
CREATE INDEX idx_ts_successor ON territory_successors(successor_id);

ALTER TABLE territory_successors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ts admins full access"
  ON territory_successors
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "ts commanders read own"
  ON territory_successors
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pod_commanders pc
      WHERE pc.user_id = auth.uid() AND pc.territory_id = territory_successors.territory_id
    )
  );

CREATE POLICY "ts commanders insert own"
  ON territory_successors
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pod_commanders pc
      WHERE pc.user_id = auth.uid() AND pc.territory_id = territory_successors.territory_id AND pc.status = 'active'
    )
  );

CREATE POLICY "ts commanders update own"
  ON territory_successors
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM pod_commanders pc
      WHERE pc.user_id = auth.uid() AND pc.territory_id = territory_successors.territory_id AND pc.status = 'active'
    )
  );

CREATE POLICY "ts commanders delete own"
  ON territory_successors
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pod_commanders pc
      WHERE pc.user_id = auth.uid() AND pc.territory_id = territory_successors.territory_id AND pc.status = 'active'
    )
  );

CREATE POLICY "ts service role full access"
  ON territory_successors
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── AUTO-SUCCESSION TRIGGER ───
CREATE OR REPLACE FUNCTION auto_succeed_commander()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_successor record;
  v_territory_name text;
BEGIN
  SELECT name INTO v_territory_name FROM territories WHERE id = OLD.territory_id;

  SELECT ts.* INTO v_successor
  FROM territory_successors ts
  WHERE ts.territory_id = OLD.territory_id
    AND ts.is_active = true
    AND ts.status IN ('confirmed', 'pending')
  ORDER BY ts.priority ASC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO pod_commanders (user_id, territory_id, status, metrics)
    VALUES (v_successor.successor_id, OLD.territory_id, 'active', '{}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE
      SET territory_id = OLD.territory_id, status = 'active', updated_at = now();

    UPDATE territories
    SET commander_id = v_successor.successor_id,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'last_succession', jsonb_build_object(
            'from', OLD.user_id,
            'to', v_successor.successor_id,
            'triggered_at', now()::text
          )
        )
    WHERE id = OLD.territory_id;

    UPDATE territory_successors
    SET status = 'activated', confirmed_at = now()
    WHERE id = v_successor.id;

    UPDATE profiles SET role = 'pod_commander' WHERE id = v_successor.successor_id;

    INSERT INTO system_alerts (type, severity, title, details)
    VALUES (
      'COMMANDER_SUCCESSION', 'INFO',
      'Territory auto-succeeded: ' || COALESCE(v_territory_name, 'unknown'),
      jsonb_build_object(
        'territory_id', OLD.territory_id,
        'previous_commander', OLD.user_id,
        'new_commander', v_successor.successor_id,
        'successor_priority', v_successor.priority
      )
    );
  ELSE
    UPDATE territories SET commander_id = NULL WHERE id = OLD.territory_id;

    INSERT INTO system_alerts (type, severity, title, details)
    VALUES (
      'COMMANDER_ORPHANED', 'WARNING',
      'Territory orphaned: ' || COALESCE(v_territory_name, 'unknown'),
      jsonb_build_object(
        'territory_id', OLD.territory_id,
        'previous_commander', OLD.user_id
      )
    );
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_pod_commander_deleted ON pod_commanders;
CREATE TRIGGER trg_pod_commander_deleted
  BEFORE DELETE ON pod_commanders
  FOR EACH ROW
  EXECUTE FUNCTION auto_succeed_commander();
