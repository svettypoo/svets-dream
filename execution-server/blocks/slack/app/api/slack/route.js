import { sendWebhook, postMessage, dmUser, alertBlock, actionBlock, verifySlackSignature } from '@/lib/slack';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// POST /api/slack — send a notification or handle inbound slash command / interaction
export async function POST(req) {
  const contentType = req.headers.get('content-type') || '';

  // Inbound from Slack (slash command or interaction)
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const rawBody = await req.text();
    const valid = await verifySlackSignature(req, rawBody);
    if (!valid) return new Response('Unauthorized', { status: 401 });

    const params = new URLSearchParams(rawBody);
    const payload = params.get('payload') ? JSON.parse(params.get('payload')) : Object.fromEntries(params);

    // Store inbound event
    await supabase.from('slack_events').insert({
      type: payload.type || 'slash_command',
      user_id: payload.user_id || payload.user?.id,
      channel: payload.channel_name || payload.channel?.name,
      command: payload.command,
      text: payload.text,
      payload: payload,
    });

    // Echo back — customize this to handle slash commands
    return Response.json({
      response_type: 'ephemeral',
      text: `Got it: ${payload.text || payload.command || 'action received'}`,
    });
  }

  // Outbound: { action: 'webhook'|'channel'|'dm', text, channel?, email?, blocks? }
  const body = await req.json();
  const { action, text, channel, email, blocks, title, buttons } = body;

  try {
    let result;
    const blockContent = buttons ? actionBlock(title || '', text, buttons) : (blocks || null);

    if (action === 'dm' && email) {
      result = await dmUser(email, text);
    } else if (action === 'channel' && channel) {
      result = await postMessage(channel, text, blockContent);
    } else {
      // Default: incoming webhook
      result = await sendWebhook(text, blockContent);
    }
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
