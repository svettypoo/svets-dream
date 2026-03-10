import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

// GET — list all heartbeat configs for the user
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('heartbeat_configs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ configs: data })
}

// POST — create or update a heartbeat config
export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { agent_id, agent_snapshot, org_snapshot, interval_minutes, prompt, enabled } = await req.json()
  if (!agent_id || !agent_snapshot || !prompt) {
    return Response.json({ error: 'agent_id, agent_snapshot, and prompt are required' }, { status: 400 })
  }

  const svc = createServiceClient()
  const nextRun = new Date(Date.now() + (interval_minutes || 30) * 60 * 1000).toISOString()

  const { data, error } = await svc.from('heartbeat_configs').upsert({
    user_id: user.id,
    agent_id,
    agent_snapshot,
    org_snapshot: org_snapshot || null,
    interval_minutes: interval_minutes || 30,
    prompt,
    enabled: enabled !== false,
    next_run_at: nextRun,
  }, { onConflict: 'user_id,agent_id' }).select().single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ config: data })
}

// DELETE — remove a heartbeat config
export async function DELETE(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const agent_id = searchParams.get('agent_id')
  if (!agent_id) return Response.json({ error: 'agent_id required' }, { status: 400 })

  const svc = createServiceClient()
  const { error } = await svc.from('heartbeat_configs').delete()
    .eq('user_id', user.id)
    .eq('agent_id', agent_id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
