'use client'
import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase'

const AVATAR_BASE = 'https://api.dicebear.com/9.x/avataaars/svg'

function agentAvatar(label) {
  return `${AVATAR_BASE}?seed=${encodeURIComponent(label)}&backgroundColor=0ea5e9,38bdf8,6366f1&backgroundType=gradientLinear`
}

// Formats description text — newline-separated lines become bullets
function ResumeDescription({ text }) {
  if (!text) return null
  const lines = text.split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
  if (lines.length <= 1) {
    return <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, margin: 0 }}>{text}</p>
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {lines.map((line, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
          <span style={{ color: '#6366f1', flexShrink: 0, marginTop: 1 }}>▸</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

function AgentResume({ agent, orgData, onStartChat }) {
  const avatarUrl = agentAvatar(agent.label)
  // Find who they report to
  const parents = (agent.parentIds?.length ? agent.parentIds : (agent.parentId ? [agent.parentId] : []))
    .map(pid => orgData?.nodes?.find(n => n.id === pid)?.label)
    .filter(Boolean)
  // Find their direct reports
  const reports = (orgData?.nodes || [])
    .filter(n => n.id !== 'rules' && (n.parentIds?.includes(agent.id) || n.parentId === agent.id))
    .map(n => n.label)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 20px', scrollbarWidth: 'none' }}>
      {/* Avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <img
          src={avatarUrl}
          alt={agent.label}
          style={{
            width: 72, height: 72, borderRadius: '50%',
            border: '2px solid #0EA5E9',
            background: '#fff', flexShrink: 0,
          }}
        />
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.4px' }}>{agent.label}</div>
          <div style={{
            display: 'inline-block', marginTop: 4,
            fontSize: 11, fontWeight: 700, color: '#0EA5E9',
            background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)',
            borderRadius: 20, padding: '2px 10px', letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            {agent.role}
          </div>
        </div>
      </div>

      {/* Reporting lines */}
      {(parents.length > 0 || reports.length > 0) && (
        <div style={{
          display: 'flex', gap: 16, marginBottom: 20,
          padding: '12px 14px', background: 'rgba(99,102,241,0.07)',
          borderRadius: 10, border: '1px solid rgba(99,102,241,0.15)',
        }}>
          {parents.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Reports to</div>
              <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>{parents.join(' & ')}</div>
            </div>
          )}
          {parents.length > 0 && reports.length > 0 && (
            <div style={{ width: 1, background: '#1e293b', flexShrink: 0 }} />
          )}
          {reports.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Manages</div>
              <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>{reports.join(', ')}</div>
            </div>
          )}
        </div>
      )}

      {/* Description */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Responsibilities
        </div>
        <ResumeDescription text={agent.description} />
      </div>

      {/* Chat CTA */}
      <button
        onClick={onStartChat}
        style={{
          width: '100%', padding: '12px 20px', borderRadius: 10,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          border: 'none', color: '#fff', fontWeight: 700, fontSize: 14,
          cursor: 'pointer', letterSpacing: '-0.2px',
          boxShadow: '0 4px 20px rgba(99,102,241,0.35)',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      >
        Chat with {agent.label} →
      </button>
    </div>
  )
}

export default function AgentModal({ agent, orgData, rulesDescription, onClose, initialMessage }) {
  const [view, setView] = useState('resume') // 'resume' | 'chat' | 'memory'
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [queued, setQueued] = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [memories, setMemories] = useState([])
  const [memoriesLoaded, setMemoriesLoaded] = useState(false)
  const [soulMd, setSoulMd] = useState('')
  const [agentsMd, setAgentsMd] = useState('')
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const bottomRef = useRef(null)
  const abortRef = useRef(null)
  const supabase = createClient()

  // Load saved conversation on mount
  useEffect(() => {
    async function loadHistory() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setHistoryLoaded(true); return }
      const agentId = agent.id || agent.label
      const { data } = await supabase
        .from('agent_conversations')
        .select('messages')
        .eq('agent_id', agentId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (data?.messages?.length) {
        setMessages(data.messages)
        setView('chat')
      }
      setHistoryLoaded(true)
    }
    loadHistory()
  }, [agent.id, agent.label])

  // Load agent profile (SOUL.md + AGENTS.md) when soul view opens
  useEffect(() => {
    if (view !== 'soul' || profileLoaded) return
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const agentId = agent.id || agent.label
      const { data } = await supabase
        .from('agent_profiles')
        .select('soul_md, agents_md')
        .eq('agent_id', agentId)
        .eq('user_id', user.id)
        .maybeSingle()
      setSoulMd(data?.soul_md || '')
      setAgentsMd(data?.agents_md || '')
      setProfileLoaded(true)
    }
    loadProfile()
  }, [view])

  async function saveProfile() {
    setSavingProfile(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingProfile(false); return }
    const agentId = agent.id || agent.label
    await supabase.from('agent_profiles').upsert({
      user_id: user.id,
      agent_id: agentId,
      agent_label: agent.label,
      soul_md: soulMd,
      agents_md: agentsMd,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,agent_id' })
    setSavingProfile(false)
  }

  // Load memories when memory view is opened
  useEffect(() => {
    if (view !== 'memory' || memoriesLoaded) return
    async function loadMemories() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const agentId = agent.id || agent.label
      const { data } = await supabase
        .from('agent_memories')
        .select('id, content, type, importance, created_at')
        .eq('agent_id', agentId)
        .eq('user_id', user.id)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
      setMemories(data || [])
      setMemoriesLoaded(true)
    }
    loadMemories()
  }, [view])

  // If opened with a kickoff message and no history, switch to chat and pre-fill input
  const kickoffFiredRef = useRef(false)
  useEffect(() => {
    if (!initialMessage || kickoffFiredRef.current) return
    if (!historyLoaded) return
    if (messages.length > 0) return
    kickoffFiredRef.current = true
    setView('chat')
    setInput(initialMessage)
  }, [historyLoaded, initialMessage])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!loading && queued.length > 0) {
      const [next, ...rest] = queued
      setQueued(rest)
      sendMessage(next)
    }
  }, [loading])

  async function deleteMemory(id) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('agent_memories').delete().eq('id', id).eq('user_id', user.id)
    setMemories(prev => prev.filter(m => m.id !== id))
  }

  function emitStatus(active) {
    window.dispatchEvent(new CustomEvent('agentStatus', { detail: { agentId: agent.id || agent.label, active } }))
  }

  async function saveHistory(msgs) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const agentId = agent.id || agent.label
    await supabase.from('agent_conversations').upsert({
      user_id: user.id,
      agent_id: agentId,
      agent_label: agent.label,
      messages: msgs,
      org_snapshot: orgData,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,agent_id' })
  }

  function renderContent(rawText) {
    if (!rawText) return null
    // Strip internal signaling markers before display
    const text = rawText.replace(/<!--agent-(?:active|idle):[^>]*-->/g, '')
    // Split into paragraphs (double newline), then handle images within each paragraph
    const imgRe = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim())
    return paragraphs.map((para, pi) => {
      const parts = []
      let last = 0, m
      imgRe.lastIndex = 0
      while ((m = imgRe.exec(para)) !== null) {
        if (m.index > last) parts.push({ type: 'text', value: para.slice(last, m.index) })
        parts.push({ type: 'img', alt: m[1], src: m[2] })
        last = m.index + m[0].length
      }
      if (last < para.length) parts.push({ type: 'text', value: para.slice(last) })
      return (
        <p key={pi} style={{ margin: 0, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {parts.map((p, i) => p.type === 'img'
            ? <img key={i} src={p.src} alt={p.alt || 'screenshot'}
                style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8, display: 'block', border: '1px solid rgba(255,255,255,0.1)' }} />
            : <span key={i}>{p.value}</span>
          )}
        </p>
      )
    })
  }

  function emit(type, text) {
    window.dispatchEvent(new CustomEvent('agentActivity', { detail: { agent: agent.label, type, text } }))
  }

  function emitBuild(type, data) {
    window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type, data } }))
  }

  // Parse <!--agent-active:id--> and <!--agent-idle:id--> markers from delegation stream
  function parseDelegationMarkers(text, lastIdx) {
    const slice = text.slice(lastIdx)
    const activeRe = /<!--agent-active:([^-]+)-->/g
    const idleRe = /<!--agent-idle:([^-]+)-->/g
    let m
    while ((m = activeRe.exec(slice)) !== null) {
      window.dispatchEvent(new CustomEvent('agentStatus', { detail: { agentId: m[1].trim(), active: true } }))
    }
    while ((m = idleRe.exec(slice)) !== null) {
      window.dispatchEvent(new CustomEvent('agentStatus', { detail: { agentId: m[1].trim(), active: false } }))
    }
  }

  function parseBuilderEventsFrom(text, lastIdx) {
    // First parse delegation markers for gear spinning
    parseDelegationMarkers(text, lastIdx)

    const slice = text.slice(lastIdx)
    const events = []
    let newIdx = lastIdx

    const cmdRe = /💻 \*\*Running:\*\* `([^`\n]{1,300})`/g
    let m
    while ((m = cmdRe.exec(slice)) !== null) {
      const absEnd = lastIdx + m.index + m[0].length
      if (absEnd > lastIdx) events.push({ type: 'command', data: { command: m[1] }, absEnd })
    }

    const outRe = /\*\*(?:Host )?(?:VM )?Output\*\*(?:[^\n]*\(exit (\d+)\))?[^\n]*\n```[^\n]*\n([\s\S]*?)```/g
    while ((m = outRe.exec(slice)) !== null) {
      const absEnd = lastIdx + m.index + m[0].length
      if (absEnd > lastIdx) {
        const exitCode = m[1] !== undefined ? parseInt(m[1]) : 0
        const output = m[2].trimEnd()
        events.push({ type: 'output', data: { exitCode, output }, absEnd })
        const urlMatch = output.match(/https?:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+/)
        if (urlMatch) events.push({ type: 'url', data: { url: urlMatch[0] }, absEnd })
      }
    }

    const fileRe = /(?:cat\s*>\s*([^\s<'"]+)|tee\s+([^\s'"]+))\s*<<[^']*'?EOF'?\s*\n([\s\S]*?)\nEOF/g
    while ((m = fileRe.exec(slice)) !== null) {
      const absEnd = lastIdx + m.index + m[0].length
      if (absEnd > lastIdx) {
        const path = (m[1] || m[2]).trim()
        events.push({ type: 'file', data: { path, content: m[3] }, absEnd })
      }
    }

    events.sort((a, b) => a.absEnd - b.absEnd)
    if (events.length > 0) newIdx = events[events.length - 1].absEnd
    return { events, newIdx }
  }

  function stop() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setLoading(false)
    setQueued([])
    emitStatus(false)
    emit('observe', 'Response stopped by user')
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === 'assistant') {
        return [...prev.slice(0, -1), { ...last, content: last.content + '\n\n*(stopped)*' }]
      }
      return prev
    })
  }

  async function sendMessage(text) {
    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(prev => [...prev, userMsg])
    emit('sent', text.slice(0, 80))
    setLoading(true)
    emitStatus(true)
    emit('thinking', `${agent.label} is thinking...`)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
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
      let builderParsedIdx = 0

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        assistantText += chunk

        const { events, newIdx } = parseBuilderEventsFrom(assistantText, builderParsedIdx)
        builderParsedIdx = newIdx
        for (const evt of events) emitBuild(evt.type, evt.data)

        if (chunk.includes('💻 **Running:**')) {
          const cmd = chunk.match(/`([^`]+)`/)
          emit('bash', cmd ? cmd[1] : 'Running bash command...')
        } else if (chunk.includes('🖥️ **VM:**')) {
          emit('vm', 'Executing in VM sandbox...')
        } else if (chunk.includes('🌐 **Browser:**')) {
          emit('browser', chunk.replace('🌐 **Browser:**', '').trim().slice(0, 60))
        } else if (chunk.includes('🔍') || chunk.toLowerCase().includes('searching')) {
          emit('search', 'Searching the web...')
        } else if (chunk.includes('**Output**') || chunk.includes('**Host Output**')) {
          emit('observe', 'Reading command output...')
        }

        setMessages(prev => [
          ...prev.slice(0, -1),
          { role: 'assistant', content: assistantText },
        ])
      }

      emit('complete', `${agent.label} finished responding`)
      emitStatus(false)
      const finalMsgs = [...newMessages, { role: 'assistant', content: assistantText }]
      saveHistory(finalMsgs).catch(() => {})
    } catch (err) {
      emitStatus(false)
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
        emit('error', err.message)
      }
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  function send() {
    if (!input.trim()) return
    const text = input.trim()
    setInput('')
    if (loading) {
      setQueued(prev => [...prev, text])
      emit('observe', `Message queued: ${text.slice(0, 40)}...`)
    } else {
      sendMessage(text)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
      backdropFilter: 'blur(4px)',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#080f20',
        borderRadius: 16, width: '100%', maxWidth: 580,
        height: view === 'resume' ? 'auto' : '80vh',
        maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(99,102,241,0.25)',
        border: '1px solid #1e293b', overflow: 'hidden',
        transition: 'height 0.25s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid #1e293b',
          background: 'rgba(99,102,241,0.08)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {(view === 'chat' || view === 'memory' || view === 'soul') && (
            <button onClick={() => setView('resume')} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#475569', fontSize: 18, padding: '0 4px', lineHeight: 1,
            }} title="Back to profile">←</button>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, color: view === 'resume' ? '#6366f1' : '#e2e8f0' }}>
            {view === 'resume' ? 'Agent Profile' : view === 'memory' ? `${agent.label} — Memory` : view === 'soul' ? `${agent.label} — Soul` : agent.label}
          </div>
          {view === 'chat' && loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#a78bfa', animation: 'pulse 1s ease-in-out infinite' }} />
              <span style={{ fontSize: 10, color: '#6366f1' }}>thinking</span>
            </div>
          )}
          {view === 'chat' && queued.length > 0 && (
            <div style={{ fontSize: 10, color: '#475569', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 10 }}>
              {queued.length} queued
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {view === 'resume' && (
              <>
                <button onClick={() => setView('soul')} title="Edit Soul & Instructions" style={{
                  background: 'none', border: '1px solid #1e293b', cursor: 'pointer',
                  fontSize: 10, color: '#64748b', padding: '3px 8px', borderRadius: 6,
                  fontWeight: 600,
                }} onMouseOver={e => e.target.style.color='#f59e0b'} onMouseOut={e => e.target.style.color='#64748b'}>
                  ✦ Soul
                </button>
                <button onClick={() => setView('memory')} title="View memory" style={{
                  background: 'none', border: '1px solid #1e293b', cursor: 'pointer',
                  fontSize: 10, color: '#64748b', padding: '3px 8px', borderRadius: 6,
                  fontWeight: 600,
                }} onMouseOver={e => e.target.style.color='#a78bfa'} onMouseOut={e => e.target.style.color='#64748b'}>
                  🧠 Memory
                </button>
              </>
            )}
            {view === 'chat' && (
              <button onClick={async () => {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return
                const agentId = agent.id || agent.label
                await supabase.from('agent_conversations').delete()
                  .eq('user_id', user.id).eq('agent_id', agentId)
                setMessages([])
              }} title="Clear history" style={{
                background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 11, color: '#475569', padding: '4px 8px',
                borderRadius: 6,
              }} onMouseOver={e => e.target.style.color='#f87171'} onMouseOut={e => e.target.style.color='#475569'}>
                Clear
              </button>
            )}
            <button onClick={onClose} style={{
              background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 18, color: '#334155', padding: 4,
            }}>×</button>
          </div>
        </div>

        {view === 'soul' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
              <strong style={{ color: '#f59e0b' }}>Soul</strong> defines who {agent.label} is — personality, values, tone. Injected first into every conversation.{' '}
              <strong style={{ color: '#6366f1' }}>Instructions</strong> define what they do — workflows, rules, constraints.
            </div>

            <div>
              <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                SOUL.MD — Personality & Values
              </div>
              <textarea
                value={soulMd}
                onChange={e => setSoulMd(e.target.value)}
                placeholder={`Describe ${agent.label}'s personality, values, communication style, and tone.\n\nExample:\n${agent.label} is direct, opinionated, and doesn't sugarcoat feedback. They value precision over politeness. They speak in short sentences and call out bad work immediately.`}
                style={{
                  width: '100%', minHeight: 140, padding: '10px 12px',
                  background: '#0d1526', border: '1px solid #1e293b', borderRadius: 8,
                  color: '#e2e8f0', fontSize: 12, lineHeight: 1.65,
                  fontFamily: 'monospace', resize: 'vertical', outline: 'none',
                  boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = '#f59e0b'}
                onBlur={e => e.target.style.borderColor = '#1e293b'}
              />
            </div>

            <div>
              <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                AGENTS.MD — Custom Instructions (overrides defaults)
              </div>
              <textarea
                value={agentsMd}
                onChange={e => setAgentsMd(e.target.value)}
                placeholder={`Override ${agent.label}'s default workflow instructions.\n\nLeave blank to use defaults. When filled, this replaces the built-in role instructions entirely.`}
                style={{
                  width: '100%', minHeight: 120, padding: '10px 12px',
                  background: '#0d1526', border: '1px solid #1e293b', borderRadius: 8,
                  color: '#e2e8f0', fontSize: 12, lineHeight: 1.65,
                  fontFamily: 'monospace', resize: 'vertical', outline: 'none',
                  boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = '#6366f1'}
                onBlur={e => e.target.style.borderColor = '#1e293b'}
              />
            </div>

            <button
              onClick={saveProfile}
              disabled={savingProfile}
              style={{
                padding: '11px 20px', borderRadius: 10, border: 'none',
                background: savingProfile ? '#1e293b' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: savingProfile ? '#475569' : '#fff',
                fontWeight: 700, fontSize: 13, cursor: savingProfile ? 'not-allowed' : 'pointer',
              }}
            >
              {savingProfile ? 'Saving...' : 'Save Soul & Instructions'}
            </button>
          </div>
        ) : view === 'memory' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', scrollbarWidth: 'none' }}>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
              Long-term Memory — {memories.length} {memories.length === 1 ? 'entry' : 'entries'}
            </div>
            {!memoriesLoaded && <div style={{ color: '#334155', fontSize: 12 }}>Loading...</div>}
            {memoriesLoaded && memories.length === 0 && (
              <div style={{ textAlign: 'center', color: '#334155', marginTop: 40, fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>🧠</div>
                <div>No memories yet.</div>
                <div style={{ fontSize: 12, marginTop: 6, color: '#1e293b' }}>
                  {agent.label} will save important facts here automatically.
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {memories.map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{
                    flexShrink: 0, marginTop: 1,
                    fontSize: 10, fontWeight: 700, color: m.importance >= 4 ? '#f59e0b' : m.importance >= 3 ? '#6366f1' : '#475569',
                    background: m.importance >= 4 ? 'rgba(245,158,11,0.1)' : 'rgba(99,102,241,0.1)',
                    border: `1px solid ${m.importance >= 4 ? 'rgba(245,158,11,0.2)' : 'rgba(99,102,241,0.2)'}`,
                    borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {m.type}
                  </div>
                  <div style={{ flex: 1, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{m.content}</div>
                  <button onClick={() => deleteMemory(m.id)} style={{
                    flexShrink: 0, background: 'none', border: 'none',
                    cursor: 'pointer', color: '#1e293b', fontSize: 14, padding: '0 2px',
                    lineHeight: 1,
                  }}
                  onMouseOver={e => e.target.style.color='#f87171'}
                  onMouseOut={e => e.target.style.color='#1e293b'}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : view === 'resume' ? (
          <AgentResume agent={agent} orgData={orgData} onStartChat={() => setView('chat')} />
        ) : (
          <>
            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '14px 18px',
              display: 'flex', flexDirection: 'column', gap: 10,
              scrollbarWidth: 'none',
            }}>
              <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
              {!historyLoaded && (
                <div style={{ textAlign: 'center', color: '#334155', marginTop: 40, fontSize: 12, opacity: 0.5 }}>Loading history...</div>
              )}
              {historyLoaded && messages.length === 0 && (
                <div style={{ textAlign: 'center', color: '#334155', marginTop: 40, fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.5 }}>◈</div>
                  <div style={{ fontWeight: 600, color: '#475569' }}>Talk to {agent.label}</div>
                  <div style={{ marginTop: 6, fontSize: 12, maxWidth: 320, margin: '8px auto 0', color: '#334155' }}>{agent.role}</div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '87%', padding: '9px 13px', borderRadius: 10,
                    fontSize: 13, lineHeight: 1.65,
                    background: m.role === 'user'
                      ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                      : 'rgba(255,255,255,0.04)',
                    color: m.role === 'user' ? '#fff' : '#cbd5e1',
                    border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.07)',
                    borderBottomRightRadius: m.role === 'user' ? 2 : 10,
                    borderBottomLeftRadius: m.role === 'assistant' ? 2 : 10,
                  }}>
                    {m.content
                      ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{renderContent(m.content)}</div>
                      : (loading && i === messages.length - 1 ? <span style={{ opacity: 0.4 }}>▋</span> : '')
                    }
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '10px 14px', borderTop: '1px solid #1e293b', background: '#070d1c', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder={loading ? `Message ${agent.label} (will queue)...` : `Message ${agent.label}...`}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 10,
                  border: '1px solid #1e293b', outline: 'none',
                  fontSize: 13, background: '#0d1526', color: '#e2e8f0',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = '#6366f1'}
                onBlur={e => e.target.style.borderColor = '#1e293b'}
                autoFocus
              />
              {loading && (
                <button onClick={stop} style={{
                  padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)',
                  background: 'rgba(239,68,68,0.1)', color: '#f87171',
                  fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  ■ Stop
                </button>
              )}
              <button
                onClick={send}
                disabled={!input.trim()}
                style={{
                  padding: '10px 16px', borderRadius: 10, border: 'none',
                  background: !input.trim() ? '#1e293b' : loading ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: !input.trim() ? '#334155' : '#fff',
                  fontWeight: 600, fontSize: 13,
                  cursor: !input.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {loading ? '↑ Queue' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
