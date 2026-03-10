import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

// GET /api/skills — list all skills for this user (own + builtins)
export async function GET(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { data: skills, error } = await svc
    .from('skills')
    .select('*')
    .or(`user_id.eq.${user.id},is_builtin.eq.true`)
    .order('is_builtin', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ skills })
}

// POST /api/skills — create a new skill
export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { slug, name, description, instructions, tool_definition, api_calls, env_vars } = body

  if (!slug || !name || !tool_definition) {
    return Response.json({ error: 'slug, name, and tool_definition are required' }, { status: 400 })
  }

  const svc = createServiceClient()
  const { data, error } = await svc.from('skills').insert({
    user_id: user.id,
    slug,
    name,
    description: description || '',
    instructions: instructions || null,
    tool_definition,
    api_calls: api_calls || null,
    env_vars: env_vars || null,
    is_builtin: false,
  }).select().single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ skill: data })
}

// DELETE /api/skills?id=UUID — delete a skill
export async function DELETE(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const svc = createServiceClient()
  const { error } = await svc.from('skills').delete().eq('id', id).eq('user_id', user.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

// PATCH /api/skills — assign/unassign skill to agent
// Body: { action: 'assign'|'unassign', agent_id, skill_id }
export async function PATCH(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, agent_id, skill_id } = await req.json()
  const svc = createServiceClient()

  if (action === 'assign') {
    const { error } = await svc.from('agent_skills').upsert({
      user_id: user.id,
      agent_id,
      skill_id,
    }, { onConflict: 'user_id,agent_id,skill_id', ignoreDuplicates: true })
    if (error) return Response.json({ error: error.message }, { status: 500 })
  } else if (action === 'unassign') {
    const { error } = await svc.from('agent_skills').delete()
      .eq('user_id', user.id)
      .eq('agent_id', agent_id)
      .eq('skill_id', skill_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
