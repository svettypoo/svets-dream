import { createReminder, fireDueReminders } from '@/lib/reminders';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET /api/reminders?userId=xxx — list user's reminders
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

  const { data, error } = await supabase.from('reminders')
    .select('*').eq('user_id', userId)
    .order('send_at', { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ reminders: data });
}

// POST /api/reminders — create reminder
export async function POST(req) {
  const body = await req.json();

  // Cron trigger: { _cron: true }
  if (body._cron) {
    const secret = req.headers.get('x-cron-secret');
    if (secret !== process.env.CRON_SECRET) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const results = await fireDueReminders();
    return Response.json({ fired: results.length, results });
  }

  const { userId, title, message, sendAt, channels, email, phone, repeat } = body;
  if (!userId || !title || !sendAt) return Response.json({ error: 'userId, title, sendAt required' }, { status: 400 });

  const reminder = await createReminder({ userId, title, message, sendAt, channels, email, phone, repeat });
  return Response.json({ reminder }, { status: 201 });
}

// DELETE /api/reminders?id=xxx
export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  await supabase.from('reminders').delete().eq('id', id);
  return Response.json({ success: true });
}
