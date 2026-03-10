import { sendSMS, sendOTP, verifyOTP } from '@/lib/telnyx'
import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// POST /api/sms — send a message or OTP
export async function POST(req) {
  try {
    const body = await req.json()
    const { action, to, message } = body

    if (action === 'otp') {
      const supabase = createAdminClient()
      const result = await sendOTP({ to, supabase })
      return NextResponse.json(result)
    }

    if (action === 'verify') {
      const supabase = createAdminClient()
      const result = await verifyOTP({ phone: to, code: body.code, supabase })
      return NextResponse.json(result)
    }

    // Default: send plain SMS
    if (!to || !message) return NextResponse.json({ error: 'to and message required' }, { status: 400 })
    const result = await sendSMS({ to, body: message })
    return NextResponse.json({ ok: true, id: result.id })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
