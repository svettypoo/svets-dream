import { createServiceClient } from '@/lib/supabase-server'
import { handleGatewayMessage } from '@/lib/gateway'

export const runtime = 'nodejs'

// Twilio WhatsApp webhook
export async function POST(req) {
  const rawBody = await req.text()
  const params = Object.fromEntries(new URLSearchParams(rawBody))

  const from = params.From?.replace('whatsapp:', '') || ''  // e.g. "+14155238886"
  const to = params.To?.replace('whatsapp:', '') || ''
  const body = params.Body?.trim() || ''

  if (!from || !body) return new Response('OK', { status: 200 })

  const svc = createServiceClient()
  const { data: settings } = await svc
    .from('gateway_settings')
    .select('user_id, credentials')
    .eq('channel', 'whatsapp')
    .eq('enabled', true)
    .maybeSingle()

  if (!settings) return new Response('OK', { status: 200 })

  const { reply, error } = await handleGatewayMessage({
    channel: 'whatsapp',
    channelUserId: from,
    text: body,
    userId: settings.user_id,
  })

  const responseText = error ? `❌ ${error}` : reply
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(responseText || '')}</Message></Response>`

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio webhook verification (optional)
export async function GET(req) {
  return new Response('WhatsApp webhook active', { status: 200 })
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
