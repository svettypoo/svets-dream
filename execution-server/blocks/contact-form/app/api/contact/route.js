import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export async function POST(req) {
  try {
    const { name, email, subject, message } = await req.json()
    if (!name || !email || !message) return NextResponse.json({ error: 'Required fields missing' }, { status: 400 })

    const supabase = createAdminClient()

    // Store in DB
    await supabase.from('contact_submissions').insert({ name, email, subject, message })

    // Send notification email if Resend is configured
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: process.env.RESEND_FROM,
          to: [process.env.RESEND_FROM],
          subject: `Contact form: ${subject || 'New message'}`,
          html: `<p><strong>From:</strong> ${name} (${email})</p><p><strong>Subject:</strong> ${subject}</p><p>${message.replace(/\n/g, '<br>')}</p>`,
          reply_to: email,
        }),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
