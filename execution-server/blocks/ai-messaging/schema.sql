CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  channel TEXT DEFAULT 'chat',
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  from_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_id ON ai_conversations(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id);
