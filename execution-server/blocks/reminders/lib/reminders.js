// Reminder service — users set reminders, cron fires them via email/SMS/WhatsApp
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Create a reminder for a user
export async function createReminder({ userId, title, message, sendAt, channels = ['email'], email, phone, repeat = null }) {
  const { data, error } = await supabase.from('reminders').insert({
    user_id: userId,
    title,
    message,
    send_at: new Date(sendAt).toISOString(),
    channels, // ['email', 'sms', 'whatsapp', 'push']
    email: email || null,
    phone: phone || null,
    repeat, // null | 'daily' | 'weekly' | 'monthly'
    status: 'pending',
  }).select().single();
  if (error) throw error;
  return data;
}

// Called by cron job — fire due reminders
export async function fireDueReminders() {
  const now = new Date().toISOString();
  const { data: due } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'pending')
    .lte('send_at', now)
    .limit(100);

  const results = [];
  for (const reminder of due || []) {
    try {
      await deliverReminder(reminder);

      if (reminder.repeat) {
        // Schedule next occurrence
        const next = getNextOccurrence(reminder.send_at, reminder.repeat);
        await supabase.from('reminders').update({ send_at: next, status: 'pending', fired_at: now }).eq('id', reminder.id);
      } else {
        await supabase.from('reminders').update({ status: 'sent', fired_at: now }).eq('id', reminder.id);
      }
      results.push({ id: reminder.id, status: 'sent' });
    } catch (err) {
      await supabase.from('reminders').update({ status: 'failed', error: err.message }).eq('id', reminder.id);
      results.push({ id: reminder.id, status: 'failed', error: err.message });
    }
  }
  return results;
}

async function deliverReminder(reminder) {
  const channels = reminder.channels || ['email'];
  const promises = [];

  if (channels.includes('email') && reminder.email && process.env.RESEND_API_KEY) {
    promises.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL || 'reminders@example.com',
        to: reminder.email,
        subject: `⏰ Reminder: ${reminder.title}`,
        html: `<p>${reminder.message}</p>`,
      }),
    }));
  }

  if (channels.includes('sms') && reminder.phone && process.env.TELNYX_API_KEY) {
    promises.push(fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.TELNYX_FROM_NUMBER, to: reminder.phone, text: `⏰ ${reminder.title}: ${reminder.message}` }),
    }));
  }

  if (channels.includes('whatsapp') && reminder.phone && process.env.WHATSAPP_TOKEN) {
    promises.push(fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: reminder.phone, type: 'text', text: { body: `⏰ ${reminder.title}: ${reminder.message}` } }),
    }));
  }

  await Promise.allSettled(promises);
}

function getNextOccurrence(lastSent, repeat) {
  const d = new Date(lastSent);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}
