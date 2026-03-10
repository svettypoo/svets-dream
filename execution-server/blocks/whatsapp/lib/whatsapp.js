// WhatsApp via Meta Cloud API (free, official)
// Setup: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
// Env vars: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN

const BASE = 'https://graph.facebook.com/v19.0';

// Send a plain text message
export async function sendText(to, message) {
  return whatsappPost(`/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to: sanitizePhone(to),
    type: 'text',
    text: { body: message },
  });
}

// Send a template message (must be pre-approved in Meta Business Manager)
// templateName: e.g. 'booking_confirmation', language: 'en_US'
// components: [{ type: 'body', parameters: [{ type: 'text', text: 'value' }] }]
export async function sendTemplate(to, templateName, language = 'en_US', components = []) {
  return whatsappPost(`/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to: sanitizePhone(to),
    type: 'template',
    template: { name: templateName, language: { code: language }, components },
  });
}

// Send interactive buttons (up to 3)
// buttons: [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }]
export async function sendButtons(to, body, buttons) {
  return whatsappPost(`/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to: sanitizePhone(to),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  });
}

// Send an image
export async function sendImage(to, imageUrl, caption = '') {
  return whatsappPost(`/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to: sanitizePhone(to),
    type: 'image',
    image: { link: imageUrl, caption },
  });
}

// Mark message as read
export async function markRead(messageId) {
  return whatsappPost(`/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

async function whatsappPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'WhatsApp API error');
  return data;
}

function sanitizePhone(phone) {
  // Strip spaces, dashes, parens — keep + and digits
  return phone.replace(/[^\d+]/g, '');
}
