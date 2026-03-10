import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_ROLES = ['admin', 'moderator', 'member', 'guest'];

// GET /api/roles?userId=xxx — get user role
// PATCH /api/roles — { userId, role } — assign role (admin only)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    // List all users with roles
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, created_at')
      .order('created_at', { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ users: data });
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('id', userId)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 404 });
  return Response.json({ user: data });
}

export async function PATCH(req) {
  // Caller must be admin — in production, verify via requireRole('admin') middleware
  const { userId, role } = await req.json();
  if (!userId || !role) {
    return Response.json({ error: 'userId and role required' }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return Response.json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('profiles')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ user: data });
}
