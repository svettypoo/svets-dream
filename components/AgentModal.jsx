'use client'
import { useState, useRef, useEffect } from 'react'

export default function AgentModal({ agent, orgData, rulesDescription, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          messages: newMessages,
          orgContext: orgData,
          rules: rulesDescription,
        }),
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        assistantText += decoder.decode(value, { stream: true })
        setMessages(prev => [
          ...prev.slice(0, -1),
          { role: 'assistant', content: assistantText },
        ])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 600,
        height: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(14,165,233,0.3)',
        border: '1px solid #BAE6FD', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #BAE6FD',
          background: '#EFF6FF', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 16,
          }}>
            {agent.label?.[0]}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{agent.label}</div>
            <div style={{ fontSize: 12, color: '#64748B' }}>{agent.role}</div>
          </div>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 20, color: '#94A3B8', padding: 4,
          }}>×</button>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 20px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {messages.length === 0 && (
            <div style={{
              textAlign: 'center', color: '#94A3B8', marginTop: 40,
              fontSize: 14, lineHeight: 1.6,
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <div style={{ fontWeight: 600, color: '#64748B' }}>Talk to {agent.label}</div>
              <div style={{ marginTop: 8, fontSize: 13 }}>{agent.description}</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
                fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                background: m.role === 'user'
                  ? 'linear-gradient(135deg, #0EA5E9, #06B6D4)'
                  : '#F1F5F9',
                color: m.role === 'user' ? '#fff' : '#0F172A',
                borderBottomRightRadius: m.role === 'user' ? 2 : 12,
                borderBottomLeftRadius: m.role === 'assistant' ? 2 : 12,
              }}>
                {m.content || (loading && i === messages.length - 1 ? '...' : '')}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid #BAE6FD',
          background: '#F8FAFC', display: 'flex', gap: 8,
        }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={`Message ${agent.label}...`}
            disabled={loading}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10,
              border: '1.5px solid #BAE6FD', outline: 'none',
              fontSize: 14, background: '#fff',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = '#0EA5E9'}
            onBlur={e => e.target.style.borderColor = '#BAE6FD'}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              padding: '10px 18px', borderRadius: 10, border: 'none',
              background: loading ? '#BAE6FD' : 'linear-gradient(135deg, #0EA5E9, #6366F1)',
              color: '#fff', fontWeight: 600, fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
