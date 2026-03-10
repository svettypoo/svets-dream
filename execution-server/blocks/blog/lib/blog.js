import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function getPosts({ page = 1, limit = 12, tag, status = 'published' } = {}) {
  let query = supabase
    .from('blog_posts')
    .select('id, slug, title, excerpt, cover_image, tags, published_at, author_name, read_time', { count: 'exact' })
    .eq('status', status)
    .order('published_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (tag) query = query.contains('tags', [tag]);

  const { data, count, error } = await query;
  if (error) throw error;
  return { posts: data, total: count, pages: Math.ceil(count / limit) };
}

export async function getPost(slug) {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();
  if (error) throw error;

  // Increment view count (fire-and-forget)
  supabase.from('blog_posts').update({ views: (data.views || 0) + 1 }).eq('id', data.id);

  return data;
}

export async function getAllTags() {
  const { data } = await supabase
    .from('blog_posts')
    .select('tags')
    .eq('status', 'published');
  const tags = [...new Set((data || []).flatMap(p => p.tags || []))].sort();
  return tags;
}

export function estimateReadTime(content) {
  const words = content?.split(/\s+/).length || 0;
  return Math.max(1, Math.ceil(words / 200)); // 200 wpm
}
