import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// GET /api/messages?conversationId=xxx
export async function GET(req) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get('conversationId')
  if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })

  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/messages — send a message (also creates conversation if needed)
export async function POST(req) {
  const supabase = createAdminClient()
  const { conversation_id, sender_id, recipient_id, body, listing_id } = await req.json()

  let convId = conversation_id

  // Create conversation if it doesn't exist
  if (!convId && sender_id && recipient_id) {
    // Check for existing conv between these two users
    const { data: existing } = await supabase.rpc('find_conversation', { user_a: sender_id, user_b: recipient_id })
    if (existing?.id) {
      convId = existing.id
    } else {
      const { data: conv } = await supabase.from('conversations').insert({ listing_id }).select().single()
      convId = conv.id
      await supabase.from('conversation_participants').insert([
        { conversation_id: convId, user_id: sender_id },
        { conversation_id: convId, user_id: recipient_id },
      ])
    }
  }

  const { data, error } = await supabase.from('messages').insert({ conversation_id: convId, sender_id, body }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update conversation updated_at
  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId)

  return NextResponse.json({ ...data, conversation_id: convId }, { status: 201 })
}
