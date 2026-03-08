import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-server'
import { encryptCard as encrypt, decryptCard as decrypt } from '@/lib/spend-tracker'

export const runtime = 'nodejs'

const secret = () => process.env.CARD_ENCRYPTION_SECRET || process.env.ANTHROPIC_API_KEY

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data } = await service
    .from('user_api_keys')
    .select('service')
    .eq('user_id', user.id)

  // Only return which services have keys, not the actual keys
  const keys = {}
  for (const row of (data || [])) {
    keys[row.service] = '••••••••'
  }

  return Response.json({ keys })
}

export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { service, key } = await req.json()
  if (!service || !key) return Response.json({ error: 'Missing fields' }, { status: 400 })

  const encrypted = encrypt({ key }, secret())

  const db = createServiceClient()
  await db.from('user_api_keys').upsert({
    user_id: user.id,
    service,
    key_encrypted: encrypted,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,service' })

  return Response.json({ ok: true })
}
