import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

export async function GET(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const filter = searchParams.get('filter') || 'all'

  const service = createServiceClient()
  let query = service
    .from('api_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (filter === 'today') {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    query = query.gte('created_at', today.toISOString())
  } else if (filter === 'week') {
    const week = new Date()
    week.setDate(week.getDate() - 7)
    query = query.gte('created_at', week.toISOString())
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ transactions: data || [] })
}
