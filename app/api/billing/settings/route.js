import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-server'
import { getBillingSettings, getTodaySpend } from '@/lib/spend-tracker'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [settings, todaySpend] = await Promise.all([
    getBillingSettings(user.id),
    getTodaySpend(user.id),
  ])

  return Response.json({ settings, today_spend: todaySpend })
}

export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { daily_budget_usd } = await req.json()
  if (typeof daily_budget_usd !== 'number' || daily_budget_usd < 0) {
    return Response.json({ error: 'Invalid budget' }, { status: 400 })
  }

  const service = createServiceClient()
  await service.from('user_billing').upsert({
    user_id: user.id,
    daily_budget_usd,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  return Response.json({ ok: true })
}
