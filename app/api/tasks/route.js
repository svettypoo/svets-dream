import { createServiceClient } from '@/lib/supabase-server'

export async function GET(req) {
  try {
    const url = new URL(req.url)
    const workspaceId = url.searchParams.get('workspaceId')
    const status = url.searchParams.get('status')
    const limit = parseInt(url.searchParams.get('limit') || '50')

    const svc = createServiceClient()
    let q = svc.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(limit)
    if (workspaceId) q = q.eq('workspace_id', workspaceId)
    if (status) q = q.eq('status', status)

    const { data, error } = await q
    if (error) throw error
    return Response.json(data || [])
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const { id, status, notes } = await req.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const updates = { updated_at: new Date().toISOString() }
    if (status) updates.status = status
    if (notes !== undefined) updates.notes = notes

    const svc = createServiceClient()
    const { data, error } = await svc.from('agent_tasks').update(updates).eq('id', id).select().single()
    if (error) throw error
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
