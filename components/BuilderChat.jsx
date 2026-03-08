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

  // Called by page.js after every org update with a screenshot assessment
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
    <div style={{ width: 360, minWidth: 320, display: 'flex', flexDirection: 'column', background: '#fff', borderRight: '1px solid #BAE6FD', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '20px', borderBottom: '1px solid #BAE6FD', background: 'linear-gradient(135deg, #0EA5E9, #6366F1)' }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>{"Svet's Dream"}</div>
        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>AI Agent Corporate Structure</div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
              {m.role === 'assistant' && (
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: m.isAssessment ? (m.passed ? 'linear-gradient(135deg,#10B981,#059669)' : 'linear-gradient(135deg,#EF4444,#DC2626)') : 'linear-gradient(135deg,#0EA5E9,#6366F1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700,
                }}>
                  {m.isAssessment ? (m.passed ? '✓' : '✗') : 'S'}
                </div>
              )}
              <div style={{
                maxWidth: '82%', padding: '10px 13px', borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? 'linear-gradient(135deg,#0EA5E9,#06B6D4)' : m.isAssessment ? (m.passed ? '#F0FDF4' : '#FEF2F2') : '#F1F5F9',
                color: m.role === 'user' ? '#fff' : '#0F172A',
                border: m.isAssessment ? `1px solid ${m.passed ? '#BBF7D0' : '#FECACA'}` : 'none',
                borderBottomRightRadius: m.role === 'user' ? 2 : 12,
                borderBottomLeftRadius: m.role === 'assistant' ? 2 : 12,
              }}>
                {m.isAssessment && (
                  <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4, color: m.passed ? '#059669' : '#DC2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {m.passed ? '✓ Visual Check Passed' : '✗ Visual Check Failed'}
                  </div>
                )}
                {m.content}
              </div>
            </div>
            {/* Screenshot inline below the bubble */}
            {m.screenshot && (
              <div style={{ maxWidth: '90%', marginTop: 8, marginLeft: 36 }}>
                <img
                  src={m.screenshot.startsWith('data:') ? m.screenshot : `data:image/png;base64,${m.screenshot}`}
                  alt="Visual check screenshot"
                  style={{ width: '100%', borderRadius: 8, border: `2px solid ${m.passed ? '#BBF7D0' : '#FECACA'}`, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0EA5E9,#6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>S</div>
            <div style={{ padding: '10px 14px', borderRadius: 12, background: '#F1F5F9', fontSize: 13, color: '#94A3B8' }}>Building your org structure...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px', borderTop: '1px solid #BAE6FD', background: '#F8FAFC' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Describe your organization..." disabled={loading} rows={3}
            style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #BAE6FD', outline: 'none', fontSize: 13, resize: 'none', fontFamily: 'inherit', background: '#fff', lineHeight: 1.5 }}
            onFocus={e => e.target.style.borderColor = '#0EA5E9'} onBlur={e => e.target.style.borderColor = '#BAE6FD'}
          />
          <button onClick={send} disabled={loading || !input.trim()}
            style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: loading || !input.trim() ? '#BAE6FD' : 'linear-gradient(135deg,#0EA5E9,#6366F1)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', alignSelf: 'flex-end' }}>↑</button>
        </div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 6, textAlign: 'center' }}>Enter to send · Shift+Enter for new line</div>
      </div>
    </div>
  )
})

export default BuilderChat
