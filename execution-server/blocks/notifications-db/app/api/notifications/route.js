import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Send a notification to one or more users
// POST { userId|userIds, message, type?, link? }
export async function POST(req) {
  const { userId, userIds, message, type = 'info', link } = await req.json();
  if (!message) return Response.json({ error: 'message required' }, { status: 400 });
  const targets = userIds || (userId ? [userId] : []);
  if (!targets.length) return Response.json({ error: 'userId or userIds required' }, { status: 400 });

  const rows = targets.map(uid => ({ user_id: uid, message, type, link: link || null }));
  const { data, error } = await supabase.from('notifications').insert(rows).select();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ notifications: data }, { status: 201 });
}

// GET /api/notifications?userId=xxx&unreadOnly=true
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const unreadOnly = searchParams.get('unreadOnly') === 'true';
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

  let query = supabase.from('notifications').select('*', { count: 'exact' })
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
  if (unreadOnly) query = query.is('read_at', null);
  const { data, count, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ notifications: data, unread: (data || []).filter(n => !n.read_at).length, total: count });
}

// PATCH /api/notifications — mark read
export async function PATCH(req) {
  const { id, userId, all } = await req.json();
  if (all && userId) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', userId).is('read_at', null);
    return Response.json({ success: true });
  }
  if (id) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    return Response.json({ success: true });
  }
  return Response.json({ error: 'id or (userId + all) required' }, { status: 400 });
}
