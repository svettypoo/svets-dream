'use client';
import { useState, useEffect } from 'react';

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function Comment({ comment, currentUserId, onDelete, onReply, depth = 0 }) {
  const [replying, setReplying] = useState(false);
  const isOwn = comment.user_id === currentUserId;

  return (
    <div className={`flex gap-3 ${depth > 0 ? 'ml-8 mt-3' : 'mt-4'}`}>
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
        {(comment.author_name || 'A').charAt(0).toUpperCase()}
      </div>
      <div className="flex-1">
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-semibold text-gray-900">{comment.author_name || 'Anonymous'}</span>
            <span className="text-xs text-gray-400">{timeAgo(comment.created_at)}</span>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.body}</p>
        </div>
        <div className="flex gap-3 mt-1 ml-2">
          {depth === 0 && (
            <button onClick={() => setReplying(r => !r)} className="text-xs text-gray-400 hover:text-blue-500">
              Reply
            </button>
          )}
          {isOwn && (
            <button onClick={() => onDelete(comment.id)} className="text-xs text-gray-400 hover:text-red-500">
              Delete
            </button>
          )}
        </div>
        {replying && (
          <CommentInput
            placeholder="Write a reply..."
            onSubmit={async (body) => { await onReply(comment.id, body); setReplying(false); }}
            compact
          />
        )}
        {comment.replies?.map(r => (
          <Comment key={r.id} comment={r} currentUserId={currentUserId} onDelete={onDelete} onReply={onReply} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
}

function CommentInput({ onSubmit, placeholder = 'Write a comment...', compact = false }) {
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    await onSubmit(body.trim());
    setBody('');
    setLoading(false);
  }

  return (
    <form onSubmit={submit} className={`flex gap-2 mt-3 ${compact ? 'ml-0' : ''}`}>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={placeholder}
        rows={compact ? 1 : 2}
        className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); } }}
      />
      <button type="submit" disabled={loading || !body.trim()}
        className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 self-end">
        {loading ? '...' : 'Post'}
      </button>
    </form>
  );
}

// Usage: <CommentThread resourceType="post" resourceId={post.id} currentUserId={user?.id} authorName={user?.name} />
export default function CommentThread({ resourceType, resourceId, currentUserId, authorName }) {
  const [comments, setComments] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!resourceId) return;
    fetch(`/api/comments?type=${resourceType}&id=${resourceId}`)
      .then(r => r.json())
      .then(d => { setComments(d.comments || []); setTotal(d.total || 0); setLoading(false); });
  }, [resourceType, resourceId]);

  async function post(body, parentId = null) {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, resource_type: resourceType, resource_id: resourceId, parent_id: parentId, author_name: authorName }),
    });
    const data = await res.json();
    if (res.ok) {
      if (parentId) {
        setComments(prev => prev.map(c => c.id === parentId
          ? { ...c, replies: [...(c.replies || []), data.comment] }
          : c
        ));
      } else {
        setComments(prev => [data.comment, ...prev]);
        setTotal(t => t + 1);
      }
    }
  }

  async function del(id) {
    if (!confirm('Delete this comment?')) return;
    await fetch(`/api/comments?id=${id}`, { method: 'DELETE' });
    setComments(prev => prev.filter(c => c.id !== id).map(c => ({
      ...c, replies: (c.replies || []).filter(r => r.id !== id)
    })));
    setTotal(t => t - 1);
  }

  return (
    <div className="mt-8">
      <h3 className="text-lg font-bold text-gray-900 mb-4">
        Comments {total > 0 && <span className="text-gray-400 font-normal">({total})</span>}
      </h3>
      <CommentInput onSubmit={body => post(body)} />
      {loading ? (
        <div className="mt-4 text-gray-400 text-sm">Loading comments...</div>
      ) : comments.length === 0 ? (
        <div className="mt-6 text-center text-gray-400 text-sm py-8">Be the first to comment</div>
      ) : (
        comments.map(c => (
          <Comment key={c.id} comment={c} currentUserId={currentUserId} onDelete={del} onReply={(parentId, body) => post(body, parentId)} />
        ))
      )}
    </div>
  );
}
