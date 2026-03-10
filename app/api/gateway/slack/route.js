import { createServiceClient } from '@/lib/supabase-server'
import { handleGatewayMessage } from '@/lib/gateway'
import { createHmac } from 'crypto'

export const runtime = 'nodejs'

export async function POST(req) {
  const rawBody = await req.text()
  const timestamp = req.headers.get('x-slack-request-timestamp')
  const slackSig = req.headers.get('x-slack-signature')

  // Verify Slack signature
  const svc = createServiceClient()
  // We need to find which user this belongs to via the team_id in the payload
  let payload
  try {
    payload = rawBody.startsWith('{') ? JSON.parse(rawBody) : Object.fromEntries(new URLSearchParams(rawBody))
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Slack URL verification challenge
  if (payload.type === 'url_verification') {
    return Response.json({ challenge: payload.challenge })
  }

  // Ignore bot messages and retries
  if (payload.event?.bot_id) return Response.json({ ok: true })
  if (req.headers.get('x-slack-retry-num')) return Response.json({ ok: true })

  const event = payload.event
  if (!event || event.type !== 'message' || !event.text) return Response.json({ ok: true })

  const slackUserId = event.user
  const text = event.text.trim()
  const channelId = event.channel

  // Find gateway settings by team_id
  const { data: settings } = await svc
    .from('gateway_settings')
    .select('user_id, credentials')
    .eq('channel', 'slack')
    .eq('enabled', true)
    .maybeSingle()

  if (!settings) return Response.json({ ok: true })

  // Verify signature using the stored signing secret
  const signingSecret = settings.credentials?.signing_secret
  if (signingSecret && timestamp && slackSig) {
    const baseStr = `v0:${timestamp}:${rawBody}`
    const expected = 'v0=' + createHmac('sha256', signingSecret).update(baseStr).digest('hex')
    if (expected !== slackSig) return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Handle /connect command to link users
  if (text === '/connect' || text.startsWith('<@') && text.includes('connect')) {
    await svc.from('channel_users').upsert({
      user_id: settings.user_id,
      channel: 'slack',
      channel_user_id: slackUserId,
      agent_id: settings.credentials?.default_agent_id || null,
    }, { onConflict: 'user_id,channel,channel_user_id' })
    await sendSlackMessage(channelId, 'You are now connected! I will respond to your messages.', settings.credentials?.bot_token)
    return Response.json({ ok: true })
  }

  // Route message to agent
  const { reply, error } = await handleGatewayMessage({
    channel: 'slack',
    channelUserId: slackUserId,
    text,
    userId: settings.user_id,
  })

  if (error) {
    await sendSlackMessage(channelId, `❌ ${error}`, settings.credentials?.bot_token)
  } else if (reply) {
    await sendSlackMessage(channelId, reply, settings.credentials?.bot_token)
  }

  return Response.json({ ok: true })
}

async function sendSlackMessage(channel, text, botToken) {
  if (!botToken) return
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
    body: JSON.stringify({ channel, text }),
  })
}
