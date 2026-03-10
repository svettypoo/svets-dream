import { createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const maxDuration = 300

// Called by Vercel Cron every 30 minutes: "*/30 * * * *"
// Also callable manually via POST for testing.
export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runHeartbeat()
}

export async function POST(req) {
  // Manual trigger — requires logged-in session
  return runHeartbeat()
}

async function runHeartbeat() {
  const svc = createServiceClient()
  const now = new Date()

  // Find all enabled heartbeat configs that are due
  const { data: configs, error } = await svc
    .from('heartbeat_configs')
    .select('*')
    .eq('enabled', true)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!configs?.length) return Response.json({ ok: true, ran: 0 })

  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://svets-dream.vercel.app'
  const results = []

  for (const config of configs) {
    try {
      // Mark as running (update next_run_at immediately to prevent double-firing)
      const nextRun = new Date(now.getTime() + config.interval_minutes * 60 * 1000)
      await svc.from('heartbeat_configs').update({
        last_run_at: now.toISOString(),
        next_run_at: nextRun.toISOString(),
      }).eq('id', config.id)

      // Fire the agent
      const res = await fetch(`${origin}/api/agent-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass user_id via a special header that the route trusts for heartbeat calls
          'x-heartbeat-user-id': config.user_id,
        },
        body: JSON.stringify({
          agent: config.agent_snapshot,
          messages: [{ role: 'user', content: config.prompt }],
          orgContext: config.org_snapshot,
          _heartbeat: true,
        }),
      })

      // Drain the stream
      const reader = res.body.getReader()
      let output = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        output += new TextDecoder().decode(value, { stream: true })
      }

      // Append heartbeat result to agent log
      const date = now.toISOString().slice(0, 10)
      const timestamp = now.toISOString().slice(11, 19)
      const logLine = `[${timestamp}] HEARTBEAT: ${output.replace(/<!--[^>]*-->/g, '').trim().slice(0, 500)}`
      const { data: existing } = await svc.from('agent_logs')
        .select('id, content')
        .eq('user_id', config.user_id)
        .eq('agent_id', config.agent_id)
        .eq('date', date)
        .maybeSingle()
      if (existing) {
        await svc.from('agent_logs').update({ content: existing.content + '\n' + logLine, updated_at: new Date().toISOString() }).eq('id', existing.id)
      } else {
        await svc.from('agent_logs').insert({ user_id: config.user_id, agent_id: config.agent_id, date, content: logLine })
      }

      results.push({ agentId: config.agent_id, ok: true })
    } catch (err) {
      results.push({ agentId: config.agent_id, ok: false, error: err.message })
    }
  }

  return Response.json({ ok: true, ran: results.length, results })
}
