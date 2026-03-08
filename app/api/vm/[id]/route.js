import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getVMStatus, startVM, stopVM, destroyVM } from '@/lib/vm-manager'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const vm = await getVMStatus(params.id, user.id)
    return Response.json({ vm })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req, { params }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json()

  try {
    let vm
    if (action === 'start') vm = await startVM(params.id, user.id)
    else if (action === 'stop') vm = await stopVM(params.id, user.id)
    else return Response.json({ error: 'Unknown action' }, { status: 400 })
    return Response.json({ vm })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req, { params }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await destroyVM(params.id, user.id)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
