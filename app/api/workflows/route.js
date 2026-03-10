import { createServiceClient } from '@/lib/supabase-server'

export async function GET(req) {
  try {
    const url = new URL(req.url)
    const active = url.searchParams.get('active')
    const svc = createServiceClient()
    let q = svc.from('agent_workflows').select('*').order('created_at', { ascending: false })
    if (active !== null) q = q.eq('active', active === 'true')
    const { data, error } = await q
    if (error) throw error
    return Response.json(data || [])
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const { name, description, task, interval_minutes, workspace_id, agent_id } = await req.json()
    if (!name || !task) return Response.json({ error: 'name and task required' }, { status: 400 })
    const svc = createServiceClient()
    const next_run = new Date(Date.now() + (interval_minutes || 60) * 60 * 1000).toISOString()
    const { data, error } = await svc.from('agent_workflows').insert({
      name, description, task,
      interval_minutes: interval_minutes || 60,
      workspace_id, agent_id,
      next_run,
      active: true,
    }).select().single()
    if (error) throw error
    return Response.json(data, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const { id, active, name, task, interval_minutes } = await req.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const updates = { updated_at: new Date().toISOString() }
    if (active !== undefined) updates.active = active
    if (name !== undefined) updates.name = name
    if (task !== undefined) updates.task = task
    if (interval_minutes !== undefined) {
      updates.interval_minutes = interval_minutes
      updates.next_run = new Date(Date.now() + interval_minutes * 60 * 1000).toISOString()
    }
    const svc = createServiceClient()
    const { data, error } = await svc.from('agent_workflows').update(updates).eq('id', id).select().single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const svc = createServiceClient()
    const { error } = await svc.from('agent_workflows').delete().eq('id', id)
    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
