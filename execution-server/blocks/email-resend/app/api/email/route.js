import { sendEmail } from '@/lib/resend'
import { NextResponse } from 'next/server'

export async function POST(req) {
  try {
    const { to, subject, html, replyTo } = await req.json()
    if (!to || !subject || !html) return NextResponse.json({ error: 'to, subject, html required' }, { status: 400 })
    const result = await sendEmail({ to, subject, html, replyTo })
    return NextResponse.json({ ok: true, id: result.id })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
