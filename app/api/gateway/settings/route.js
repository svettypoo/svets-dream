import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

// GET — fetch all gateway settings for the user
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('gateway_settings')
    .select('id, channel, enabled, default_agent_id, updated_at')
    .eq('user_id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ settings: data })
}

// POST — create or update gateway settings for a channel
// Credentials (bot tokens, signing secrets) stored as-is for now (no encryption in MVP)
export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { channel, credentials, default_agent_id, default_org_snapshot, enabled } = await req.json()
  if (!channel) return Response.json({ error: 'channel required' }, { status: 400 })

  const svc = createServiceClient()
  const { data, error } = await svc.from('gateway_settings').upsert({
    user_id: user.id,
    channel,
    credentials: credentials || {},
    default_agent_id: default_agent_id || null,
    default_org_snapshot: default_org_snapshot || null,
    enabled: enabled !== false,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,channel' }).select('id, channel, enabled, default_agent_id').single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // For Telegram: register the webhook automatically if bot_token provided
  if (channel === 'telegram' && credentials?.bot_token) {
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://svets-dream.vercel.app'
    await fetch(`https://api.telegram.org/bot${credentials.bot_token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${origin}/api/gateway/telegram` }),
    }).catch(() => {})
  }

  return Response.json({ setting: data })
}
