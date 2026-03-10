// AI auto-reply — Claude answers inbound messages from any channel
// Channels: in-app chat, SMS (Telnyx), WhatsApp, Slack
// Env vars: ANTHROPIC_API_KEY, AI_SYSTEM_PROMPT (optional override)

const DEFAULT_SYSTEM = `You are a helpful assistant for {{APP_NAME}}. {{APP_TAGLINE}}
Be concise, friendly, and helpful. Answer questions about the app and its features.
If you don't know something, say so and offer to connect the user with a human.`;

export async function getAIReply(userMessage, context = {}) {
  const {
    conversationHistory = [],
    systemPrompt = null,
    channel = 'chat', // 'chat' | 'sms' | 'whatsapp' | 'slack'
    userName = 'User',
    maxTokens = channel === 'sms' ? 160 : 500,
  } = context;

  // SMS/WhatsApp: keep replies short (SMS limit 160 chars)
  const channelNote = ['sms', 'whatsapp'].includes(channel)
    ? '\nIMPORTANT: Keep your reply under 160 characters for SMS compatibility.'
    : '';

  const system = (systemPrompt || DEFAULT_SYSTEM) + channelNote;

  const messages = [
    ...conversationHistory.slice(-10), // last 10 exchanges for context
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', // cheapest, fastest — good for auto-reply
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI reply error: ${err}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// Keyword escalation — return true if message needs a human
export function needsHuman(message) {
  const escalationKeywords = [
    'speak to a human', 'real person', 'agent', 'manager', 'supervisor',
    'refund', 'cancel my account', 'lawsuit', 'angry', 'unacceptable',
  ];
  const lower = message.toLowerCase();
  return escalationKeywords.some(k => lower.includes(k));
}
