'use client'
import { useState, useEffect, useRef } from 'react'
import { Send, Paperclip } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase-browser'

export default function ChatWindow({ conversationId, currentUserId, otherUser }) {
  const supabase = createBrowserClient()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!conversationId) return
    loadMessages()

    // Realtime subscription
    const channel = supabase.channel(`messages:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, payload => {
        setMessages(prev => [...prev, payload.new])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadMessages() {
    const { data } = await supabase.from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(100)
    if (data) setMessages(data)
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    const msg = { conversation_id: conversationId, sender_id: currentUserId, body: text.trim() }
    setText('')
    await supabase.from('messages').insert(msg)
    setSending(false)
  }

  const isMine = (msg) => msg.sender_id === currentUserId

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      {otherUser && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center font-semibold text-brand-700 text-sm">
            {otherUser.full_name?.[0] || '?'}
          </div>
          <div>
            <div className="font-semibold text-gray-900 text-sm">{otherUser.full_name}</div>
            <div className="text-xs text-gray-400">Usually responds within an hour</div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => {
          const mine = isMine(msg)
          return (
            <div key={msg.id || i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${mine ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm'}`}>
                <p className="leading-relaxed">{msg.body}</p>
                <p className={`text-xs mt-1 ${mine ? 'text-brand-200' : 'text-gray-400'}`}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-8">
            <div className="text-3xl mb-2">💬</div>
            Start the conversation by sending a message below.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="flex items-end gap-2 px-4 py-3 border-t border-gray-200 flex-shrink-0">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e) } }}
          placeholder="Type a message…"
          className="input flex-1 resize-none"
          rows={1}
          style={{ maxHeight: 100 }}
        />
        <button type="submit" disabled={!text.trim() || sending} className="btn btn-primary p-2.5 flex-shrink-0">
          <Send size={16} />
        </button>
      </form>
    </div>
  )
}
