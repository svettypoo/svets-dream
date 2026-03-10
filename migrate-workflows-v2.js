#!/usr/bin/env node
const https = require('https')
const ACCESS_TOKEN = 'sbp_803303e69c9d5ad01cf12adcc6ad17747bd38d03'
const PROJECT_REF = 'xocfduqugghailalzlqy'

async function sql(label, query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query })
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${ACCESS_TOKEN}` },
    }, res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => { console.log(`${res.statusCode < 400 ? '✅' : '❌'} ${label}`); if (res.statusCode >= 400) console.log('  ', d.slice(0, 200)); resolve() })
    })
    req.on('error', reject); req.write(body); req.end()
  })
}

;(async () => {
  await sql('Add notify_email', `ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS notify_email text`)
  await sql('Add notify_phone', `ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS notify_phone text`)
  await sql('Add notify_slack', `ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS notify_slack text`)
  await sql('Add cron_expr', `ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS cron_expr text`)
  await sql('Add last_output', `ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS last_output text`)
  console.log('Done.')
})()
