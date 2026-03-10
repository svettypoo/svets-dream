import { createClient } from '@supabase/supabase-js';
import { getAllFlags } from '@/lib/flags';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET /api/flags?userId=xxx&plan=pro — returns all flags for this user/plan
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const plan = searchParams.get('plan');
  const flags = await getAllFlags(userId, plan);
  return Response.json({ flags });
}

// POST /api/flags — create or update a flag (admin only)
// { key, description, enabled, plans?, user_overrides? }
export async function POST(req) {
  const { key, description, enabled = true, plans, user_overrides } = await req.json();
  if (!key) return Response.json({ error: 'key required' }, { status: 400 });
  const { data, error } = await supabase.from('feature_flags').upsert({
    key, description, enabled,
    plans: plans || null,
    user_overrides: user_overrides || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ flag: data });
}

// PATCH /api/flags — toggle enabled
export async function PATCH(req) {
  const { key, enabled, userId, override } = await req.json();
  if (!key) return Response.json({ error: 'key required' }, { status: 400 });

  if (userId !== undefined && override !== undefined) {
    // Set per-user override
    const { data: flag } = await supabase.from('feature_flags').select('user_overrides').eq('key', key).single();
    const overrides = { ...(flag?.user_overrides || {}), [userId]: override };
    await supabase.from('feature_flags').update({ user_overrides: overrides }).eq('key', key);
    return Response.json({ success: true });
  }

  await supabase.from('feature_flags').update({ enabled, updated_at: new Date().toISOString() }).eq('key', key);
  return Response.json({ success: true });
}
