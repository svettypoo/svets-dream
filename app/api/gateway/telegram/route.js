import { createServiceClient } from '@/lib/supabase-server'
import { handleGatewayMessage } from '@/lib/gateway'

export const runtime = 'nodejs'

// Telegram Bot webhook
export async function POST(req) {
  const update = await req.json()
  const message = update.message || update.edited_message
  if (!message?.text) return Response.json({ ok: true })

  const chatId = message.chat.id
  const userId = message.from.id
  const text = message.text.trim()

  const svc = createServiceClient()
  const { data: settings } = await svc
    .from('gateway_settings')
    .select('user_id, credentials')
    .eq('channel', 'telegram')
    .eq('enabled', true)
    .maybeSingle()

  if (!settings) return Response.json({ ok: true })

  const botToken = settings.credentials?.bot_token
  if (!botToken) return Response.json({ ok: true })

  const { reply, error } = await handleGatewayMessage({
    channel: 'telegram',
    channelUserId: String(userId),
    text,
    userId: settings.user_id,
  })

  const responseText = error ? `❌ ${error}` : reply
  if (responseText) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: responseText,
        parse_mode: 'Markdown',
      }),
    })
  }

  return Response.json({ ok: true })
}
