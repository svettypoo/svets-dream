#!/usr/bin/env node
const https = require('https')

const ACCESS_TOKEN = 'sbp_803303e69c9d5ad01cf12adcc6ad17747bd38d03'
const PROJECT_REF = 'xocfduqugghailalzlqy'

async function runSQL(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query })
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      },
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const migrations = [
  {
    label: 'agent_tasks table',
    sql: `CREATE TABLE IF NOT EXISTS agent_tasks (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id text NOT NULL DEFAULT 'svet',
      title text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','cancelled','waiting')),
      priority integer NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
      due_date date,
      tags text[],
      parent_id uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
      workspace_id text,
      agent_id text,
      notes text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )`,
  },
  {
    label: 'Enable RLS',
    sql: `ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY`,
  },
  {
    label: 'RLS policy',
    sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_tasks' AND policyname='service_full') THEN CREATE POLICY service_full ON agent_tasks USING (true) WITH CHECK (true); END IF; END $$`,
  },
  {
    label: 'updated_at trigger function',
    sql: `CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql`,
  },
  {
    label: 'updated_at trigger on agent_tasks',
    sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='set_agent_tasks_updated_at') THEN CREATE TRIGGER set_agent_tasks_updated_at BEFORE UPDATE ON agent_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`,
  },
]

;(async () => {
  for (const m of migrations) {
    const r = await runSQL(m.sql)
    const ok = r.status < 400
    console.log(`${ok ? '✅' : '❌'} ${m.label} (HTTP ${r.status})`)
    if (!ok) console.log('   ', r.body.slice(0, 200))
  }
  console.log('\nDone.')
})()
