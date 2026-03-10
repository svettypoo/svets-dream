'use client';
import { useState, useRef, useEffect } from 'react';

// Drop-in AI chat widget — floats bottom-right or embeds inline
// <AiChatWidget floating /> or <AiChatWidget />
export default function AiChatWidget({ floating = false, userId, placeholder = 'Ask anything...' }) {
  const [open, setOpen] = useState(!floating);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Hi! I'm the {{APP_NAME}} assistant. How can I help you today? 👋` }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [convId, setConvId] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    const res = await fetch('/api/ai-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMsg, channel: 'chat', conversationId: convId, userId }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.reply) {
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      if (data.conversationId && !convId) setConvId(data.conversationId);
    }
  }

  const widget = (
    <div className={`flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden ${floating ? 'w-80 h-96' : 'w-full h-full min-h-96'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
          <span className="font-semibold text-sm">{{APP_NAME}} Assistant</span>
        </div>
        {floating && <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-lg">×</button>}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-800 rounded-bl-sm'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-2">
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 p-3 border-t border-gray-100">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={placeholder}
          className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={send} disabled={loading || !input.trim()}
          className="px-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
          ↑
        </button>
      </div>
    </div>
  );

  if (!floating) return widget;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open ? widget : (
        <button onClick={() => setOpen(true)}
          className="w-14 h-14 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center text-2xl hover:bg-blue-700 transition-all hover:scale-110">
          💬
        </button>
      )}
    </div>
  );
}
