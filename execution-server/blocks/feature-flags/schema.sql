CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  plans TEXT[],  -- e.g. ['pro','business'] — null means all plans
  user_overrides JSONB DEFAULT '{}',  -- { "user-uuid": true/false }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Seed some example flags
INSERT INTO feature_flags (key, description, enabled, plans) VALUES
  ('ai_chat', 'AI chat assistant', true, ARRAY['pro','business']),
  ('export_csv', 'CSV data export', true, ARRAY['business']),
  ('api_access', 'API key access', true, ARRAY['business']),
  ('advanced_analytics', 'Advanced analytics dashboard', true, ARRAY['pro','business'])
ON CONFLICT (key) DO NOTHING;
