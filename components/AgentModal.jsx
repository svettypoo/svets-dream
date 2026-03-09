'use client'
import { useState, useRef, useEffect } from 'react'

export default function AgentModal({ agent, orgData, rulesDescription, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [queued, setQueued] = useState([]) // messages queued while AI is responding
  const bottomRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-send next queued message when AI finishes
  useEffect(() => {
    if (!loading && queued.length > 0) {
      const [next, ...rest] = queued
      setQueued(rest)
      sendMessage(next)
    }
  }, [loading])

  function emit(type, text) {
    window.dispatchEvent(new CustomEvent('agentActivity', { detail: { agent: agent.label, type, text } }))
  }

  function emitBuild(type, data) {
    window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type, data } }))
  }

  // Parse commands, outputs, files, and URLs from accumulated stream text.
  // Returns newly found events since lastIdx, and the new lastIdx.
  function parseBuilderEventsFrom(text, lastIdx) {
    const slice = text.slice(lastIdx)
    const events = []
    let newIdx = lastIdx

    // Command: 💻 **Running:** `cmd`
    const cmdRe = /💻 \*\*Running:\*\* `([^`\n]{1,300})`/g
    let m
    while ((m = cmdRe.exec(slice)) !== null) {
      const absEnd = lastIdx + m.index + m[0].length
      if (absEnd > lastIdx) {
        events.push({ type: 'command', data: { command: m[1] }, absEnd })
      }
    }

    // Output block: **Output** (exit N):\n```\n...\n```
    const outRe = /\*\*(?:Host )?(?:VM )?Output\*\*(?:[^\n]*\(exit (\d+)\))?[^\n]*\n```[^\n]*\n([\s\S]*?)```/g
    while ((m = outRe.exec(slice)) !== null) {
      const absEnd = lastIdx + m.index + m[0].length
      if (absEnd > lastIdx) {
        const exitCode = m[1] !== undefined ? parseInt(m[1]) : 0
        const output = m[2].trimEnd()
        events.push({ type: 'output', data: { exitCode, output }, absEnd })

        // URL detection in output
        const urlMatch = output.match(/https?:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+/)
        if (urlMatch) {
          events.push({ type: 'url', data: { url: urlMatch[0] }, absEnd })
        }
      }
    }

    // File detection from bash heredoc: cat > path << or tee path
    const fileRe = /(?:cat\s*>\s*([^\s<'"]+)|tee\s+([^\s'"]+))\s*<<[^']*'?EOF'?\s*\n([\s\S]*?)\nEOF/g
    while ((m = fileRe.exec(slice)) !== null) {
      const absEnd = lastIdx + m.index + m[0].length
      if (absEnd > lastIdx) {
        const path = (m[1] || m[2]).trim()
        events.push({ type: 'file', data: { path, content: m[3] }, absEnd })
      }
    }

    // Sort by position so events are emitted in order
    events.sort((a, b) => a.absEnd - b.absEnd)

    // Update newIdx to furthest event seen
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
    const newMessages = [...messages.filter((_, i) => true), userMsg]
    setMessages(prev => [...prev, userMsg])
    emit('sent', text.slice(0, 80))
    setLoading(true)
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

        // Dispatch builder events as they arrive
        const { events, newIdx } = parseBuilderEventsFrom(assistantText, builderParsedIdx)
        builderParsedIdx = newIdx
        for (const evt of events) {
          emitBuild(evt.type, evt.data)
        }

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
    } catch (err) {
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
      // Queue it — will auto-send when current response finishes
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
        borderRadius: 16, width: '100%', maxWidth: 620,
        height: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(99,102,241,0.25)',
        border: '1px solid #1e293b', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid #1e293b',
          background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 15,
          }}>
            {agent.label?.[0]}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>{agent.label}</div>
            <div style={{ fontSize: 11, color: '#475569' }}>{agent.role}</div>
          </div>
          {loading && (
            <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', animation: 'pulse 1s ease-in-out infinite' }} />
              <span style={{ fontSize: 11, color: '#6366f1' }}>thinking</span>
            </div>
          )}
          {queued.length > 0 && (
            <div style={{ fontSize: 10, color: '#475569', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 10 }}>
              {queued.length} queued
            </div>
          )}
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 18, color: '#334155', padding: 4,
          }}>×</button>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '14px 18px',
          display: 'flex', flexDirection: 'column', gap: 10,
          scrollbarWidth: 'none',
        }}>
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#334155', marginTop: 40, fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.5 }}>◈</div>
              <div style={{ fontWeight: 600, color: '#475569' }}>Talk to {agent.label}</div>
              <div style={{ marginTop: 6, fontSize: 12, maxWidth: 320, margin: '8px auto 0' }}>{agent.description}</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '87%', padding: '9px 13px', borderRadius: 10,
                fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                background: m.role === 'user'
                  ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                  : 'rgba(255,255,255,0.04)',
                color: m.role === 'user' ? '#fff' : '#cbd5e1',
                border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.07)',
                borderBottomRightRadius: m.role === 'user' ? 2 : 10,
                borderBottomLeftRadius: m.role === 'assistant' ? 2 : 10,
                fontFamily: m.content?.includes('```') ? 'inherit' : 'inherit',
              }}>
                {m.content || (loading && i === messages.length - 1
                  ? <span style={{ opacity: 0.4 }}>▋</span>
                  : ''
                )}
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
      </div>
    </div>
  )
}
