import { createServiceClient } from '@/lib/supabase-server'

/**
 * Shared gateway logic — routes an inbound message from any channel
 * (Slack, WhatsApp, Telegram) into the agent-chat loop and returns the response.
 */
export async function handleGatewayMessage({ channel, channelUserId, text, userId }) {
  const svc = createServiceClient()

  // 1. Find which user owns this channel integration
  let appUserId = userId
  if (!appUserId) {
    const { data: cu } = await svc
      .from('channel_users')
      .select('user_id, agent_id')
      .eq('channel', channel)
      .eq('channel_user_id', channelUserId)
      .maybeSingle()
    if (!cu) return { error: 'User not linked. Send /connect to this bot first.' }
    appUserId = cu.user_id
  }

  // 2. Get gateway settings to find the default agent
  const { data: settings } = await svc
    .from('gateway_settings')
    .select('default_agent_id, default_org_snapshot')
    .eq('user_id', appUserId)
    .eq('channel', channel)
    .maybeSingle()

  if (!settings?.default_agent_id) {
    return { error: 'No agent configured for this channel. Visit your dashboard settings.' }
  }

  const agentId = settings.default_agent_id
  const orgSnapshot = settings.default_org_snapshot

  // 3. Find the agent definition in the org
  const agentDef = orgSnapshot?.nodes?.find(n => n.id === agentId || n.label === agentId)
  if (!agentDef) return { error: `Agent "${agentId}" not found in org.` }

  // 4. Load conversation history for this channel user
  const { data: convo } = await svc
    .from('channel_conversations')
    .select('messages')
    .eq('user_id', appUserId)
    .eq('channel', channel)
    .eq('channel_user_id', channelUserId)
    .eq('agent_id', agentId)
    .maybeSingle()

  const history = convo?.messages || []
  const messages = [...history, { role: 'user', content: text }]

  // 5. Call agent-chat (fire and collect full response)
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://svets-dream.vercel.app'
  const res = await fetch(`${origin}/api/agent-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gateway-user-id': appUserId,
    },
    body: JSON.stringify({
      agent: agentDef,
      messages,
      orgContext: orgSnapshot,
      _gateway: true,
    }),
  })

  const reader = res.body.getReader()
  let rawOutput = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    rawOutput += new TextDecoder().decode(value, { stream: true })
  }

  // Strip internal markers from output
  const reply = rawOutput
    .replace(/<!--[^>]*-->/g, '')
    .replace(/\*\*/g, '')
    .trim()
    .slice(0, 3000)

  // 6. Save updated conversation history (keep last 20 pairs to avoid bloat)
  const updatedHistory = [...messages, { role: 'assistant', content: reply }].slice(-40)
  await svc.from('channel_conversations').upsert({
    user_id: appUserId,
    channel,
    channel_user_id: channelUserId,
    agent_id: agentId,
    messages: updatedHistory,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,channel,channel_user_id,agent_id' })

  return { reply, agentLabel: agentDef.label }
}
