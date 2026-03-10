#!/usr/bin/env node
// Svet's Dream — workflow runner daemon
// Polls /api/cron/workflows every 60s and fires due workflows
// Resilient: catches all errors, never exits, logs everything

const https = require('https')

const SVETS_DREAM_URL = 'https://svets-dream.vercel.app'
const CRON_SECRET = 'svets-exec-token-2026'
const POLL_MS = 60 * 1000
let consecutiveErrors = 0

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`)
}

function postJSON(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': 2, // empty body {}
        'x-cron-secret': CRON_SECRET,
      },
    }, res => {
      let out = ''
      res.on('data', d => out += d)
      res.on('end', () => resolve({ status: res.statusCode, body: out }))
    })
    req.setTimeout(55000, () => { req.destroy(new Error('Request timeout')) })
    req.on('error', reject)
    req.write('{}')
    req.end()
  })
}

async function tick() {
  try {
    const res = await postJSON(`${SVETS_DREAM_URL}/api/cron/workflows`)
    let parsed
    try { parsed = JSON.parse(res.body) } catch { parsed = {} }

    if (res.status === 200) {
      consecutiveErrors = 0
      if (parsed.fired > 0) {
        log(`Fired ${parsed.fired} workflow(s): ${parsed.results?.map(r => r.name).join(', ')}`)
      }
    } else if (res.status === 401) {
      log(`Auth error — check CRON_SECRET. Will keep retrying.`)
    } else {
      consecutiveErrors++
      log(`HTTP ${res.status} (error #${consecutiveErrors}): ${res.body.slice(0, 100)}`)
    }
  } catch (err) {
    consecutiveErrors++
    log(`tick error #${consecutiveErrors}: ${err.message}`)
  }
}

// Start
log(`Workflow runner started. Polling every ${POLL_MS / 1000}s → ${SVETS_DREAM_URL}`)
tick() // immediate first tick

const timer = setInterval(tick, POLL_MS)

// Never exit — catch everything
process.on('uncaughtException', err => log(`uncaughtException: ${err.message}`))
process.on('unhandledRejection', err => log(`unhandledRejection: ${err}`))

// Keep-alive: log heartbeat every 10 minutes
setInterval(() => {
  log(`heartbeat — uptime ${Math.floor(process.uptime() / 60)}m, errors: ${consecutiveErrors}`)
}, 10 * 60 * 1000)
