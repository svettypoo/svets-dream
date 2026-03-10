#!/usr/bin/env node
// Railway Cron Runner — deploy as a separate Railway service
// Set START_COMMAND=node scripts/railway-cron.js
// Set APP_URL and CRON_SECRET env vars

const https = require('https')

const APP_URL = process.env.APP_URL || 'https://your-app.vercel.app'
const CRON_SECRET = process.env.CRON_SECRET || ''
const CRON_HOUR_UTC = parseInt(process.env.CRON_HOUR_UTC || '8', 10) // default 8am UTC

function runCron() {
  const url = new URL(`${APP_URL}/api/cron`)
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'GET',
    headers: { 'x-cron-secret': CRON_SECRET },
  }
  const req = (url.protocol === 'https:' ? https : require('http')).request(options, res => {
    let data = ''
    res.on('data', chunk => data += chunk)
    res.on('end', () => console.log(`[cron] ${new Date().toISOString()} → ${res.statusCode}`, data.slice(0, 200)))
  })
  req.on('error', err => console.error('[cron] error:', err.message))
  req.end()
}

// Schedule: run every day at CRON_HOUR_UTC
function schedule() {
  const now = new Date()
  const next = new Date(now)
  next.setUTCHours(CRON_HOUR_UTC, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  const msUntilNext = next - now
  console.log(`[cron] next run at ${next.toISOString()} (in ${Math.round(msUntilNext / 60000)} min)`)
  setTimeout(() => { runCron(); setInterval(runCron, 24 * 60 * 60 * 1000) }, msUntilNext)
}

schedule()
