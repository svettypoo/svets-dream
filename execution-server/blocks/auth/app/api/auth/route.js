import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// POST /api/auth — login or signup
// Body: { action: 'login' | 'signup' | 'logout', email, password }
export async function POST(req) {
  const { action, email, password } = await req.json()
  const supabase = createClient()

  if (action === 'logout') {
    await supabase.auth.signOut()
    return NextResponse.json({ ok: true })
  }

  if (action === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, user: data.user })
  }

  // login
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return NextResponse.json({ error: error.message }, { status: 401 })
  return NextResponse.json({ ok: true, user: data.user })
}

// DELETE /api/auth — logout
export async function DELETE() {
  const supabase = createClient()
  await supabase.auth.signOut()
  return NextResponse.json({ ok: true })
}
