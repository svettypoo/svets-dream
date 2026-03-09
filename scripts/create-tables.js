const fs = require('fs')
const https = require('https')

const env = fs.readFileSync('.env.local', 'utf8')
const get = k => { const m = env.match(new RegExp('^' + k + '=(.+)', 'm')); return m ? m[1].trim().replace(/^"|"$/g, '') : null }

const url = get('NEXT_PUBLIC_SUPABASE_URL')
const key = get('SUPABASE_SERVICE_ROLE_KEY')
const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)[1]

const sql = `
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  agent_label text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  org_snapshot jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_conversations_user_agent_idx ON public.agent_conversations(user_id, agent_id);
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agent_conversations' AND policyname = 'Users manage own conversations'
  ) THEN
    CREATE POLICY "Users manage own conversations" ON public.agent_conversations
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
`

const body = JSON.stringify({ query: sql })
const mgmtUrl = new URL(`https://api.supabase.com/v1/projects/${projectRef}/database/query`)

// First try the service role key approach via pg endpoint
// Fall back to REST API exec
const reqOpts = {
  hostname: mgmtUrl.hostname,
  path: mgmtUrl.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
    'Content-Length': Buffer.byteLength(body),
  }
}

const req = https.request(reqOpts, res => {
  let d = ''
  res.on('data', c => d += c)
  res.on('end', () => {
    console.log('Status:', res.statusCode)
    console.log('Response:', d.slice(0, 500))
  })
})
req.on('error', e => console.error('Error:', e.message))
req.write(body)
req.end()
