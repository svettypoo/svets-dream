import { sendCampaign } from '@/lib/resend-campaigns'
import { NextResponse } from 'next/server'

export async function POST(req) {
  try {
    const { subject, htmlBody, recipients, fromName, fromEmail } = await req.json()
    if (!subject || !htmlBody || !recipients?.length) {
      return NextResponse.json({ error: 'subject, htmlBody and recipients required' }, { status: 400 })
    }
    const result = await sendCampaign({ subject, htmlBody, recipients, fromName, fromEmail })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
