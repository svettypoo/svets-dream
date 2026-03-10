import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// Telnyx webhook — inbound SMS messages
export async function POST(req) {
  try {
    const payload = await req.json()
    const event = payload.data

    if (event?.event_type === 'message.received') {
      const msg = event.payload
      const supabase = createAdminClient()

      // Store inbound message
      await supabase.from('inbound_sms').insert({
        from: msg.from?.phone_number,
        to: msg.to?.[0]?.phone_number,
        body: msg.text,
        received_at: new Date().toISOString(),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('SMS webhook error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
