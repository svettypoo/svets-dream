import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// Handles OAuth redirect from Supabase (Google, GitHub, etc.)
export async function GET(req) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }

  return NextResponse.redirect(`${origin}/login?error=oauth_failed`)
}
