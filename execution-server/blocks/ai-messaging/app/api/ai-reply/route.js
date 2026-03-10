import { getAIReply, needsHuman } from '@/lib/ai-reply';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// POST /api/ai-reply
// Called by: SMS webhook, WhatsApp webhook, chat UI, Slack slash command
// Body: { message, channel, conversationId?, userId?, from? }
export async function POST(req) {
  const { message, channel = 'chat', conversationId, userId, from } = await req.json();
  if (!message) return Response.json({ error: 'message required' }, { status: 400 });

  // Check if human escalation needed
  if (needsHuman(message)) {
    const escalationMsg = "I'm connecting you with a team member right now. You'll hear from us shortly! 🙏";
    // Notify team via Slack (if configured)
    if (process.env.SLACK_WEBHOOK_URL) {
      fetch('/api/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'webhook',
          text: `🚨 *Escalation needed*\nChannel: ${channel}\nFrom: ${from || userId || 'unknown'}\nMessage: "${message}"`,
        }),
      }).catch(() => {});
    }
    return Response.json({ reply: escalationMsg, escalated: true });
  }

  // Load conversation history for context
  let history = [];
  if (conversationId) {
    const { data } = await supabase
      .from('ai_conversations')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);
    history = data || [];
  }

  const reply = await getAIReply(message, { conversationHistory: history, channel });

  // Save to conversation log
  const convId = conversationId || crypto.randomUUID();
  await supabase.from('ai_conversations').insert([
    { conversation_id: convId, role: 'user', content: message, channel, user_id: userId || null, from_number: from || null },
    { conversation_id: convId, role: 'assistant', content: reply, channel },
  ]);

  // Route reply back to the right channel
  if (channel === 'sms' && from && process.env.TELNYX_API_KEY) {
    await fetch('/api/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', to: from, message: reply }),
    }).catch(() => {});
  }

  if (channel === 'whatsapp' && from && process.env.WHATSAPP_TOKEN) {
    await fetch('/api/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'text', to: from, message: reply }),
    }).catch(() => {});
  }

  return Response.json({ reply, conversationId: convId });
}
