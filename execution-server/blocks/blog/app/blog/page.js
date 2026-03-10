import Link from 'next/link';
import { getPosts, getAllTags } from '@/lib/blog';
import { buildMetadata } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'Blog',
  description: 'Insights, updates, and stories from our team.',
  path: '/blog',
});

export default async function BlogPage({ searchParams }) {
  const page = parseInt(searchParams?.page || '1');
  const tag = searchParams?.tag;

  const [{ posts, total, pages }, tags] = await Promise.all([
    getPosts({ page, tag }),
    getAllTags(),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-extrabold text-gray-900 mb-3">Blog</h1>
        <p className="text-gray-500 text-lg">Insights, updates, and stories from our team.</p>
      </div>

      {/* Tag filter */}
      {tags.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center mb-10">
          <Link
            href="/blog"
            className={`px-3 py-1 rounded-full text-sm ${!tag ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            All
          </Link>
          {tags.map(t => (
            <Link
              key={t}
              href={`/blog?tag=${t}`}
              className={`px-3 py-1 rounded-full text-sm ${tag === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {t}
            </Link>
          ))}
        </div>
      )}

      {/* Grid */}
      {posts.length === 0 ? (
        <div className="text-center text-gray-400 py-24">No posts yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {posts.map(post => (
            <Link key={post.id} href={`/blog/${post.slug}`} className="group block">
              <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-shadow">
                {post.cover_image && (
                  <img src={post.cover_image} alt={post.title} className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300" />
                )}
                <div className="p-5">
                  {post.tags?.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {post.tags.slice(0, 3).map(t => (
                        <span key={t} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  )}
                  <h2 className="font-bold text-gray-900 text-lg leading-snug group-hover:text-blue-600 transition-colors">{post.title}</h2>
                  <p className="text-gray-500 text-sm mt-2 line-clamp-2">{post.excerpt}</p>
                  <div className="flex items-center gap-3 mt-4 text-xs text-gray-400">
                    <span>{post.author_name}</span>
                    <span>·</span>
                    <span>{new Date(post.published_at).toLocaleDateString()}</span>
                    {post.read_time && <><span>·</span><span>{post.read_time} min read</span></>}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2 mt-12">
          {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
            <Link
              key={p}
              href={`/blog?page=${p}${tag ? `&tag=${tag}` : ''}`}
              className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium ${p === page ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
