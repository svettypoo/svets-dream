import { createServerSupabaseClient } from '@/lib/supabase-server'
import { listVMs, createVM } from '@/lib/vm-manager'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const vms = await listVMs(user.id)
    return Response.json({ vms })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, image, memoryMb } = await req.json()

  try {
    const vm = await createVM(user.id, { name, image, memoryMb })
    return Response.json({ vm })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
