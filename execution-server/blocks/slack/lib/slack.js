// Slack integration — incoming webhooks + Bot API
// Env vars: SLACK_BOT_TOKEN, SLACK_WEBHOOK_URL, SLACK_SIGNING_SECRET

// Send to a webhook URL (simplest — no OAuth needed)
export async function sendWebhook(text, blocks = null) {
  const body = blocks ? { text, blocks } : { text };
  const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack webhook error: ${res.status}`);
  return { ok: true };
}

// Post a message to a channel via Bot API (needs SLACK_BOT_TOKEN)
export async function postMessage(channel, text, blocks = null) {
  return slackAPI('chat.postMessage', { channel, text, blocks });
}

// Send a DM to a user by email
export async function dmUser(email, text) {
  const user = await slackAPI('users.lookupByEmail', null, `email=${encodeURIComponent(email)}`, 'GET');
  if (!user.ok) throw new Error('User not found in Slack');
  const dm = await slackAPI('conversations.open', { users: user.user.id });
  return slackAPI('chat.postMessage', { channel: dm.channel.id, text });
}

// Common notification patterns — pre-built block layouts
export function alertBlock(title, message, color = '#0EA5E9') {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${title}*\n${message}` },
    },
  ];
}

export function actionBlock(title, message, buttons) {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${message}` } },
    {
      type: 'actions',
      elements: buttons.map(b => ({
        type: 'button',
        text: { type: 'plain_text', text: b.label },
        url: b.url,
        style: b.style || 'default', // 'primary' | 'danger'
      })),
    },
  ];
}

// Verify Slack request signature
export async function verifySlackSignature(req, body) {
  const timestamp = req.headers.get('x-slack-request-timestamp');
  const signature = req.headers.get('x-slack-signature');
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false; // 5 min replay protection

  const sigBase = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(process.env.SLACK_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBase));
  const computed = 'v0=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === signature;
}

async function slackAPI(method, body = null, queryString = '', httpMethod = 'POST') {
  const url = `https://slack.com/api/${method}${queryString ? '?' + queryString : ''}`;
  const options = {
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}
