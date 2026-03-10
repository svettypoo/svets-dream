#!/usr/bin/env node
// Svet's Dream — workflow runner daemon
// Runs on Railway execution server, polls agent_workflows every 60s and fires due ones
// Start: nohup node /root/workspace/scripts/workflow-runner.js > /root/workspace/workflow-runner.log 2>&1 &

const https = require('https')
const http = require('http')

const SVETS_DREAM_URL = 'https://svets-dream.vercel.app'
const CRON_SECRET = 'svets-exec-token-2026'
const POLL_INTERVAL = 60 * 1000 // 60 seconds

function postJSON(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const data = JSON.stringify(body)
    const lib = parsed.protocol === 'https:' ? https : http
    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    }, res => {
      let out = ''
      res.on('data', d => out += d)
      res.on('end', () => resolve({ status: res.statusCode, body: out }))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function tick() {
  try {
    const res = await postJSON(
      `${SVETS_DREAM_URL}/api/cron/workflows`,
      {},
      { 'x-cron-secret': CRON_SECRET }
    )
    const parsed = JSON.parse(res.body)
    if (parsed.fired > 0) {
      console.log(`[${new Date().toISOString()}] Fired ${parsed.fired} workflow(s):`, parsed.results?.map(r => r.name).join(', '))
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] tick error:`, err.message)
  }
}

console.log(`[${new Date().toISOString()}] Workflow runner started. Polling every ${POLL_INTERVAL / 1000}s.`)
tick() // fire immediately on start
setInterval(tick, POLL_INTERVAL)
