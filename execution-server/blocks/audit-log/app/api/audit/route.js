import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/audit?userId=xxx&resource=xxx&limit=100&offset=0
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const resource = searchParams.get('resource');
  const action = searchParams.get('action');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  let query = supabase
    .from('audit_logs')
    .select('*, profiles(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (userId) query = query.eq('user_id', userId);
  if (resource) query = query.eq('resource', resource);
  if (action) query = query.ilike('action', `%${action}%`);

  const { data, count, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ logs: data, total: count });
}
