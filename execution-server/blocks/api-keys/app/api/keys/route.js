import { createApiKey, revokeApiKey } from '@/lib/api-keys';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET /api/keys — list user's keys (requires auth header)
export async function GET(req) {
  const userId = req.headers.get('x-user-id'); // set by middleware
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabase.from('api_keys').select('id,name,key_prefix,scopes,is_active,last_used_at,use_count,expires_at,created_at')
    .eq('user_id', userId).order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ keys: data });
}

// POST /api/keys — create a new key { name, scopes, expiresInDays }
export async function POST(req) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const keyData = await createApiKey(userId, body);
  return Response.json({
    key: keyData, // includes plaintext key — show once to user
    warning: 'Save this key now — it will not be shown again.',
  }, { status: 201 });
}

// DELETE /api/keys?id=xxx — revoke key
export async function DELETE(req) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  const ok = await revokeApiKey(id, userId);
  return ok ? Response.json({ success: true }) : Response.json({ error: 'Not found' }, { status: 404 });
}
