import { createClient } from '@supabase/supabase-js';
import { estimateReadTime } from '@/lib/blog';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/posts?status=draft|published&limit=50
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  let query = supabase.from('blog_posts').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ posts: data });
}

// POST /api/posts — create post
export async function POST(req) {
  const body = await req.json();
  const { title, content, excerpt, cover_image, tags, status = 'draft', author_name, author_id } = body;
  if (!title || !content) return Response.json({ error: 'title and content required' }, { status: 400 });

  const slug = slugify(title) + '-' + Date.now().toString(36);
  const read_time = estimateReadTime(content);

  const { data, error } = await supabase.from('blog_posts').insert({
    title, content, excerpt, cover_image,
    tags: tags || [],
    status,
    slug,
    read_time,
    author_name: author_name || 'Team',
    author_id: author_id || null,
    published_at: status === 'published' ? new Date().toISOString() : null,
  }).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ post: data }, { status: 201 });
}

// PATCH /api/posts — update post
export async function PATCH(req) {
  const { id, ...updates } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  if (updates.content) updates.read_time = estimateReadTime(updates.content);
  if (updates.status === 'published') updates.published_at = new Date().toISOString();
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('blog_posts').update(updates).eq('id', id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ post: data });
}

// DELETE /api/posts?id=xxx
export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabase.from('blog_posts').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
