CREATE TABLE IF NOT EXISTS slack_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT,
  user_id TEXT,
  channel TEXT,
  command TEXT,
  text TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
