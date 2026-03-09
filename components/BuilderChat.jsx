'use client'
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { createClient } from '@/lib/supabase'

function MarkdownText({ text }) {
  if (!text) return null
  // Convert markdown to styled spans/divs
  const lines = text.split('\n')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 4 }} />
        // Headers
        if (line.startsWith('### ')) return <div key={i} style={{ fontWeight: 700, fontSize: 13, color: '#a78bfa', marginTop: 6 }}>{renderInline(line.slice(4))}</div>
        if (line.startsWith('## ')) return <div key={i} style={{ fontWeight: 700, fontSize: 14, color: '#c4b5fd', marginTop: 8 }}>{renderInline(line.slice(3))}</div>
        if (line.startsWith('# ')) return <div key={i} style={{ fontWeight: 800, fontSize: 15, color: '#e2e8f0', marginTop: 8 }}>{renderInline(line.slice(2))}</div>
        // Bullet points
        if (line.match(/^[-*•]\s/)) return (
          <div key={i} style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
            <span style={{ color: '#6366f1', flexShrink: 0, marginTop: 1 }}>▸</span>
            <span>{renderInline(line.replace(/^[-*•]\s/, ''))}</span>
          </div>
        )
        // Numbered list
        if (line.match(/^\d+\.\s/)) return (
          <div key={i} style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
            <span style={{ color: '#6366f1', flexShrink: 0, minWidth: 16, fontWeight: 700, fontSize: 11 }}>{line.match(/^(\d+)\./)[1]}.</span>
            <span>{renderInline(line.replace(/^\d+\.\s/, ''))}</span>
          </div>
        )
        // Regular paragraph
        return <div key={i}>{renderInline(line)}</div>
      })}
    </div>
  )
}

function renderInline(text) {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} style={{ color: '#e2e8f0', fontWeight: 700 }}>{p.slice(2, -2)}</strong>
    }
    // Italic: *text*
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
      return <em key={i} style={{ color: '#94a3b8' }}>{p.slice(1, -1)}</em>
    }
    return p
  })
}

const supabase = createClient()

function AllChatsView() {
  const [conversations, setConversations] = useState(null) // null = loading
  const [activeAgent, setActiveAgent] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setConversations([]); return }
      const { data } = await supabase
        .from('agent_conversations')
        .select('agent_id, agent_label, messages, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
      setConversations(data || [])
      if (data?.length) setActiveAgent(data[0].agent_id)
    }
    load()
  }, [])

  if (conversations === null) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 12 }}>Loading...</div>
  }

  if (conversations.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 26, opacity: 0.3 }}>◈</div>
        <div style={{ color: '#475569', fontSize: 13, fontWeight: 600 }}>No chats yet</div>
        <div style={{ color: '#334155', fontSize: 11, lineHeight: 1.5 }}>Click any agent node to start a conversation. Chats are saved here.</div>
      </div>
    )
  }

  const active = conversations.find(c => c.agent_id === activeAgent)

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Agent list */}
      <div style={{ width: 110, flexShrink: 0, borderRight: '1px solid #1e3a5f', overflowY: 'auto', scrollbarWidth: 'none' }}>
        {conversations.map(c => (
          <div
            key={c.agent_id}
            onClick={() => setActiveAgent(c.agent_id)}
            style={{
              padding: '10px 10px',
              cursor: 'pointer',
              borderBottom: '1px solid #1e3a5f',
              background: c.agent_id === activeAgent ? 'rgba(99,102,241,0.15)' : 'transparent',
              borderLeft: c.agent_id === activeAgent ? '2px solid #6366f1' : '2px solid transparent',
              transition: 'all 0.12s',
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: '50%', marginBottom: 5,
              background: 'linear-gradient(135deg,#6366f1,#a78bfa)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 11, fontWeight: 700,
            }}>
              {(c.agent_label || '?')[0]}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: c.agent_id === activeAgent ? '#a78bfa' : '#64748b', lineHeight: 1.3 }}>
              {c.agent_label || c.agent_id}
            </div>
            <div style={{ fontSize: 9, color: '#334155', marginTop: 3 }}>
              {c.messages?.length || 0} msgs
            </div>
          </div>
        ))}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 8, scrollbarWidth: 'none', background: '#0d1829' }}>
        {active?.messages?.length ? (
          <>
            <div style={{ fontSize: 10, color: '#334155', textAlign: 'center', marginBottom: 4 }}>
              {active.agent_label} · {new Date(active.updated_at).toLocaleDateString()}
            </div>
            {active.messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '90%', padding: '7px 11px', borderRadius: 9, fontSize: 12, lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  background: m.role === 'user'
                    ? 'linear-gradient(135deg,#6366f1,#8b5cf6)'
                    : 'rgba(255,255,255,0.04)',
                  color: m.role === 'user' ? '#fff' : '#cbd5e1',
                  border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.07)',
                  borderBottomRightRadius: m.role === 'user' ? 2 : 9,
                  borderBottomLeftRadius: m.role === 'assistant' ? 2 : 9,
                }}>
                  {m.content}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div style={{ color: '#334155', fontSize: 11, textAlign: 'center', marginTop: 20 }}>No messages</div>
        )}
      </div>
    </div>
  )
}

const CTO_AVATAR = `https://api.dicebear.com/9.x/avataaars/svg?seed=CTO&backgroundColor=0ea5e9,38bdf8,6366f1&backgroundType=gradientLinear`

function dispatchActivity(agent, type, text) {
  window.dispatchEvent(new CustomEvent('agentActivity', { detail: { agent, type, text } }))
}

const BuilderChat = forwardRef(function BuilderChat({ onOrgUpdate }, ref) {
  const [view, setView] = useState('builder') // 'builder' | 'history'
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Welcome to Svet's Dream.\n\nWhat do you want to build? Describe your idea and I'll assemble your team.",
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [queued, setQueued] = useState([])
  const [currentOrg, setCurrentOrg] = useState(null)
  const [orgReady, setOrgReady] = useState(false)
  const bottomRef = useRef(null)
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])

  useImperativeHandle(ref, () => ({
    addScreenshotMessage({ screenshot, assessment, passed }) {
      setMessages(prev => [...prev, { role: 'assistant', content: assessment, screenshot, passed, isAssessment: true }])
    }
  }))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-send next queued message when done loading
  useEffect(() => {
    if (!loading && queued.length > 0) {
      const [next, ...rest] = queued
      setQueued(rest)
      sendText(next)
    }
  }, [loading])

  function send() {
    if (!input.trim()) return
    const text = input.trim()
    setInput('')
    if (loading) {
      setQueued(prev => [...prev, text])
    } else {
      sendText(text)
    }
  }

  async function sendText(text) {
    const userMsg = { role: 'user', content: text }
    const chatMessages = [...messagesRef.current.filter(m => !m.isAssessment), userMsg]
    setMessages(prev => [...prev, userMsg])
    setLoading(true)
    dispatchActivity('CTO', 'thinking', 'Reading your message...')

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
        dispatchActivity('CTO', 'complete', 'Team assembled')
        window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'info', data: { text: 'Team assembled — ready to build' } } }))
        setOrgReady(true)
      }

      const reply = parsed.message || 'Got it.'
      dispatchActivity('CTO', 'sent', reply.slice(0, 120))
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      dispatchActivity('CTO', 'error', err.message)
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ width: 620, minWidth: 440, display: 'flex', flexDirection: 'column', background: '#0d1829', borderRight: '1px solid #1e3a5f', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 0', borderBottom: '1px solid #1e3a5f', background: 'rgba(99,102,241,0.12)', flexShrink: 0 }}>
        <div style={{ color: '#a78bfa', fontWeight: 800, fontSize: 17, letterSpacing: '-0.3px', marginBottom: 10 }}>{"Svet's Dream"}</div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0 }}>
          {[['builder', 'Org Builder'], ['history', 'Chat History']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              style={{
                padding: '6px 14px', border: 'none', cursor: 'pointer',
                background: 'transparent', fontSize: 11, fontWeight: 600,
                color: view === id ? '#a78bfa' : '#475569',
                borderBottom: view === id ? '2px solid #6366f1' : '2px solid transparent',
                transition: 'all 0.15s', letterSpacing: '0.02em',
              }}
            >{label}</button>
          ))}
        </div>
      </div>

      {view === 'history' ? <AllChatsView /> : (
        <>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10, scrollbarWidth: 'none', background: '#0d1829' }}>
            <style>{`div::-webkit-scrollbar{display:none}`}</style>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {m.role === 'assistant' && !m.isAssessment && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#0EA5E9', letterSpacing: '0.08em', textTransform: 'uppercase', marginLeft: 38, marginBottom: 3 }}>CTO</div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                  {m.role === 'assistant' && (
                    <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', border: '1.5px solid #0EA5E9', background: '#0c2040', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {m.isAssessment ? (
                        <span style={{ fontSize: 12, color: m.passed ? '#10B981' : '#EF4444' }}>{m.passed ? '✓' : '✗'}</span>
                      ) : (
                        <img src={CTO_AVATAR} alt="CTO" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
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
                    {m.role === 'assistant' ? <MarkdownText text={m.content} /> : m.content}
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
                <div style={{ width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', border: '1.5px solid #0EA5E9', background: '#0c2040', flexShrink: 0 }}>
                  <img src={CTO_AVATAR} alt="CTO" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <style>{`@keyframes thinkDot{0%,80%,100%{transform:scale(0);opacity:0.3}40%{transform:scale(1);opacity:1}}`}</style>
                  {[0, 0.15, 0.3].map((d, i) => (
                    <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#a78bfa', animation: `thinkDot 1.2s ${d}s ease-in-out infinite` }} />
                  ))}
                  <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 600, marginLeft: 4 }}>CTO is thinking...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Start Building CTA — appears once org is assembled */}
          {orgReady && currentOrg && (
            <div style={{
              margin: '0 12px 10px',
              padding: '12px 16px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(14,165,233,0.12))',
              border: '1px solid rgba(99,102,241,0.4)',
              display: 'flex', alignItems: 'center', gap: 12,
              flexShrink: 0,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>Team assembled</div>
                <div style={{ fontSize: 11, color: '#6366f1' }}>Open the CTO to start building your project</div>
              </div>
              <button
                onClick={() => {
                  const ctoNode = currentOrg.nodes?.find(n => n.id !== 'rules' && (n.level ?? 0) === 0)
                  if (!ctoNode) return
                  window.dispatchEvent(new CustomEvent('openAgent', {
                    detail: {
                      agent: ctoNode,
                      kickoff: `The team is assembled. Let's start building. Check for any existing VISION.md or project files first, then either continue existing work or begin the vision process with me.`,
                    }
                  }))
                }}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: 'none', flexShrink: 0,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 12px rgba(99,102,241,0.4)',
                }}
              >
                Start Building →
              </button>
            </div>
          )}

          {/* Input */}
          <div style={{ padding: '12px', borderTop: '1px solid #1e3a5f', background: '#0a1520', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={loading ? 'CTO is thinking...' : 'What do you want to build?'} rows={3}
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
              <button onClick={send} disabled={!input.trim()}
                style={{
                  padding: '10px 14px', borderRadius: 10, border: 'none',
                  background: !input.trim() ? '#1e293b' : loading ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                  color: !input.trim() ? '#334155' : '#fff',
                  fontWeight: 700, fontSize: 16, cursor: !input.trim() ? 'not-allowed' : 'pointer',
                  alignSelf: 'flex-end', transition: 'all 0.15s',
                }}>{loading ? '⏎' : '↑'}</button>
            </div>
            <div style={{ fontSize: 10, color: '#334155', marginTop: 6, textAlign: 'center' }}>Enter to send · Shift+Enter for new line</div>
          </div>
        </>
      )}
    </div>
  )
})

export default BuilderChat
