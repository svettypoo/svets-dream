// ── Feature 5: Event-driven triggers ──────────────────────────────────────
// POST /api/agent-trigger — trigger an agent run from a webhook or cron
// Body: { secret, agent_id, task, orgContext?, workspaceId?, rules? }
// Returns streaming text response from the agent

import { createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const maxDuration = 300

const TRIGGER_SECRET = process.env.TRIGGER_SECRET || 'svets-trigger-secret-2026'

export async function POST(req) {
  try {
    const body = await req.json()
    const { secret, agent_id, task, orgContext, workspaceId, rules, tokenBudget } = body

    // Auth: require secret header or body field
    const headerSecret = req.headers.get('x-trigger-secret')
    if (secret !== TRIGGER_SECRET && headerSecret !== TRIGGER_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    if (!agent_id || !task) {
      return new Response(JSON.stringify({ error: 'agent_id and task are required' }), { status: 400 })
    }

    // Log the trigger event
    try {
      const svc = createServiceClient()
      await svc.from('agent_trigger_log').insert({
        agent_id,
        task: task.slice(0, 500),
        workspace_id: workspaceId || 'global',
        triggered_at: new Date().toISOString(),
        source: req.headers.get('x-trigger-source') || 'webhook',
      })
    } catch {} // non-fatal

    // Look up agent config (from orgContext if provided, else build a default)
    let agentConfig = orgContext?.nodes?.find(n => n.id === agent_id || n.label === agent_id)
    if (!agentConfig) {
      agentConfig = {
        id: agent_id,
        label: agent_id,
        role: 'Autonomous Agent',
        description: 'An autonomous agent triggered by an event.',
        level: 1,
      }
    }

    // Build the URL for the agent-chat route
    const reqUrl = new URL(req.url)
    const origin = `${reqUrl.protocol}//${reqUrl.host}`

    // Fire the agent and stream back
    const res = await fetch(`${origin}/api/agent-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: agentConfig,
        messages: [{ role: 'user', content: task }],
        orgContext: orgContext || null,
        rules: rules || null,
        workspaceId: workspaceId || `trigger_${Date.now()}`,
        quickMode: true, // triggered tasks report directly, no CTO overhead
        tokenBudget: tokenBudget || null,
      }),
    })

    // Stream agent output back to caller
    return new Response(res.body, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

// GET /api/agent-trigger — list recent trigger events
export async function GET(req) {
  try {
    const url = new URL(req.url)
    const secret = url.searchParams.get('secret')
    if (secret !== TRIGGER_SECRET && req.headers.get('x-trigger-secret') !== TRIGGER_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
    const svc = createServiceClient()
    const { data } = await svc.from('agent_trigger_log')
      .select('*')
      .order('triggered_at', { ascending: false })
      .limit(50)
    return new Response(JSON.stringify(data || []), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
