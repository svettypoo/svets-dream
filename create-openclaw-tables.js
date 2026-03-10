#!/usr/bin/env node
// Run: node create-openclaw-tables.js
// Creates the 5 new Supabase tables for OpenClaw features

const fs = require('fs')
const https = require('https')

const env = fs.readFileSync('.env.local', 'utf8')
const get = k => { const m = env.match(new RegExp('^' + k + '=(.+)', 'm')); return m ? m[1].trim().replace(/^"|"$/g, '') : null }

const SUPABASE_URL = get('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = get('SUPABASE_SERVICE_ROLE_KEY')

async function sql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query })
    const u = new URL(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`)
    const options = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
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

async function runSQL(label, query) {
  console.log(`\n→ ${label}`)
  const r = await sql(query)
  if (r.status >= 400) {
    // Try alternative: direct table creation via REST management API
    console.log(`  HTTP ${r.status}: ${r.body.slice(0, 200)}`)
    return false
  }
  console.log(`  ✓ HTTP ${r.status}`)
  return true
}

const migrations = [
  {
    label: 'agent_sessions table (persistent session history)',
    sql: `
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id text NOT NULL,
        workspace_id text NOT NULL,
        agent_id text NOT NULL,
        messages jsonb DEFAULT '[]'::jsonb,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE(user_id, workspace_id, agent_id)
      );
      ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY IF NOT EXISTS "service role full access" ON agent_sessions USING (true) WITH CHECK (true);
    `
  },
  {
    label: 'agent_blackboard table (shared key-value store)',
    sql: `
      CREATE TABLE IF NOT EXISTS agent_blackboard (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id text NOT NULL,
        workspace_id text NOT NULL,
        key text NOT NULL,
        value jsonb,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE(user_id, workspace_id, key)
      );
      ALTER TABLE agent_blackboard ENABLE ROW LEVEL SECURITY;
      CREATE POLICY IF NOT EXISTS "service role full access" ON agent_blackboard USING (true) WITH CHECK (true);
    `
  },
  {
    label: 'agent_artifacts table (artifact registry)',
    sql: `
      CREATE TABLE IF NOT EXISTS agent_artifacts (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id text NOT NULL,
        workspace_id text,
        agent_id text,
        type text NOT NULL,
        path text,
        url text,
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      );
      ALTER TABLE agent_artifacts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY IF NOT EXISTS "service role full access" ON agent_artifacts USING (true) WITH CHECK (true);
    `
  },
  {
    label: 'pending_approvals table (HITL)',
    sql: `
      CREATE TABLE IF NOT EXISTS pending_approvals (
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
      );
      ALTER TABLE pending_approvals ENABLE ROW LEVEL SECURITY;
      CREATE POLICY IF NOT EXISTS "service role full access" ON pending_approvals USING (true) WITH CHECK (true);
    `
  },
  {
    label: 'agent_trigger_log table (event triggers)',
    sql: `
      CREATE TABLE IF NOT EXISTS agent_trigger_log (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        agent_id text,
        task text,
        workspace_id text,
        source text DEFAULT 'webhook',
        triggered_at timestamptz DEFAULT now()
      );
      ALTER TABLE agent_trigger_log ENABLE ROW LEVEL SECURITY;
      CREATE POLICY IF NOT EXISTS "service role full access" ON agent_trigger_log USING (true) WITH CHECK (true);
    `
  },
]

;(async () => {
  console.log(`Creating OpenClaw tables in Supabase: ${SUPABASE_URL}`)
  let allOk = true
  for (const m of migrations) {
    const ok = await runSQL(m.label, m.sql)
    if (!ok) allOk = false
  }
  if (!allOk) {
    console.log('\n⚠️  Some migrations failed via exec_sql RPC. Running via Supabase CLI instead...')
    // Write migration file and run via CLI
    const allSQL = migrations.map(m => `-- ${m.label}\n${m.sql}`).join('\n\n')
    fs.writeFileSync('/tmp/openclaw-migration.sql', allSQL)
    const { execSync } = require('child_process')
    try {
      execSync(`SUPABASE_ACCESS_TOKEN=${get('SUPABASE_ACCESS_TOKEN')} supabase db execute --project-ref xocfduqugghailalzlqy --file /tmp/openclaw-migration.sql`, { stdio: 'inherit' })
      console.log('✅ Migration applied via Supabase CLI')
    } catch (e) {
      console.log('❌ CLI also failed:', e.message)
      console.log('\nRun this SQL manually in the Supabase dashboard SQL editor:')
      console.log(allSQL)
    }
  } else {
    console.log('\n✅ All tables created successfully!')
  }
})()
