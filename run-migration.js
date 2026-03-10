#!/usr/bin/env node
const https = require('https')
const fs = require('fs')

const ACCESS_TOKEN = 'sbp_803303e69c9d5ad01cf12adcc6ad17747bd38d03'
const PROJECT_REF = 'xocfduqugghailalzlqy'

const migrations = [
  `CREATE TABLE IF NOT EXISTS agent_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text NOT NULL,
    agent_id text NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, workspace_id, agent_id)
  )`,
  `ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_sessions' AND policyname='service_full') THEN CREATE POLICY service_full ON agent_sessions USING (true) WITH CHECK (true); END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS agent_blackboard (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text NOT NULL,
    key text NOT NULL,
    value jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, workspace_id, key)
  )`,
  `ALTER TABLE agent_blackboard ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_blackboard' AND policyname='service_full') THEN CREATE POLICY service_full ON agent_blackboard USING (true) WITH CHECK (true); END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS agent_artifacts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text,
    agent_id text,
    type text NOT NULL,
    path text,
    url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
  )`,
  `ALTER TABLE agent_artifacts ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_artifacts' AND policyname='service_full') THEN CREATE POLICY service_full ON agent_artifacts USING (true) WITH CHECK (true); END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS pending_approvals (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text,
    agent_id text,
    question text NOT NULL,
    context text,
    options jsonb,
    status text DEFAULT 'pending',
    response text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  )`,
  `ALTER TABLE pending_approvals ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pending_approvals' AND policyname='service_full') THEN CREATE POLICY service_full ON pending_approvals USING (true) WITH CHECK (true); END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS agent_trigger_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id text,
    task text,
    workspace_id text,
    source text DEFAULT 'webhook',
    triggered_at timestamptz DEFAULT now()
  )`,
  `ALTER TABLE agent_trigger_log ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_trigger_log' AND policyname='service_full') THEN CREATE POLICY service_full ON agent_trigger_log USING (true) WITH CHECK (true); END IF; END $$`,
]

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

;(async () => {
  for (const q of migrations) {
    const label = q.trim().slice(0, 60).replace(/\n/g, ' ')
    const r = await runSQL(q)
    if (r.status >= 400) {
      console.log(`❌ ${label}`)
      console.log(`   HTTP ${r.status}: ${r.body.slice(0, 200)}`)
    } else {
      console.log(`✅ ${label}`)
    }
  }
  console.log('\nDone.')
})()
