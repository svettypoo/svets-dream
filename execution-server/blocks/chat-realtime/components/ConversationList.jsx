'use client'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase-browser'
import { MessageCircle } from 'lucide-react'

export default function ConversationList({ currentUserId, onSelect, selectedId }) {
  const supabase = createBrowserClient()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUserId) return
    load()
  }, [currentUserId])

  async function load() {
    const { data } = await supabase.from('conversations')
      .select('*, messages(body, created_at, sender_id), participants:conversation_participants(user_id, profiles(full_name, avatar_url))')
      .order('updated_at', { ascending: false })
    setConversations(data || [])
    setLoading(false)
  }

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading…</div>
  if (!conversations.length) return (
    <div className="p-6 text-center text-gray-400">
      <MessageCircle size={32} className="mx-auto mb-2 opacity-30" />
      <p className="text-sm">No conversations yet</p>
    </div>
  )

  return (
    <div className="divide-y divide-gray-100">
      {conversations.map(conv => {
        const other = conv.participants?.find(p => p.user_id !== currentUserId)?.profiles
        const lastMsg = conv.messages?.slice(-1)[0]
        const unread = conv.unread_count > 0

        return (
          <button
            key={conv.id}
            onClick={() => onSelect?.(conv)}
            className={`w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition ${conv.id === selectedId ? 'bg-brand-50' : ''}`}
          >
            <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center font-semibold text-brand-700 text-sm flex-shrink-0">
              {other?.full_name?.[0] || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className={`text-sm ${unread ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                  {other?.full_name || 'Unknown'}
                </span>
                {lastMsg && <span className="text-xs text-gray-400">{new Date(lastMsg.created_at).toLocaleDateString()}</span>}
              </div>
              {lastMsg && (
                <p className={`text-xs truncate ${unread ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                  {lastMsg.sender_id === currentUserId ? 'You: ' : ''}{lastMsg.body}
                </p>
              )}
            </div>
            {unread && <div className="w-2 h-2 rounded-full bg-brand-600 flex-shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}
