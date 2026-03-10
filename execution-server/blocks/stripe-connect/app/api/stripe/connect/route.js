import { createConnectedAccount, getOnboardingLink, getAccountStatus } from '@/lib/stripe-connect'
import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// POST /api/stripe/connect — onboard a new host
export async function POST(req) {
  try {
    const { userId, email, returnUrl, refreshUrl } = await req.json()
    const supabase = createAdminClient()

    // Check if account already exists
    const { data: profile } = await supabase.from('profiles').select('stripe_account_id').eq('id', userId).single()
    let accountId = profile?.stripe_account_id

    if (!accountId) {
      const account = await createConnectedAccount({ email })
      accountId = account.id
      await supabase.from('profiles').update({ stripe_account_id: accountId }).eq('id', userId)
    }

    const onboardingUrl = await getOnboardingLink({
      accountId,
      returnUrl: returnUrl || `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/host?connected=true`,
      refreshUrl: refreshUrl || `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/refresh?account=${accountId}`,
    })

    return NextResponse.json({ url: onboardingUrl, accountId })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET /api/stripe/connect?accountId=xxx — check status
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })
    const status = await getAccountStatus(accountId)
    return NextResponse.json(status)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
