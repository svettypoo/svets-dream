#!/usr/bin/env node
const https = require('https')

const ACCESS_TOKEN = 'sbp_803303e69c9d5ad01cf12adcc6ad17747bd38d03'
const PROJECT_REF = 'xocfduqugghailalzlqy'

async function runSQL(label, query) {
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
      res.on('end', () => {
        const ok = res.statusCode < 400
        console.log(`${ok ? '✅' : '❌'} ${label} (HTTP ${res.statusCode})`)
        if (!ok) console.log('   ', data.slice(0, 300))
        resolve({ status: res.statusCode, body: data })
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

;(async () => {
  await runSQL('agent_workflows table', `
    CREATE TABLE IF NOT EXISTS agent_workflows (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id text NOT NULL DEFAULT 'svet',
      name text NOT NULL,
      description text,
      task text NOT NULL,
      interval_minutes integer NOT NULL DEFAULT 60,
      workspace_id text,
      agent_id text,
      active boolean NOT NULL DEFAULT true,
      last_run timestamptz,
      next_run timestamptz NOT NULL DEFAULT now(),
      run_count integer NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `)
  await runSQL('Enable RLS', `ALTER TABLE agent_workflows ENABLE ROW LEVEL SECURITY`)
  await runSQL('RLS policy', `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_workflows' AND policyname='service_full') THEN CREATE POLICY service_full ON agent_workflows USING (true) WITH CHECK (true); END IF; END $$`)
  await runSQL('updated_at trigger', `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='set_agent_workflows_updated_at') THEN CREATE TRIGGER set_agent_workflows_updated_at BEFORE UPDATE ON agent_workflows FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`)
  console.log('\nDone.')
})()
