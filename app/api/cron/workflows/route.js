// POST /api/cron/workflows — fires all due scheduled workflows
// Called by Railway background worker every 60s
// Auth: x-cron-secret header

import { createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const maxDuration = 300

const CRON_SECRET = process.env.CRON_SECRET || 'svets-exec-token-2026'

export async function POST(req) {
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()
  const now = new Date().toISOString()

  // Fetch all due workflows
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
    // Compute next_run before firing
    const nextRun = new Date(Date.now() + wf.interval_minutes * 60 * 1000).toISOString()

    // Update last_run + next_run + run_count immediately (so concurrent ticks don't double-fire)
    await svc.from('agent_workflows').update({
      last_run: now,
      next_run: nextRun,
      run_count: (wf.run_count || 0) + 1,
      updated_at: now,
    }).eq('id', wf.id)

    // Fire via agent-trigger
    try {
      const res = await fetch(`${origin}/api/agent-trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: process.env.TRIGGER_SECRET || 'svets-trigger-secret-2026',
          agent_id: wf.agent_id || 'assistant',
          task: wf.task,
          workspaceId: wf.workspace_id || `workflow_${wf.id}`,
        }),
      })
      // Drain the stream so it completes
      if (res.body) {
        const reader = res.body.getReader()
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      }
      results.push({ id: wf.id, name: wf.name, fired: true })
    } catch (err) {
      results.push({ id: wf.id, name: wf.name, fired: false, error: err.message })
    }
  }

  return Response.json({ fired: results.length, results })
}

// GET — list recently due/run workflows (for monitoring)
export async function GET(req) {
  const secret = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret')
  if (secret !== CRON_SECRET) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const svc = createServiceClient()
  const { data } = await svc.from('agent_workflows').select('id,name,active,last_run,next_run,run_count,interval_minutes').order('next_run')
  return Response.json(data || [])
}
