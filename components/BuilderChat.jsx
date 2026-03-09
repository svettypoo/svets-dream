'use client'
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'

const BuilderChat = forwardRef(function BuilderChat({ onOrgUpdate }, ref) {
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

  useImperativeHandle(ref, () => ({
    addScreenshotMessage({ screenshot, assessment, passed }) {
      setMessages(prev => [...prev, { role: 'assistant', content: assessment, screenshot, passed, isAssessment: true }])
    }
  }))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user', content: input.trim() }
    const chatMessages = [...messages.filter(m => !m.isAssessment), userMsg]
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/build-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatMessages, currentOrg }),
      })
      const text = await res.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { parsed = { message: text } }

      if (parsed.org) {
        setCurrentOrg(parsed.org)
        onOrgUpdate(parsed.org)
      }

      setMessages(prev => [...prev, { role: 'assistant', content: parsed.message || 'Organization updated.' }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ width: 360, minWidth: 320, display: 'flex', flexDirection: 'column', background: '#0d1829', borderRight: '1px solid #1e3a5f', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e3a5f', background: 'rgba(99,102,241,0.12)' }}>
        <div style={{ color: '#a78bfa', fontWeight: 800, fontSize: 17, letterSpacing: '-0.3px' }}>{"Svet's Dream"}</div>
        <div style={{ color: '#475569', fontSize: 11, marginTop: 2, letterSpacing: 0.3 }}>AI Agent Corporate Structure</div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10, scrollbarWidth: 'none', background: '#0d1829' }}>
        <style>{`div::-webkit-scrollbar{display:none}`}</style>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
              {m.role === 'assistant' && (
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: m.isAssessment ? (m.passed ? 'linear-gradient(135deg,#10B981,#059669)' : 'linear-gradient(135deg,#EF4444,#DC2626)') : 'linear-gradient(135deg,#6366f1,#a78bfa)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700,
                }}>
                  {m.isAssessment ? (m.passed ? '✓' : '✗') : 'S'}
                </div>
              )}
              <div style={{
                maxWidth: '82%', padding: '9px 13px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                background: m.role === 'user'
                  ? 'linear-gradient(135deg,#6366f1,#8b5cf6)'
                  : m.isAssessment ? (m.passed ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)') : 'rgba(255,255,255,0.05)',
                color: m.role === 'user' ? '#fff' : '#cbd5e1',
                border: m.isAssessment ? `1px solid ${m.passed ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` : '1px solid rgba(255,255,255,0.06)',
                borderBottomRightRadius: m.role === 'user' ? 2 : 10,
                borderBottomLeftRadius: m.role === 'assistant' ? 2 : 10,
              }}>
                {m.isAssessment && (
                  <div style={{ fontWeight: 700, fontSize: 10, marginBottom: 4, color: m.passed ? '#10B981' : '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {m.passed ? '✓ Visual Check Passed' : '✗ Visual Check Failed'}
                  </div>
                )}
                {m.content}
              </div>
            </div>
            {m.screenshot && (
              <div style={{ maxWidth: '90%', marginTop: 8, marginLeft: 34 }}>
                <img
                  src={m.screenshot.startsWith('data:') ? m.screenshot : `data:image/png;base64,${m.screenshot}`}
                  alt="Visual check"
                  style={{ width: '100%', borderRadius: 6, border: `1px solid ${m.passed ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}` }}
                />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>S</div>
            <div style={{ padding: '9px 13px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 13, color: '#475569' }}>Building org structure...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px', borderTop: '1px solid #1e3a5f', background: '#0a1520' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Describe your organization..." disabled={loading} rows={3}
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 10,
              border: '1px solid #1e3a5f', outline: 'none', fontSize: 13,
              resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
              background: '#071018', color: '#e2e8f0',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = '#6366f1'}
            onBlur={e => e.target.style.borderColor = '#1e3a5f'}
          />
          <button onClick={send} disabled={loading || !input.trim()}
            style={{
              padding: '10px 14px', borderRadius: 10, border: 'none',
              background: loading || !input.trim() ? '#1e293b' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              color: loading || !input.trim() ? '#334155' : '#fff',
              fontWeight: 700, fontSize: 16, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-end', transition: 'all 0.15s',
            }}>↑</button>
        </div>
        <div style={{ fontSize: 10, color: '#334155', marginTop: 6, textAlign: 'center' }}>Enter to send · Shift+Enter for new line</div>
      </div>
    </div>
  )
})

export default BuilderChat
