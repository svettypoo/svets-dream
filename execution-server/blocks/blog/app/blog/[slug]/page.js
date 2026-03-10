import { notFound } from 'next/navigation';
import { getPost } from '@/lib/blog';
import { buildMetadata, articleSchema } from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
import Breadcrumbs from '@/components/Breadcrumbs';

export async function generateMetadata({ params }) {
  try {
    const post = await getPost(params.slug);
    return buildMetadata({
      title: post.title,
      description: post.excerpt,
      image: post.cover_image,
      path: `/blog/${post.slug}`,
      type: 'article',
    });
  } catch {
    return buildMetadata({ title: 'Post Not Found' });
  }
}

export default async function BlogPostPage({ params }) {
  let post;
  try { post = await getPost(params.slug); }
  catch { notFound(); }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <JsonLd data={articleSchema({
        title: post.title,
        description: post.excerpt,
        datePublished: post.published_at,
        dateModified: post.updated_at,
        authorName: post.author_name,
        image: post.cover_image,
        url: `${appUrl}/blog/${post.slug}`,
      })} />

      <Breadcrumbs items={[
        { label: 'Home', href: '/' },
        { label: 'Blog', href: '/blog' },
        { label: post.title },
      ]} />

      <div className="mt-8">
        {post.tags?.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-4">
            {post.tags.map(t => (
              <span key={t} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        )}

        <h1 className="text-4xl font-extrabold text-gray-900 leading-tight">{post.title}</h1>

        <div className="flex items-center gap-3 mt-4 text-sm text-gray-500">
          <span className="font-medium">{post.author_name}</span>
          <span>·</span>
          <span>{new Date(post.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          {post.read_time && <><span>·</span><span>{post.read_time} min read</span></>}
          {post.views > 0 && <><span>·</span><span>{post.views.toLocaleString()} views</span></>}
        </div>
      </div>

      {post.cover_image && (
        <img
          src={post.cover_image}
          alt={post.title}
          className="w-full rounded-2xl mt-8 object-cover max-h-96"
        />
      )}

      {/* Prose content — assumes HTML or Markdown-rendered HTML */}
      <div
        className="mt-10 prose prose-lg prose-gray max-w-none prose-headings:font-bold prose-a:text-blue-600 prose-img:rounded-xl"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />
    </div>
  );
}
