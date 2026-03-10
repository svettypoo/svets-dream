'use client';
import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';

const TYPE_ICONS = {
  info: '💬', success: '✅', warning: '⚠️', error: '❌',
  mention: '💬', follow: '👤', payment: '💳', system: '🔔',
};

export default function NotificationFeed({ userId, compact = false }) {
  const [notes, setNotes] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(!compact);
  const supabase = createBrowserClient();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotes(data || []);
    setUnread((data || []).filter(n => !n.read_at).length);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();
    // Realtime subscription
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        payload => { setNotes(prev => [payload.new, ...prev]); setUnread(u => u + 1); }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [userId, load]);

  async function markRead(id) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    setNotes(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    setUnread(u => Math.max(0, u - 1));
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', userId).is('read_at', null);
    setNotes(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setUnread(0);
  }

  if (compact) {
    return (
      <div className="relative">
        <button onClick={() => setOpen(o => !o)} className="relative p-2 rounded-lg hover:bg-gray-100">
          <span className="text-xl">{TYPE_ICONS.system}</span>
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        {open && (
          <div className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
            <FeedBody notes={notes} unread={unread} onMarkRead={markRead} onMarkAllRead={markAllRead} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <FeedBody notes={notes} unread={unread} onMarkRead={markRead} onMarkAllRead={markAllRead} />
    </div>
  );
}

function FeedBody({ notes, unread, onMarkRead, onMarkAllRead }) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">Notifications {unread > 0 && <span className="text-blue-600">({unread})</span>}</h3>
        {unread > 0 && <button onClick={onMarkAllRead} className="text-xs text-blue-500 hover:text-blue-700">Mark all read</button>}
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
        {notes.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">No notifications yet</div>
        ) : notes.map(n => (
          <button key={n.id} onClick={() => !n.read_at && onMarkRead(n.id)}
            className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex gap-3 ${!n.read_at ? 'bg-blue-50' : ''}`}>
            <span className="text-lg flex-shrink-0">{TYPE_ICONS[n.type] || TYPE_ICONS.info}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${!n.read_at ? 'font-medium text-gray-900' : 'text-gray-600'} line-clamp-2`}>{n.message}</p>
              <p className="text-xs text-gray-400 mt-0.5">{timeAgo(n.created_at)}</p>
            </div>
            {!n.read_at && <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1.5" />}
          </button>
        ))}
      </div>
    </>
  );
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
