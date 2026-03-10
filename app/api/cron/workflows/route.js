// POST /api/cron/workflows — fires all due scheduled workflows
// Called by Railway background worker every 60s
// Auth: x-cron-secret header

import { createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET || 'svets-exec-token-2026'

// Build the task string with notification instructions appended
function buildTask(wf) {
  let task = wf.task.trim()
  const notifs = []
  if (wf.notify_email) notifs.push(`email a concise summary of what you did to ${wf.notify_email}`)
  if (wf.notify_phone) notifs.push(`send an SMS summary to ${wf.notify_phone}`)
  if (wf.notify_slack) notifs.push(`post a summary to the Slack webhook ${wf.notify_slack}`)
  if (notifs.length) {
    task += `\n\nIMPORTANT: When done, ${notifs.join(' and ')}. Keep the notification brief (3-5 bullet points max).`
  }
  return task
}

// Compute next_run from cron expression (handles common patterns)
// cron_expr format: "min hour dom month dow" (standard 5-field cron)
function nextRunFromCron(expr) {
  if (!expr) return null
  try {
    const [min, hour, , , dow] = expr.split(' ')
    const now = new Date()
    const next = new Date(now)
    next.setSeconds(0, 0)

    // Daily at specific time: "30 9 * * *"
    if (min !== '*' && hour !== '*' && dow === '*') {
      next.setHours(parseInt(hour), parseInt(min), 0, 0)
      if (next <= now) next.setDate(next.getDate() + 1)
      return next.toISOString()
    }

    // Weekly on specific day: "0 9 * * 1" (Monday 9am)
    if (min !== '*' && hour !== '*' && dow !== '*') {
      const targetDow = parseInt(dow) // 0=Sun, 1=Mon, ..., 6=Sat
      const currentDow = now.getDay()
      let daysUntil = (targetDow - currentDow + 7) % 7
      if (daysUntil === 0) {
        // Today — check if time already passed
        const todayTarget = new Date(now)
        todayTarget.setHours(parseInt(hour), parseInt(min), 0, 0)
        if (todayTarget <= now) daysUntil = 7
      }
      next.setDate(next.getDate() + daysUntil)
      next.setHours(parseInt(hour), parseInt(min), 0, 0)
      return next.toISOString()
    }

    // Hourly at specific minute: "30 * * * *"
    if (min !== '*' && hour === '*') {
      next.setMinutes(parseInt(min), 0, 0)
      if (next <= now) next.setHours(next.getHours() + 1)
      return next.toISOString()
    }
  } catch {}
  return null
}

export async function POST(req) {
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()
  const now = new Date().toISOString()

  const { data: due, error } = await svc
    .from('agent_workflows')
    .select('*')
    .eq('active', true)
    .lte('next_run', now)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!due?.length) return Response.json({ fired: 0 })

  const reqUrl = new URL(req.url)
  const origin = `${reqUrl.protocol}//${reqUrl.host}`
  const results = []

  for (const wf of due) {
    // Compute next_run: prefer cron_expr, fallback to interval_minutes
    const nextRun = (wf.cron_expr && nextRunFromCron(wf.cron_expr))
      || new Date(Date.now() + (wf.interval_minutes || 60) * 60 * 1000).toISOString()

    // Update immediately to prevent double-fire on concurrent ticks
    await svc.from('agent_workflows').update({
      last_run: now,
      next_run: nextRun,
      run_count: (wf.run_count || 0) + 1,
      updated_at: now,
    }).eq('id', wf.id)

    try {
      const res = await fetch(`${origin}/api/agent-trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: process.env.TRIGGER_SECRET || 'svets-trigger-secret-2026',
          agent_id: wf.agent_id || 'assistant',
          task: buildTask(wf),
          workspaceId: wf.workspace_id || `workflow_${wf.id}`,
        }),
      })

      // Capture output text while draining stream
      let output = ''
      if (res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          output += decoder.decode(value, { stream: true })
        }
      }

      // Strip HTML comment markers, keep readable text
      const cleanOutput = output
        .replace(/<!--[^>]*-->/g, '')
        .trim()
        .slice(0, 2000)

      // Save last output to DB
      await svc.from('agent_workflows').update({ last_output: cleanOutput }).eq('id', wf.id)

      results.push({ id: wf.id, name: wf.name, fired: true, next_run: nextRun })
    } catch (err) {
      results.push({ id: wf.id, name: wf.name, fired: false, error: err.message })
    }
  }

  return Response.json({ fired: results.length, results })
}

export async function GET(req) {
  const secret = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret')
  if (secret !== CRON_SECRET) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const svc = createServiceClient()
  const { data } = await svc.from('agent_workflows')
    .select('id,name,active,last_run,next_run,run_count,interval_minutes,cron_expr,last_output')
    .order('next_run')
  return Response.json(data || [])
}
