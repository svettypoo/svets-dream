import { sendText, sendTemplate, sendButtons, markRead } from '@/lib/whatsapp';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET — webhook verification (Meta requires this on setup)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

// POST — send outbound message OR receive inbound webhook
export async function POST(req) {
  const body = await req.json();

  // Inbound webhook from Meta
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          // Store inbound message
          await supabase.from('whatsapp_messages').insert({
            direction: 'inbound',
            from_number: msg.from,
            to_number: change.value.metadata?.display_phone_number,
            type: msg.type,
            body: msg.text?.body || msg.interactive?.button_reply?.title || '',
            message_id: msg.id,
            timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
          });
          // Mark as read
          await markRead(msg.id).catch(() => {});
        }
      }
    }
    return Response.json({ received: true });
  }

  // Outbound send request: { action: 'text'|'template'|'buttons', to, message, ... }
  const { action, to, message, templateName, language, components, buttons } = body;
  try {
    let result;
    if (action === 'template') {
      result = await sendTemplate(to, templateName, language, components);
    } else if (action === 'buttons') {
      result = await sendButtons(to, message, buttons);
    } else {
      result = await sendText(to, message);
    }
    await supabase.from('whatsapp_messages').insert({
      direction: 'outbound', to_number: to, body: message || templateName, type: action || 'text',
    });
    return Response.json({ success: true, result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
