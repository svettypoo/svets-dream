CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Auto-delete logs older than 90 days (optional — remove if you need permanent retention)
-- CREATE OR REPLACE FUNCTION delete_old_audit_logs() RETURNS trigger AS $$
-- BEGIN
--   DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';
--   RETURN NULL;
-- END;
-- $$ LANGUAGE plpgsql;
