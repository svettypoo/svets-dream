import { NextResponse } from 'next/server'

// This endpoint is called by the Railway cron service (scripts/railway-cron.js)
// or by any external scheduler (Vercel cron, GitHub Actions, etc.)
// Auth: CRON_SECRET env var

export async function GET(req) {
  const secret = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const results = []

  try {
    // ── Add your scheduled jobs here ──────────────────────────────────────
    // Example: daily email digest
    // const users = await getActiveUsers()
    // for (const user of users) {
    //   await sendDailyDigest(user)
    //   results.push({ job: 'daily_digest', userId: user.id, ok: true })
    // }

    results.push({ job: 'heartbeat', time: now.toISOString(), ok: true })

    console.log(`[cron] ran at ${now.toISOString()}:`, results)
    return NextResponse.json({ ok: true, ran: now.toISOString(), results })
  } catch (err) {
    console.error('[cron] error:', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
