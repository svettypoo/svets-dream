CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  send_at TIMESTAMPTZ NOT NULL,
  channels TEXT[] DEFAULT '{email}',
  email TEXT,
  phone TEXT,
  repeat TEXT CHECK (repeat IN ('daily', 'weekly', 'monthly') OR repeat IS NULL),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  fired_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(send_at) WHERE status = 'pending';
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own reminders" ON reminders FOR ALL USING (auth.uid() = user_id);
