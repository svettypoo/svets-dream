'use client'
import { useState, useRef, useEffect } from 'react'

export default function BuilderChat({ onOrgUpdate }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Welcome to Svet's Dream. Describe your AI agent organization and I'll build the corporate structure for you. For example: \"I run a marketing agency with a CEO, a content team, and a paid ads team.\"",
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentOrg, setCurrentOrg] = useState(null)
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
      const res = await fetch('/api/build-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.filter(m => m.role !== 'system'),
          currentOrg,
        }),
      })

      const text = await res.text()
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { message: text }
      }

      if (parsed.org) {
        setCurrentOrg(parsed.org)
        onOrgUpdate(parsed.org)
      }

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: parsed.message || 'Organization updated.' },
      ])
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      width: 360, minWidth: 320, display: 'flex', flexDirection: 'column',
      background: '#fff', borderRight: '1px solid #BAE6FD', height: '100%',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px', borderBottom: '1px solid #BAE6FD',
        background: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
      }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>
          Svet's Dream
        </div>
        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>
          AI Agent Corporate Structure
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            {m.role === 'assistant' && (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 12, fontWeight: 700, marginRight: 8,
                alignSelf: 'flex-end',
              }}>S</div>
            )}
            <div style={{
              maxWidth: '82%', padding: '10px 13px', borderRadius: 12,
              fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              background: m.role === 'user'
                ? 'linear-gradient(135deg, #0EA5E9, #06B6D4)'
                : '#F1F5F9',
              color: m.role === 'user' ? '#fff' : '#0F172A',
              borderBottomRightRadius: m.role === 'user' ? 2 : 12,
              borderBottomLeftRadius: m.role === 'assistant' ? 2 : 12,
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 700,
            }}>S</div>
            <div style={{
              padding: '10px 14px', borderRadius: 12, background: '#F1F5F9',
              fontSize: 13, color: '#94A3B8',
            }}>
              Building your org structure...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px', borderTop: '1px solid #BAE6FD', background: '#F8FAFC',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Describe your organization..."
            disabled={loading}
            rows={3}
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 10,
              border: '1.5px solid #BAE6FD', outline: 'none',
              fontSize: 13, resize: 'none', fontFamily: 'inherit',
              background: '#fff', lineHeight: 1.5,
            }}
            onFocus={e => e.target.style.borderColor = '#0EA5E9'}
            onBlur={e => e.target.style.borderColor = '#BAE6FD'}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              padding: '10px 14px', borderRadius: 10, border: 'none',
              background: loading || !input.trim()
                ? '#BAE6FD'
                : 'linear-gradient(135deg, #0EA5E9, #6366F1)',
              color: '#fff', fontWeight: 700, fontSize: 13,
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-end',
            }}
          >
            ↑
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 6, textAlign: 'center' }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  )
}
