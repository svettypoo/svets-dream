import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET /api/comments?type=post&id=xxx
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const id = searchParams.get('id');
  if (!type || !id) return Response.json({ error: 'type and id required' }, { status: 400 });

  const { data, count, error } = await supabase
    .from('comments')
    .select('*', { count: 'exact' })
    .eq('resource_type', type)
    .eq('resource_id', id)
    .is('parent_id', null)
    .order('created_at', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fetch replies for each top-level comment
  const withReplies = await Promise.all((data || []).map(async c => {
    const { data: replies } = await supabase
      .from('comments')
      .select('*')
      .eq('parent_id', c.id)
      .order('created_at', { ascending: true });
    return { ...c, replies: replies || [] };
  }));

  return Response.json({ comments: withReplies, total: count });
}

// POST /api/comments
export async function POST(req) {
  const { body, resource_type, resource_id, parent_id, user_id, author_name } = await req.json();
  if (!body?.trim() || !resource_type || !resource_id) {
    return Response.json({ error: 'body, resource_type, resource_id required' }, { status: 400 });
  }
  const { data, error } = await supabase.from('comments').insert({
    body: body.trim(),
    resource_type,
    resource_id,
    parent_id: parent_id || null,
    user_id: user_id || null,
    author_name: author_name || 'Anonymous',
  }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ comment: data }, { status: 201 });
}

// DELETE /api/comments?id=xxx
export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  await supabase.from('comments').delete().eq('id', id);
  return Response.json({ success: true });
}
