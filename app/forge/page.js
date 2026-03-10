'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

const RAILWAY_URL = 'https://svets-dream-production.up.railway.app'
const EXEC_TOKEN = 'svets-exec-token-2026'

const ALL_BLOCKS = [
  { id: 'next-shell',       label: 'Next.js Shell',     desc: 'package.json, layout, Tailwind',      icon: '⚡', required: true,  color: '#f59e0b' },
  { id: 'supabase',         label: 'Supabase',          desc: 'DB client, middleware',                icon: '🗄️', color: '#3ecf8e' },
  { id: 'auth-email',       label: 'Email Auth',        desc: 'Login, signup, logout',               icon: '🔐', color: '#6366f1' },
  { id: 'auth-google',      label: 'Google OAuth',      desc: 'One-click Google/GitHub SSO',          icon: '🔑', color: '#4285f4' },
  { id: 'dashboard-layout', label: 'Dashboard',         desc: 'Smart sidebar nav, auth guard',        icon: '🧭', color: '#8b5cf6' },
  { id: 'crud-table',       label: 'CRUD Tables',       desc: 'DataTable per entity (smart)',         icon: '📋', color: '#0ea5e9' },
  { id: 'crud-api',         label: 'CRUD APIs',         desc: 'REST routes per entity (smart)',       icon: '🔌', color: '#06b6d4' },
  { id: 'charts',           label: 'Charts & Stats',    desc: 'StatsCards + Line/Bar charts',         icon: '📊', color: '#f59e0b' },
  { id: 'kanban',           label: 'Kanban Board',      desc: 'Drag-drop board, smart columns',       icon: '🗂️', color: '#ec4899' },
  { id: 'notifications',    label: 'Notifications',     desc: 'Toast alerts + notification bell',     icon: '🔔', color: '#f97316' },
  { id: 'settings-page',    label: 'Settings',          desc: 'Profile, password, notif prefs',       icon: '⚙️', color: '#94a3b8' },
  { id: 'ai-chat',          label: 'AI Chat',           desc: 'Streaming Claude assistant (smart)',   icon: '🤖', color: '#a78bfa' },
  { id: 'landing',          label: 'Landing Page',      desc: 'Hero + CTA, AI-written copy',          icon: '🏠', color: '#22d3ee' },
  { id: 'stripe',           label: 'Stripe',            desc: 'Payment intent + webhook',             icon: '💳', color: '#635bff' },
  { id: 'email-resend',     label: 'Email',             desc: 'Transactional via Resend',             icon: '✉️', color: '#fb923c' },
  { id: 'file-upload',      label: 'File Upload',       desc: 'Supabase Storage',                     icon: '📎', color: '#84cc16' },
  { id: 'cron',             label: 'Cron Jobs',         desc: 'Scheduled jobs + Railway runner',      icon: '⏰', color: '#64748b' },
]

const SMART_DEFAULTS = ['next-shell', 'supabase', 'auth-email', 'dashboard-layout', 'crud-table', 'crud-api']

export default function ForgePage() {
  const [description, setDescription] = useState('')
  const [appName, setAppName] = useState('')
  const [selected, setSelected] = useState(new Set(SMART_DEFAULTS))
  const [phase, setPhase] = useState('config') // config | building | done
  const [events, setEvents] = useState([])
  const [blockStatus, setBlockStatus] = useState({}) // id → 'pending'|'building'|'done'
  const [files, setFiles] = useState([]) // [{path, preview}]
  const [installLog, setInstallLog] = useState([])
  const [result, setResult] = useState(null)
  const [config, setConfig] = useState(null)
  const [preview, setPreview] = useState(null) // { url, loading, error }
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)
  const abortRef = useRef(null)
  const filesRef = useRef(null)
  const installRef = useRef(null)
  const wsId = useRef(`forge-${Date.now()}-${Math.random().toString(36).slice(2,6)}`)

  useEffect(() => { filesRef.current?.scrollTo(0, 999999) }, [files])
  useEffect(() => { installRef.current?.scrollTo(0, 999999) }, [installLog])

  function toggleBlock(id) {
    if (id === 'next-shell') return
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function selectPreset(ids) { setSelected(new Set(['next-shell', ...ids])) }

  async function handleBuild(e) {
    e.preventDefault()
    if (!description.trim()) return
    setPhase('building')
    setEvents([])
    setBlockStatus({})
    setFiles([])
    setInstallLog([])
    setResult(null)
    setConfig(null)

    // Init all selected blocks as pending
    const pending = {}
    for (const id of selected) pending[id] = 'pending'
    setBlockStatus(pending)

    abortRef.current = new AbortController()

    try {
      const res = await fetch(`${RAILWAY_URL}/forge/assemble`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EXEC_TOKEN}` },
        signal: abortRef.current.signal,
        body: JSON.stringify({ description, appName: appName || 'my-app', blocks: [...selected], workspaceId: wsId.current }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const ev = JSON.parse(line)
            handleEvent(ev)
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setEvents(prev => [...prev, { type: 'error', message: err.message }])
      }
    }
  }

  function handleEvent(ev) {
    setEvents(prev => [...prev, ev])
    if (ev.type === 'analyze_done') {
      setConfig(ev.config)
    }
    if (ev.type === 'block_start') {
      setBlockStatus(prev => ({ ...prev, [ev.id]: 'building' }))
    }
    if (ev.type === 'block_done') {
      setBlockStatus(prev => ({ ...prev, [ev.id]: 'done' }))
    }
    if (ev.type === 'file_write') {
      setFiles(prev => [...prev, { path: ev.path, preview: ev.preview }])
    }
    if (ev.type === 'install_line' && ev.text) {
      setInstallLog(prev => [...prev, ev.text])
    }
    if (ev.type === 'complete') {
      setResult(ev)
      setPhase('done')
    }
  }

  async function handlePreview() {
    if (!result) return
    setPreview({ loading: true, url: null, error: null })
    try {
      const res = await fetch(`${RAILWAY_URL}/forge/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EXEC_TOKEN}` },
        body: JSON.stringify({ workspaceId: wsId.current, appPath: result.appPath }),
      })
      const data = await res.json()
      if (data.ok) {
        setPreview({ loading: false, url: `${RAILWAY_URL}${data.proxyUrl}`, error: null })
      } else {
        setPreview({ loading: false, url: null, error: data.error || 'Preview failed' })
      }
    } catch (err) {
      setPreview({ loading: false, url: null, error: err.message })
    }
  }

  async function handleDeploy() {
    if (!result) return
    setDeploying(true)
    setDeployResult(null)
    try {
      const res = await fetch(`${RAILWAY_URL}/forge/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EXEC_TOKEN}` },
        body: JSON.stringify({
          workspaceId: wsId.current,
          appName: result.appName,
          appPath: result.appPath,
          config,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setDeployResult({ ok: true, url: data.deployedUrl, tenantId: data.tenantId, repoUrl: data.repoUrl })
    } catch (err) {
      setDeployResult({ ok: false, output: err.message, url: null })
    } finally {
      setDeploying(false)
    }
  }

  const totalFiles = files.length
  const doneBlocks = Object.values(blockStatus).filter(s => s === 'done').length
  const totalBlocks = selected.size
  const progress = phase === 'done' ? 100 : Math.round((doneBlocks / totalBlocks) * 85)

  return (
    <div style={{ minHeight: '100vh', background: '#050d1a', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #0f172a', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <a href="/" style={{ color: '#475569', textDecoration: 'none', fontSize: 12 }}>← Dashboard</a>
        <span style={{ color: '#1e293b' }}>|</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#f59e0b', letterSpacing: '-0.3px' }}>⚒ Forge</span>
        <span style={{ fontSize: 11, color: '#334155' }}>Rapid app scaffolding with smart blocks</span>
        <a href="/forge/my-apps" style={{ marginLeft: 8, fontSize: 11, color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>📱 My Apps</a>
        {phase === 'building' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 140, height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#6366f1,#f59e0b)', borderRadius: 2, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>{doneBlocks}/{totalBlocks} blocks</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* ── Left config panel ─────────────────────────────────────────── */}
        <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #0f172a', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <form onSubmit={handleBuild} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>App Name</label>
              <input value={appName} onChange={e => setAppName(e.target.value)} placeholder="hotel-booking" disabled={phase === 'building'} style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="A hotel booking platform where guests can browse rooms, make reservations, check in and out, and managers can track occupancy and revenue…" required disabled={phase === 'building'} rows={5} style={{ ...inputStyle, resize: 'vertical' }} />
              <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>The more detail, the smarter the blocks configure themselves.</div>
            </div>

            {/* Presets */}
            <div>
              <label style={labelStyle}>Quick presets</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {[
                  { label: 'SaaS', ids: ['supabase','auth-email','auth-google','dashboard-layout','crud-table','crud-api','charts','notifications','ai-chat','stripe'] },
                  { label: 'Landing', ids: ['landing','auth-email'] },
                  { label: 'Full Stack', ids: ['supabase','auth-email','auth-google','dashboard-layout','crud-table','crud-api','charts','notifications','kanban','settings-page','ai-chat','landing','stripe','email-resend','cron'] },
                  { label: 'API only', ids: ['supabase','crud-api'] },
                  { label: 'Kanban App', ids: ['supabase','auth-email','dashboard-layout','kanban','notifications','settings-page'] },
                ].map(p => (
                  <button key={p.label} type="button" onClick={() => selectPreset(p.ids)} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid #1e293b', background: '#0f172a', color: '#64748b', cursor: 'pointer' }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Block selector */}
            <div>
              <label style={labelStyle}>Blocks ({selected.size} selected)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                {ALL_BLOCKS.map(b => {
                  const on = selected.has(b.id)
                  return (
                    <div key={b.id} onClick={() => toggleBlock(b.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: b.required ? 'default' : 'pointer', background: on ? '#0a1628' : 'transparent', border: `1px solid ${on ? b.color + '30' : 'transparent'}`, transition: 'all 0.15s' }}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, background: on ? b.color : '#1e293b', border: `1px solid ${on ? b.color : '#334155'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {on && <span style={{ color: '#000', fontSize: 9, fontWeight: 800 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 11 }}>{b.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: on ? '#e2e8f0' : '#64748b' }}>{b.label}</div>
                        <div style={{ fontSize: 9, color: '#334155', marginTop: 1 }}>{b.desc}</div>
                      </div>
                      {b.required && <span style={{ fontSize: 8, color: '#334155', fontStyle: 'italic', flexShrink: 0 }}>req</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            <button type="submit" disabled={phase === 'building' || !description.trim()} style={{ padding: '10px', borderRadius: 8, border: 'none', cursor: phase === 'building' ? 'default' : 'pointer', background: phase === 'building' ? '#1e293b' : 'linear-gradient(135deg,#f59e0b,#6366f1)', color: '#fff', fontSize: 13, fontWeight: 800, letterSpacing: '-0.2px' }}>
              {phase === 'building' ? '⟳ Building…' : '⚒ Build App'}
            </button>
            {phase === 'building' && <button type="button" onClick={() => abortRef.current?.abort()} style={{ padding: '6px', borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: 11, cursor: 'pointer' }}>Stop</button>}
          </form>
        </div>

        {/* ── Right live build panel ─────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {phase === 'config' ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: '#1e293b' }}>
              <div style={{ fontSize: 64 }}>⚒</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#334155' }}>Describe your app to begin</div>
              <div style={{ fontSize: 13, color: '#1e293b', maxWidth: 400, textAlign: 'center', lineHeight: 1.7 }}>
                Haiku analyzes your description in ~2 seconds, then smart blocks assemble themselves — entities, routes, nav items, AI prompts — all customized for your specific app.
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'grid', gridTemplateRows: 'auto 1fr auto', gridTemplateColumns: '1fr 1fr', gap: 0, overflow: 'hidden' }}>

              {/* Block assembly grid — top left */}
              <div style={{ gridRow: '1 / 2', gridColumn: '1 / 2', padding: 14, borderBottom: '1px solid #0f172a', borderRight: '1px solid #0f172a' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  {config ? `⚡ ${config.appName} — ${config.entities?.length || 0} entities, ${config.navItems?.length || 0} routes` : '⟳ Analyzing description…'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ALL_BLOCKS.filter(b => selected.has(b.id)).map(b => {
                    const status = blockStatus[b.id] || 'pending'
                    return (
                      <div key={b.id} style={{
                        padding: '6px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6,
                        border: `1px solid ${status === 'done' ? b.color + '60' : status === 'building' ? b.color + '90' : '#1e293b'}`,
                        background: status === 'done' ? b.color + '18' : status === 'building' ? b.color + '25' : '#0a1220',
                        transition: 'all 0.3s ease',
                        boxShadow: status === 'building' ? `0 0 12px ${b.color}40` : 'none',
                      }}>
                        <span style={{ fontSize: 13 }}>{b.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: status === 'pending' ? '#334155' : '#e2e8f0' }}>{b.label}</span>
                        {status === 'building' && <span style={{ fontSize: 9, color: b.color, animation: 'pulse 1s infinite' }}>●</span>}
                        {status === 'done' && <span style={{ fontSize: 10, color: b.color }}>✓</span>}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Config preview — top right */}
              <div style={{ gridRow: '1 / 2', gridColumn: '2 / 3', padding: 14, borderBottom: '1px solid #0f172a', overflow: 'auto' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Smart Config</div>
                {config ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {config.entities?.map(e => (
                      <div key={e.name} style={{ fontSize: 10, color: '#64748b' }}>
                        <span style={{ color: '#a78bfa', fontWeight: 700 }}>{e.label}</span>
                        <span style={{ color: '#334155' }}> → [{e.fields?.join(', ')}]</span>
                      </div>
                    ))}
                    {config.navItems?.map(n => (
                      <div key={n.href} style={{ fontSize: 10, color: '#64748b' }}>
                        <span style={{ color: '#22d3ee' }}>{n.label}</span>
                        <span style={{ color: '#334155' }}> → {n.href}</span>
                      </div>
                    ))}
                    {config.headline && <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}><span style={{ color: '#f59e0b' }}>headline</span> "{config.headline}"</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: '#1e293b' }}>Waiting for Haiku analysis…</div>
                )}
              </div>

              {/* File tree — bottom left */}
              <div ref={filesRef} style={{ gridRow: '2 / 3', gridColumn: '1 / 2', borderRight: '1px solid #0f172a', padding: '10px 14px', overflowY: 'auto', fontFamily: 'monospace', scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Files Written ({totalFiles})</div>
                {files.map((f, i) => (
                  <div key={i} style={{ marginBottom: 6, animation: 'fadeIn 0.2s ease' }}>
                    <div style={{ fontSize: 10, color: '#4ade80', fontWeight: 600 }}>+ {f.path}</div>
                    <div style={{ fontSize: 9, color: '#334155', marginLeft: 10, lineHeight: 1.4, whiteSpace: 'pre', overflow: 'hidden', maxHeight: 30 }}>
                      {f.preview?.slice(0, 100)}
                    </div>
                  </div>
                ))}
                {files.length === 0 && <div style={{ fontSize: 10, color: '#1e293b' }}>Files appear here as blocks assemble…</div>}
              </div>

              {/* Install log — bottom right */}
              <div ref={installRef} style={{ gridRow: '2 / 3', gridColumn: '2 / 3', padding: '10px 14px', overflowY: 'auto', fontFamily: 'monospace', scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>npm install</div>
                {installLog.map((line, i) => (
                  <div key={i} style={{ fontSize: 10, color: '#475569', lineHeight: 1.5 }}>{line}</div>
                ))}
                {installLog.length === 0 && <div style={{ fontSize: 10, color: '#1e293b' }}>Install log appears after blocks are assembled…</div>}
              </div>

              {/* Done banner */}
              {phase === 'done' && result && (
                <div style={{ gridRow: '3 / 4', gridColumn: '1 / 3', borderTop: '1px solid #166534', background: '#050d1a' }}>
                  {/* Preview iframe */}
                  {preview?.url && (
                    <div style={{ borderBottom: '1px solid #0f172a', background: '#0a1220' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: '1px solid #0f172a' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
                        <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>{preview.url}</span>
                        <button onClick={() => setPreview(null)} style={{ marginLeft: 'auto', fontSize: 10, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                      </div>
                      <iframe src={preview.url} style={{ width: '100%', height: 340, border: 'none', background: '#fff' }} title="App Preview" />
                    </div>
                  )}
                  {preview?.error && (
                    <div style={{ padding: '8px 16px', background: '#1a0a0a', borderBottom: '1px solid #450a0a' }}>
                      <span style={{ fontSize: 11, color: '#f87171' }}>Preview error: {preview.error}</span>
                    </div>
                  )}
                  {deployResult && (
                    <div style={{ padding: '10px 16px', background: deployResult.ok ? '#0a1e12' : '#1a0a0a', borderBottom: `1px solid ${deployResult.ok ? '#166534' : '#450a0a'}`, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      {deployResult.ok ? (
                        <>
                          <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>✓ Registered as managed app</span>
                          <span style={{ fontSize: 11, color: '#475569' }}>Tenant: {deployResult.tenantId}</span>
                          {deployResult.repoUrl && <a href={deployResult.repoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#475569' }}>📦 Private repo</a>}
                          <a href="/forge/my-apps" style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
                            View in My Apps →
                          </a>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: '#f87171' }}>Deploy error: {deployResult.output?.slice(0, 200)}</span>
                      )}
                    </div>
                  )}
                  <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#4ade80' }}>✓ {result.appName} scaffolded — {totalFiles} files written</div>
                      <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>Path: {result.appPath}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {!preview?.url && (
                        <button onClick={handlePreview} disabled={preview?.loading} style={{ padding: '7px 14px', borderRadius: 7, background: '#0f172a', color: preview?.loading ? '#475569' : '#22d3ee', fontSize: 12, fontWeight: 700, cursor: preview?.loading ? 'default' : 'pointer', border: '1px solid #164e63' }}>
                          {preview?.loading ? '⟳ Starting…' : '▶ Preview'}
                        </button>
                      )}
                      <button onClick={handleDeploy} disabled={deploying} style={{ padding: '7px 14px', borderRadius: 7, background: deploying ? '#1e293b' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: deploying ? 'default' : 'pointer', border: 'none' }}>
                        {deploying ? '⟳ Deploying…' : '🚀 Deploy to Vercel'}
                      </button>
                      <a href={`/?ws=${wsId.current}`} style={{ padding: '7px 14px', borderRadius: 7, background: '#0a1628', color: '#818cf8', fontSize: 12, fontWeight: 700, textDecoration: 'none', border: '1px solid #312e81', display: 'flex', alignItems: 'center' }}>
                        💬 Fine-tune with Claude
                      </a>
                      <a href={`/?ws=${wsId.current}&prompt=Run next dev in ${result.relPath}, take a screenshot of http://localhost:3000, then send it to Gemini for UI analysis and improvement suggestions`} style={{ padding: '7px 14px', borderRadius: 7, background: '#1e293b', color: '#a78bfa', fontSize: 12, fontWeight: 700, textDecoration: 'none', border: '1px solid #334155', display: 'flex', alignItems: 'center' }}>
                        👁 Gemini UI Review
                      </a>
                      <button onClick={() => { setPhase('config'); setEvents([]); setFiles([]); setInstallLog([]); setBlockStatus({}); setConfig(null); setResult(null); setPreview(null); setDeployResult(null) }} style={{ padding: '7px 14px', borderRadius: 7, background: '#0f172a', color: '#475569', fontSize: 12, cursor: 'pointer', border: '1px solid #1e293b' }}>
                        New app
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }
const inputStyle = { width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 7, padding: '7px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none', display: 'block' }
