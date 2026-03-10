'use client'
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { createClient } from '@/lib/supabase'

// ── Terminal block — renders bash output as a real terminal window ─────────
function TerminalBlock({ content }) {
  const [copied, setCopied] = useState(false)
  const lines = content.split('\n')
  // Determine exit status from last line
  const lastLine = lines[lines.length - 1] || ''
  const exitMatch = lastLine.match(/\[exit:\s*(\d+)\]/)
  const exitCode = exitMatch ? parseInt(exitMatch[1]) : null
  const succeeded = exitCode === 0

  function copy() {
    navigator.clipboard?.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e3a5f', margin: '6px 0', fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace' }}>
      {/* Title bar */}
      <div style={{ background: '#162032', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #1e3a5f' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
        <span style={{ color: '#4b6785', fontSize: 10, fontWeight: 600, marginLeft: 4, flex: 1 }}>bash</span>
        {exitCode !== null && (
          <span style={{ fontSize: 10, fontWeight: 700, color: succeeded ? '#4ade80' : '#f87171', background: succeeded ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', padding: '1px 7px', borderRadius: 8, border: `1px solid ${succeeded ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}` }}>
            exit {exitCode}
          </span>
        )}
        <button onClick={copy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#4ade80' : '#4b6785', fontSize: 10, padding: '0 4px', transition: 'color 0.15s' }}>
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      {/* Body */}
      <div style={{ background: '#060f1a', padding: '10px 14px', maxHeight: 380, overflowY: 'auto', scrollbarWidth: 'none' }}>
        {lines.map((line, i) => {
          const isExit = /^\[exit:\s*\d+\]/.test(line)
          const isError = /^\[error:/.test(line) || /^error:/i.test(line)
          const isWarn = /^warn/i.test(line) || /^npm warn/i.test(line)
          const isSuccess = /✓|✅|success|done|complete/i.test(line) && !isError
          const color = isExit ? (succeeded ? '#4ade80' : '#f87171')
            : isError ? '#f87171'
            : isWarn ? '#fbbf24'
            : '#a3e635'
          return (
            <div key={i} style={{ color, fontSize: 11.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-all', minHeight: 2 }}>
              {line || '\u00a0'}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Inline text renderer — bold, italic, backtick ─────────────────────────
function renderInline(text) {
  // Split on **bold**, *italic*, and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: '#e2e8f0', fontWeight: 700 }}>{p.slice(2, -2)}</strong>
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i} style={{ color: '#94a3b8' }}>{p.slice(1, -1)}</em>
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={i} style={{ background: 'rgba(99,102,241,0.15)', color: '#a78bfa', padding: '1px 5px', borderRadius: 4, fontSize: '0.9em', fontFamily: 'monospace' }}>{p.slice(1, -1)}</code>
    return p
  })
}

// ── Markdown renderer — handles headings, lists, code blocks, separators ──
function MarkdownText({ text }) {
  if (!text) return null

  // Split text into segments: normal text vs fenced code blocks
  const segments = []
  const codeBlockRe = /```[\w]*\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match
  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    segments.push({ type: 'code', content: match[1] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) segments.push({ type: 'text', content: text.slice(lastIndex) })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {segments.map((seg, si) => {
        if (seg.type === 'code') return <TerminalBlock key={si} content={seg.content} />
        // Render text lines
        return seg.content.split('\n').map((line, i) => {
          if (!line.trim()) return <div key={`${si}-${i}`} style={{ height: 4 }} />
          if (line.startsWith('### ')) return <div key={`${si}-${i}`} style={{ fontWeight: 700, fontSize: 13, color: '#a78bfa', marginTop: 6 }}>{renderInline(line.slice(4))}</div>
          if (line.startsWith('## ')) return <div key={`${si}-${i}`} style={{ fontWeight: 700, fontSize: 14, color: '#c4b5fd', marginTop: 8 }}>{renderInline(line.slice(3))}</div>
          if (line.startsWith('# ')) return <div key={`${si}-${i}`} style={{ fontWeight: 800, fontSize: 15, color: '#e2e8f0', marginTop: 8 }}>{renderInline(line.slice(2))}</div>
          if (line.match(/^[-*•]\s/)) return (
            <div key={`${si}-${i}`} style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
              <span style={{ color: '#6366f1', flexShrink: 0, marginTop: 1 }}>▸</span>
              <span>{renderInline(line.replace(/^[-*•]\s/, ''))}</span>
            </div>
          )
          if (line.match(/^\d+\.\s/)) return (
            <div key={`${si}-${i}`} style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
              <span style={{ color: '#6366f1', flexShrink: 0, minWidth: 16, fontWeight: 700, fontSize: 11 }}>{line.match(/^(\d+)\./)[1]}.</span>
              <span>{renderInline(line.replace(/^\d+\.\s/, ''))}</span>
            </div>
          )
          if (line.match(/^━{10,}|^─{10,}/)) return <div key={`${si}-${i}`} style={{ borderTop: '1px solid #1e3a5f', margin: '6px 0' }} />
          return <div key={`${si}-${i}`}>{renderInline(line)}</div>
        })
      })}
    </div>
  )
}

const supabase = createClient()

function AllChatsView() {
  const [conversations, setConversations] = useState(null)
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
        <div style={{ color: '#334155', fontSize: 11, lineHeight: 1.5 }}>Click any agent node to start a conversation.</div>
      </div>
    )
  }

  const active = conversations.find(c => c.agent_id === activeAgent)

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 110, flexShrink: 0, borderRight: '1px solid #1e3a5f', overflowY: 'auto', scrollbarWidth: 'none' }}>
        {conversations.map(c => (
          <div key={c.agent_id} onClick={() => setActiveAgent(c.agent_id)} style={{
            padding: '10px 10px', cursor: 'pointer', borderBottom: '1px solid #1e3a5f',
            background: c.agent_id === activeAgent ? 'rgba(99,102,241,0.15)' : 'transparent',
            borderLeft: c.agent_id === activeAgent ? '2px solid #6366f1' : '2px solid transparent',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', marginBottom: 5, background: 'linear-gradient(135deg,#6366f1,#a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>
              {(c.agent_label || '?')[0]}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: c.agent_id === activeAgent ? '#a78bfa' : '#64748b', lineHeight: 1.3 }}>
              {c.agent_label || c.agent_id}
            </div>
            <div style={{ fontSize: 9, color: '#334155', marginTop: 3 }}>{c.messages?.length || 0} msgs</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, scrollbarWidth: 'none', background: '#0d1829' }}>
        {active?.messages?.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '90%', padding: '7px 11px', borderRadius: 9, fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap',
              background: m.role === 'user' ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(255,255,255,0.04)',
              color: m.role === 'user' ? '#fff' : '#cbd5e1',
              border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.07)',
            }}>{m.content}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const CTO_AVATAR = `https://api.dicebear.com/9.x/avataaars/svg?seed=CTO&backgroundColor=0ea5e9,38bdf8,6366f1&backgroundType=gradientLinear`

function dispatchActivity(agent, type, text) {
  window.dispatchEvent(new CustomEvent('agentActivity', { detail: { agent, type, text } }))
}

function dispatchAgentStatus(agentId, active) {
  window.dispatchEvent(new CustomEvent('agentStatus', { detail: { agentId, active } }))
}

const BuilderChat = forwardRef(function BuilderChat({ onOrgUpdate }, ref) {
  const [view, setView] = useState('builder')
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi, I'm Svet's Dream — your AI assistant.\n\nTell me what you need. I'll track it as a task and get it done. I can research, write, plan, coordinate, or build software — whatever the task calls for." },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [queued, setQueued] = useState([])
  const [pendingApproval, setPendingApproval] = useState(null) // { id, question, options, context }
  const [currentOrg, setCurrentOrg] = useState(null)
  const [thinkingLabel, setThinkingLabel] = useState('Thinking...')
  const [quickMode, setQuickMode] = useState(false)
  const [pendingImage, setPendingImage] = useState(null) // { dataUrl, mediaType }
  const fileInputRef = useRef(null)
  const bottomRef = useRef(null)
  const messagesRef = useRef(messages)
  const currentOrgRef = useRef(currentOrg)
  const workspaceIdRef = useRef(`ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const abortRef = useRef(null) // AbortController for stopping streams
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { currentOrgRef.current = currentOrg }, [currentOrg])

  // Listen for agent activity to update the thinking label
  useEffect(() => {
    function onActivity(e) {
      const { type, text } = e.detail || {}
      if (type === 'thinking') setThinkingLabel(text || 'Thinking...')
      else if (type === 'complete') setThinkingLabel('Thinking...')
      else if (type === 'sent' || type === 'error') setThinkingLabel('Thinking...')
    }
    window.addEventListener('agentActivity', onActivity)
    return () => window.removeEventListener('agentActivity', onActivity)
  }, [])

  useImperativeHandle(ref, () => ({
    addScreenshotMessage({ screenshot, assessment, passed }) {
      setMessages(prev => [...prev, { role: 'assistant', content: assessment, screenshot, passed, isAssessment: true }])
    },
    getWorkspaceId() {
      return workspaceIdRef.current
    }
  }))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!loading && queued.length > 0) {
      const [next, ...rest] = queued
      setQueued(rest)
      sendText(next)
    }
  }, [loading])

  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target.result
      const mediaType = file.type || 'image/png'
      setPendingImage({ dataUrl, mediaType, name: file.name })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function send() {
    if (!input.trim() && !pendingImage) return
    const text = input.trim()
    setInput('')
    const img = pendingImage
    setPendingImage(null)
    if (loading) {
      setQueued(prev => [...prev, text])
    } else {
      sendText(text, img)
    }
  }

  // Parse delegation markers from streamed text — spins gears on org chart
  function parseDelegationMarkers(text) {
    const activeRe = /<!--agent-active:([^-]+)-->/g
    const idleRe = /<!--agent-idle:([^-]+)-->/g
    let m
    while ((m = activeRe.exec(text)) !== null) dispatchAgentStatus(m[1].trim(), true)
    while ((m = idleRe.exec(text)) !== null) dispatchAgentStatus(m[1].trim(), false)
  }

  function stopGeneration() {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setThinkingLabel('Thinking...')
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === 'assistant' && last.content === '') return prev.slice(0, -1)
      return prev
    })
  }

  async function sendText(text, img = null) {
    setPendingApproval(null) // clear any pending approval when user sends a message
    abortRef.current = new AbortController()
    // Build content: multimodal if image attached, plain string otherwise
    const userContent = img
      ? [
          { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.dataUrl.split(',')[1] } },
          ...(text ? [{ type: 'text', text }] : []),
        ]
      : text

    const userMsg = { role: 'user', content: userContent }
    const prevMessages = messagesRef.current.filter(m => !m.isAssessment)
    const chatMessages = [...prevMessages, userMsg]
    // Display message with thumbnail if image attached
    setMessages(prev => [...prev, { role: 'user', content: text || '(image)', imageThumb: img?.dataUrl }])
    setLoading(true)

    const org = currentOrgRef.current

    // ── Quick mode: skip CTO, go directly to implementer ──
    if (quickMode) {
      const quickAgent = {
        id: 'quick-builder', label: 'Builder',
        role: 'Senior Full-Stack Engineer', level: 1,
        description: 'Build exactly what the user requests. Report results and the preview URL directly to the user.',
      }
      // Instant ACK — show empty bubble immediately before fetch even starts
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])
      try {
        const res = await fetch('/api/agent-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortRef.current?.signal,
          body: JSON.stringify({
            agent: quickAgent,
            messages: chatMessages,
            workspaceId: workspaceIdRef.current,
            quickMode: true,
          }),
        })
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let assistantText = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          assistantText += chunk
          // Parse TASK + WORKFLOW markers (quick mode)
          const taskUpdateMatches = [...assistantText.matchAll(/<!--TASK_UPDATE:(\{[^>]+\})-->/g)]
          taskUpdateMatches.forEach(m => { try { window.dispatchEvent(new CustomEvent('taskUpdate', { detail: JSON.parse(m[1]) })) } catch {} })
          const taskListMatch = assistantText.match(/<!--TASK_LIST:(\[[^\]]*(?:\][^\]]*)*\])-->/)
          if (taskListMatch) { try { window.dispatchEvent(new CustomEvent('taskList', { detail: JSON.parse(taskListMatch[1]) })) } catch {} }
          if (assistantText.includes('<!--WORKFLOW_CREATED:')) window.dispatchEvent(new CustomEvent('workflowCreated'))
          const display = assistantText
            .replace(/<!--agent-(?:active|idle):[^>]*-->/g, '')
            .replace(/<!--PREVIEW_HTML:[A-Za-z0-9+/=]*-->/g, '')
            .replace(/<!--FILE_ENTRY:\{[^>]*\}-->/g, '')
            .replace(/<!--PREVIEW_URL:[^>]*-->/g, '')
            .replace(/<!--APPROVAL_REQUEST:[^>]*-->/g, '')
            .replace(/<!--STRUCTURED_OUTPUT:[^>]*-->/g, '')
            .replace(/<!--TOKEN_USAGE:\d+-->/g, '')
            .replace(/<!--TASK_UPDATE:[^>]*-->/g, '')
            .replace(/<!--TASK_LIST:[^>]*-->/g, '')
            .replace(/<!--WORKFLOW_CREATED:[^>]*-->/g, '')
          setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: display }])
          // Fire preview events
          const fileMatches = [...assistantText.matchAll(/<!--FILE_ENTRY:(\{[^>]+\})-->/g)]
          fileMatches.forEach(m => { try { window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'file', data: JSON.parse(m[1]) } })) } catch {} })
          const htmlMatches = [...assistantText.matchAll(/<!--PREVIEW_HTML:([A-Za-z0-9+/=]+)-->/g)]
          htmlMatches.forEach(m => { try { window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'html', data: { html: atob(m[1]) } } })) } catch {} })
          const urlMatches = [...assistantText.matchAll(/<!--PREVIEW_URL:(https?:\/\/[^>]+)-->/g)]
          urlMatches.forEach(m => window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'url', data: { url: m[1] } } })))
        }
      } catch (err) {
        if (err.name !== 'AbortError') setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${err.message}` }])
      }
      setLoading(false)
      dispatchActivity('Builder', 'complete')
      return
    }

    if (org) {
      // ── Real CTO mode: agent-chat with streaming ──
      const ctoNode = org.nodes?.find(n => n.id !== 'rules' && (n.level ?? 0) === 0)
      const rulesNode = org.nodes?.find(n => n.id === 'rules')
      dispatchActivity(ctoNode?.label || 'CTO', 'thinking', 'Reading VISION.md...')
      dispatchAgentStatus(ctoNode?.id || 'cto', true)

      // Instant ACK — show empty bubble immediately before fetch even starts
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])
      try {
        const res = await fetch('/api/agent-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortRef.current?.signal,
          body: JSON.stringify({
            agent: ctoNode,
            messages: chatMessages,
            orgContext: org,
            rules: rulesNode?.description || null,
            workspaceId: workspaceIdRef.current,
          }),
        })

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let assistantText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          assistantText += chunk
          // Parse delegation markers as they arrive (spins gears)
          parseDelegationMarkers(assistantText)
          // Update thinking label based on content patterns
          if (chunk.includes('🔍')) setThinkingLabel('Reading files...')
          else if (chunk.includes('📄')) setThinkingLabel('Writing document...')
          else if (chunk.includes('💻')) setThinkingLabel('Running command...')
          else if (chunk.includes('🌐')) setThinkingLabel('Launching browser...')
          else if (chunk.includes('🤝')) {
            const m = chunk.match(/🤝 \*\*([^→]+)→ ([^*]+)\*\*/)
            setThinkingLabel(m ? `Delegating to ${m[2].trim()}...` : 'Delegating task...')
          }
          // Parse HTML preview markers — base64 encoded HTML content
          const htmlMatches = assistantText.match(/<!--PREVIEW_HTML:([A-Za-z0-9+/=]+)-->/g)
          if (htmlMatches) {
            for (const match of htmlMatches) {
              const b64 = match.replace('<!--PREVIEW_HTML:', '').replace('-->', '')
              try {
                const html = atob(b64)
                window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'html', data: { html } } }))
              } catch {}
            }
          }
          // Parse file entry markers
          const fileMatches = assistantText.match(/<!--FILE_ENTRY:(\{[^>]+\})-->/g)
          if (fileMatches) {
            for (const match of fileMatches) {
              const json = match.replace('<!--FILE_ENTRY:', '').replace('-->', '')
              try {
                const fileData = JSON.parse(json)
                window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'file', data: fileData } }))
              } catch {}
            }
          }
          // Parse live URL markers — auto-load in Preview tab
          const urlMatches = assistantText.match(/<!--PREVIEW_URL:(https?:\/\/[^>]+)-->/g)
          if (urlMatches) {
            for (const match of urlMatches) {
              const url = match.replace('<!--PREVIEW_URL:', '').replace('-->', '').trim()
              if (url) window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'url', data: { url } } }))
            }
          }
          // Parse APPROVAL_REQUEST marker — show decision UI when stream ends
          const approvalMatch = assistantText.match(/<!--APPROVAL_REQUEST:(\{[^>]+\})-->/)
          if (approvalMatch) {
            try { setPendingApproval(JSON.parse(approvalMatch[1])) } catch {}
          }
          // Parse TASK markers (CTO mode)
          const taskUpdateMatchesCTO = [...assistantText.matchAll(/<!--TASK_UPDATE:(\{[^>]+\})-->/g)]
          taskUpdateMatchesCTO.forEach(m => { try { window.dispatchEvent(new CustomEvent('taskUpdate', { detail: JSON.parse(m[1]) })) } catch {} })
          const taskListMatchCTO = assistantText.match(/<!--TASK_LIST:(\[[^\]]*(?:\][^\]]*)*\])-->/)
          if (taskListMatchCTO) { try { window.dispatchEvent(new CustomEvent('taskList', { detail: JSON.parse(taskListMatchCTO[1]) })) } catch {} }
          if (assistantText.includes('<!--WORKFLOW_CREATED:')) window.dispatchEvent(new CustomEvent('workflowCreated'))
          // Strip all markers before displaying
          const display = assistantText
            .replace(/<!--agent-(?:active|idle):[^>]*-->/g, '')
            .replace(/<!--PREVIEW_HTML:[A-Za-z0-9+/=]*-->/g, '')
            .replace(/<!--FILE_ENTRY:\{[^>]*\}-->/g, '')
            .replace(/<!--PREVIEW_URL:[^>]*-->/g, '')
            .replace(/<!--APPROVAL_REQUEST:[^>]*-->/g, '')
            .replace(/<!--STRUCTURED_OUTPUT:[^>]*-->/g, '')
            .replace(/<!--TOKEN_USAGE:\d+-->/g, '')
            .replace(/<!--TASK_UPDATE:[^>]*-->/g, '')
            .replace(/<!--TASK_LIST:[^>]*-->/g, '')
            .replace(/<!--WORKFLOW_CREATED:[^>]*-->/g, '')
          setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: display }])
        }

        dispatchActivity(ctoNode?.label || 'CTO', 'complete', 'CTO responded')
        dispatchAgentStatus(ctoNode?.id || 'cto', false)
        // Dispatch builder update so BuilderPreview knows something happened
        window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'info', data: { text: 'CTO working...' } } }))
      } catch (err) {
        if (err.name === 'AbortError') { dispatchAgentStatus(ctoNode?.id || 'cto', false); return }
        dispatchAgentStatus(ctoNode?.id || 'cto', false)
        dispatchActivity('CTO', 'error', err.message)
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
      } finally {
        setLoading(false)
      }

    } else {
      // ── Org design mode: build-org ──
      dispatchActivity('CTO', 'thinking', 'Assembling your team...')
      try {
        const res = await fetch('/api/build-org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chatMessages, currentOrg: null }),
        })
        const rawText = await res.text()
        let parsed
        try { parsed = JSON.parse(rawText) } catch { parsed = { message: rawText } }

        if (parsed.error) {
          dispatchActivity('CTO', 'error', parsed.error)
          setMessages(prev => [...prev, { role: 'assistant', content: `❌ **Error:** ${parsed.error}` }])
          return
        }

        if (parsed.org) {
          setCurrentOrg(parsed.org)
          onOrgUpdate(parsed.org)
          dispatchActivity('CTO', 'complete', 'Team assembled')
          window.dispatchEvent(new CustomEvent('builderUpdate', { detail: { type: 'info', data: { text: 'Team assembled' } } }))
        }

        const reply = parsed.message || '(no response)'
        dispatchActivity('CTO', 'sent', reply.slice(0, 120))
        setMessages(prev => [...prev, { role: 'assistant', content: reply }])

        // Auto-start building immediately after org is assembled — no need for user to say "yes"
        if (parsed.org) {
          setTimeout(() => {
            sendText('Proceed now. Build immediately. Write the vision doc and delegate to the Backend Programmer right now. No questions.')
          }, 1200)
        }
      } catch (err) {
        dispatchActivity('CTO', 'error', err.message)
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div style={{ width: 480, minWidth: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#0d1829', borderRight: '1px solid #1e3a5f', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '8px 16px 0', borderBottom: '1px solid #1e3a5f', background: 'rgba(99,102,241,0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 12, letterSpacing: '0.05em' }}>
            {currentOrg ? 'ACTIVE BUILD' : 'CTO WORKSPACE'}
          </div>
          {currentOrg && (
            <div style={{ fontSize: 10, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
              {currentOrg.nodes?.filter(n => n.id !== 'rules').length} agents
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {[['builder', 'CTO Chat'], ['history', 'History']].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} style={{
              padding: '5px 12px', border: 'none', cursor: 'pointer',
              background: 'transparent', fontSize: 11, fontWeight: 600,
              color: view === id ? '#c4b5fd' : '#475569',
              borderBottom: view === id ? '2px solid #6366f1' : '2px solid transparent',
              transition: 'all 0.15s',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {view === 'history' ? <AllChatsView /> : (
        <>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10, scrollbarWidth: 'none', background: '#0d1829' }}>
            <style>{`div::-webkit-scrollbar{display:none} .prompt-chip:hover{background:rgba(99,102,241,0.2)!important;border-color:rgba(99,102,241,0.5)!important;color:#c4b5fd!important;}`}</style>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {m.role === 'assistant' && !m.isAssessment && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#0EA5E9', letterSpacing: '0.08em', textTransform: 'uppercase', marginLeft: 38, marginBottom: 3 }}>CTO</div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                  {m.role === 'assistant' && (
                    <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', border: '1.5px solid #0EA5E9', background: '#0c2040', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {m.isAssessment
                        ? <span style={{ fontSize: 12, color: m.passed ? '#10B981' : '#EF4444' }}>{m.passed ? '✓' : '✗'}</span>
                        : <img src={CTO_AVATAR} alt="CTO" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      }
                    </div>
                  )}
                  <div style={{
                    maxWidth: '82%', padding: '9px 13px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
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
                    {m.imageThumb && (
                      <img src={m.imageThumb} alt="attached" style={{ maxWidth: '100%', borderRadius: 6, marginBottom: 6, display: 'block' }} />
                    )}
                    {m.role === 'assistant' ? <MarkdownText text={m.content} /> : m.content}
                  </div>
                </div>
                {m.screenshot && (
                  <div style={{ maxWidth: '90%', marginTop: 8, marginLeft: 34 }}>
                    <img src={m.screenshot.startsWith('data:') ? m.screenshot : `data:image/png;base64,${m.screenshot}`}
                      alt="Visual check" style={{ width: '100%', borderRadius: 6, border: `1px solid ${m.passed ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}` }} />
                  </div>
                )}
              </div>
            ))}
            {/* Example prompts — shown only on initial state */}
            {messages.length === 1 && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, paddingLeft: 2, marginBottom: 2 }}>Try an example</div>
                {[
                  { icon: '🛒', text: 'Build a SaaS landing page with pricing tiers and a waitlist' },
                  { icon: '📊', text: 'Create a realtime analytics dashboard with charts' },
                  { icon: '🤖', text: 'Build a customer support chatbot with knowledge base' },
                  { icon: '📱', text: 'Make a mobile-first todo app with drag-and-drop' },
                ].map((p, i) => (
                  <button
                    key={i}
                    className="prompt-chip"
                    onClick={() => { setInput(p.text); setTimeout(() => { setInput(''); sendText(p.text) }, 0) }}
                    style={{
                      background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)',
                      borderRadius: 8, padding: '9px 12px', color: '#7c8db0',
                      fontSize: 12, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                      fontFamily: 'inherit', lineHeight: 1.4, display: 'flex', alignItems: 'flex-start', gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: -1 }}>{p.icon}</span>
                    <span>{p.text}</span>
                  </button>
                ))}
              </div>
            )}

            {/* ── HITL Approval card — shown after agent requests a decision ── */}
            {pendingApproval && !loading && (
              <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 10, padding: '14px 16px', marginTop: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>⏸ Decision Required</div>
                <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, marginBottom: 6 }}>{pendingApproval.question}</div>
                {pendingApproval.context && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>{pendingApproval.context}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(pendingApproval.options?.length > 0 ? pendingApproval.options : ['Approve', 'Reject']).map((opt, i) => (
                    <button key={i} onClick={() => {
                      setPendingApproval(null)
                      sendText(`Decision: ${opt}`)
                    }} style={{
                      background: i === 0 ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${i === 0 ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.15)'}`,
                      color: i === 0 ? '#a5b4fc' : '#94a3b8',
                      borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>{opt}</button>
                  ))}
                  <button onClick={() => setPendingApproval(null)} style={{
                    background: 'none', border: 'none', color: '#475569', fontSize: 11,
                    cursor: 'pointer', fontFamily: 'inherit', padding: '7px 8px',
                  }}>dismiss</button>
                </div>
              </div>
            )}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', border: '1.5px solid #0EA5E9', background: '#0c2040', flexShrink: 0 }}>
                  <img src={CTO_AVATAR} alt="CTO" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <style>{`@keyframes thinkDot{0%,80%,100%{transform:scale(0);opacity:0.3}40%{transform:scale(1);opacity:1}} @keyframes thinkPulse{0%,100%{opacity:0.5}50%{opacity:1}}`}</style>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {[0, 0.15, 0.3].map((d, i) => (
                      <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#a78bfa', animation: `thinkDot 1.2s ${d}s ease-in-out infinite` }} />
                    ))}
                    <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700, marginLeft: 2, animation: 'thinkPulse 2s ease-in-out infinite' }}>
                      {thinkingLabel}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {queued.length > 0 && (
              <div style={{ fontSize: 10, color: '#475569', textAlign: 'center' }}>{queued.length} message{queued.length > 1 ? 's' : ''} queued</div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px', borderTop: '1px solid #1e3a5f', background: '#0a1520', flexShrink: 0 }}>
            {/* Toolbar: quick mode + image attach */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
              <button onClick={() => setQuickMode(q => !q)} title="Quick mode: skip CTO, build directly" style={{
                padding: '3px 10px', borderRadius: 20, border: `1px solid ${quickMode ? '#6366f1' : '#1e3a5f'}`,
                background: quickMode ? 'rgba(99,102,241,0.18)' : 'transparent',
                color: quickMode ? '#a5b4fc' : '#475569', fontSize: 10, fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.03em',
              }}>⚡ {quickMode ? 'Quick ON' : 'Quick'}</button>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
              <button onClick={() => fileInputRef.current?.click()} title="Attach image" style={{
                padding: '3px 10px', borderRadius: 20, border: `1px solid ${pendingImage ? '#0EA5E9' : '#1e3a5f'}`,
                background: pendingImage ? 'rgba(14,165,233,0.15)' : 'transparent',
                color: pendingImage ? '#38bdf8' : '#475569', fontSize: 10, fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>📎 {pendingImage ? pendingImage.name.slice(0, 12) + (pendingImage.name.length > 12 ? '…' : '') : 'Image'}</button>
              {pendingImage && (
                <button onClick={() => setPendingImage(null)} style={{
                  padding: '3px 7px', borderRadius: 20, border: '1px solid #334155',
                  background: 'transparent', color: '#64748b', fontSize: 10, cursor: 'pointer',
                }}>✕</button>
              )}
            </div>
            {/* Image preview strip */}
            {pendingImage && (
              <div style={{ marginBottom: 7 }}>
                <img src={pendingImage.dataUrl} alt="preview" style={{ height: 60, borderRadius: 6, border: '1px solid #1e3a5f', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Ask anything — research, plan, build, schedule…"
                rows={2}
                disabled={loading}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 12,
                  border: `1px solid ${quickMode ? 'rgba(99,102,241,0.4)' : '#1e3a5f'}`, outline: 'none', fontSize: 13,
                  resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                  background: loading ? '#060e18' : '#071018', color: '#e2e8f0', transition: 'border-color 0.15s',
                  opacity: loading ? 0.5 : 1,
                }}
                onFocus={e => e.target.style.borderColor = '#6366f1'}
                onBlur={e => e.target.style.borderColor = quickMode ? 'rgba(99,102,241,0.4)' : '#1e3a5f'}
              />
              {loading ? (
                <button onClick={stopGeneration} title="Stop generation" style={{
                  flexShrink: 0, width: 68, height: 42, borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.12)', color: '#f87171',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.22)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.7)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)' }}
                >■ Stop</button>
              ) : (
                <button onClick={send} disabled={!input.trim() && !pendingImage} title="Send (Enter)" style={{
                  flexShrink: 0, width: 42, height: 42, borderRadius: 10, border: 'none',
                  background: (input.trim() || pendingImage) ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#1e293b',
                  color: (input.trim() || pendingImage) ? '#fff' : '#334155',
                  fontWeight: 700, fontSize: 18, cursor: (input.trim() || pendingImage) ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s',
                  boxShadow: (input.trim() || pendingImage) ? '0 2px 10px rgba(99,102,241,0.5)' : 'none',
                }}>↑</button>
              )}
            </div>
            <div style={{ fontSize: 9.5, color: '#334155', marginTop: 4, textAlign: 'right', paddingRight: 4 }}>⏎ send · Shift+⏎ newline</div>
          </div>
        </>
      )}
    </div>
  )
})

export default BuilderChat
