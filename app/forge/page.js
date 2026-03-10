'use client'
import { useState, useRef, useEffect } from 'react'

const RAILWAY_URL = 'https://svets-dream-production.up.railway.app'
const EXEC_TOKEN = 'svets-exec-token-2026'

const BLOCKS = [
  { id: 'next-shell',       label: 'Next.js Shell',       desc: 'package.json, layout, Tailwind', icon: '⚡', required: true },
  { id: 'supabase',         label: 'Supabase',            desc: 'DB client, middleware',          icon: '🗄️' },
  { id: 'auth-email',       label: 'Auth',                desc: 'Login, signup, logout',          icon: '🔐' },
  { id: 'dashboard-layout', label: 'Dashboard Layout',   desc: 'Sidebar nav, header',            icon: '🧭' },
  { id: 'crud-table',       label: 'CRUD Table',         desc: 'DataTable + modals',             icon: '📋' },
  { id: 'crud-api',         label: 'CRUD API',           desc: 'REST route template',            icon: '🔌' },
  { id: 'ai-chat',          label: 'AI Chat',            desc: 'Streaming Claude chat',          icon: '🤖' },
  { id: 'landing',          label: 'Landing Page',       desc: 'Hero + features + CTA',          icon: '🏠' },
  { id: 'stripe',           label: 'Stripe Payments',    desc: 'Payment intent + webhook',       icon: '💳' },
  { id: 'file-upload',      label: 'File Upload',        desc: 'Supabase Storage',               icon: '📎' },
  { id: 'email-resend',     label: 'Email (Resend)',     desc: 'Transactional email',            icon: '✉️' },
]

const STACKS = [
  { id: 'nextjs-supabase', label: 'Next.js + Supabase', desc: 'App Router, Tailwind, Supabase Postgres' },
  { id: 'nextjs-sqlite',   label: 'Next.js + SQLite',   desc: 'App Router, Tailwind, lightweight SQLite' },
  { id: 'react-express',   label: 'React + Express',    desc: 'Vite, Tailwind, Express REST API' },
]

export default function ForgePage() {
  const [description, setDescription] = useState('')
  const [appName, setAppName] = useState('')
  const [stack, setStack] = useState('nextjs-supabase')
  const [selectedBlocks, setSelectedBlocks] = useState(new Set(['next-shell', 'supabase', 'auth-email', 'dashboard-layout']))
  const [tab, setTab] = useState('build') // build | gemini
  const [building, setBuilding] = useState(false)
  const [output, setOutput] = useState('')
  const [done, setDone] = useState(false)
  const [workspaceId, setWorkspaceId] = useState('')
  const abortRef = useRef(null)
  const outputRef = useRef(null)

  // Gemini UI tab state
  const [screenshotUrl, setScreenshotUrl] = useState('')
  const [geminiTask, setGeminiTask] = useState('analyze')
  const [geminiContext, setGeminiContext] = useState('')
  const [geminiLoading, setGeminiLoading] = useState(false)
  const [geminiResult, setGeminiResult] = useState('')

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  function toggleBlock(id) {
    if (id === 'next-shell') return // required
    setSelectedBlocks(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleBuild(e) {
    e.preventDefault()
    if (!description.trim() || building) return
    setBuilding(true)
    setOutput('')
    setDone(false)

    const wsId = `forge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setWorkspaceId(wsId)
    abortRef.current = new AbortController()

    const blocksStr = [...selectedBlocks].join(', ')
    const prompt = `Scaffold a complete ${stack} app called "${appName || 'my-app'}" using these blocks: ${blocksStr}.

App description: ${description}

Instructions:
1. Read /root/workspace/__BLOCKS__/manifest.json to understand available blocks
2. Create the app at /root/workspace/${wsId}/${appName || 'my-app'}/
3. Copy and assemble the selected block files — replace all {{APP_NAME}}, {{APP_DESCRIPTION}}, {{HEADLINE}}, {{SUBHEADLINE}}, {{APP_TAGLINE}} placeholders
4. Customize the code to match the app description (rename tables, update nav items, adjust colors, write the actual page content)
5. Create .env.local from the env-template block
6. Run: cd /root/workspace/${wsId}/${appName || 'my-app'} && npm install 2>&1 | tail -5
7. Report the final file tree and any next steps

Be thorough but fast. Use blocks as starting points — customize them for this specific app.`

    try {
      const res = await fetch(`${RAILWAY_URL}/agent-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EXEC_TOKEN}` },
        signal: abortRef.current.signal,
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], workspaceId: wsId }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done: d, value } = await reader.read()
        if (d) break
        setOutput(prev => prev + decoder.decode(value, { stream: true }))
      }
      setDone(true)
    } catch (err) {
      if (err.name !== 'AbortError') setOutput(prev => prev + `\n\nError: ${err.message}`)
    } finally {
      setBuilding(false)
    }
  }

  async function handleGeminiUI(e) {
    e.preventDefault()
    if (!screenshotUrl.trim() || geminiLoading) return
    setGeminiLoading(true)
    setGeminiResult('')

    try {
      // Fetch screenshot and convert to base64
      const imgRes = await fetch(screenshotUrl)
      const blob = await imgRes.blob()
      const base64 = await new Promise(resolve => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result.split(',')[1])
        reader.readAsDataURL(blob)
      })

      const res = await fetch(`${RAILWAY_URL}/gemini-ui`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EXEC_TOKEN}` },
        body: JSON.stringify({ screenshotBase64: base64, task: geminiTask, context: geminiContext }),
      })
      const data = await res.json()
      setGeminiResult(data.text || data.error || 'No response')
    } catch (err) {
      setGeminiResult(`Error: ${err.message}`)
    } finally {
      setGeminiLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050d1a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #0f172a', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href="/" style={{ color: '#475569', textDecoration: 'none', fontSize: 13 }}>← Back</a>
        <span style={{ color: '#1e293b' }}>|</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>⚒ Forge</span>
        <span style={{ fontSize: 12, color: '#475569', marginLeft: 4 }}>Rapid app scaffolding</span>

        {/* Tabs */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, background: '#0f172a', borderRadius: 8, padding: 4 }}>
          {[{ id: 'build', label: '⚒ Build' }, { id: 'gemini', label: '👁 Gemini UI' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: tab === t.id ? '#6366f1' : 'transparent',
              color: tab === t.id ? '#fff' : '#475569',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
        {tab === 'build' && (
          <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>
            {/* Left panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <form onSubmit={handleBuild} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>App Name</label>
                  <input
                    value={appName} onChange={e => setAppName(e.target.value)}
                    placeholder="my-saas-app"
                    style={{ width: '100%', marginTop: 6, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</label>
                  <textarea
                    value={description} onChange={e => setDescription(e.target.value)}
                    placeholder="A hotel booking platform where guests can browse rooms, make reservations, and managers can see occupancy..."
                    required
                    rows={5}
                    style={{ width: '100%', marginTop: 6, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stack</label>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {STACKS.map(s => (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: stack === s.id ? '#1e1b4b' : '#0f172a', border: `1px solid ${stack === s.id ? '#6366f1' : '#1e293b'}` }}>
                        <input type="radio" name="stack" value={s.id} checked={stack === s.id} onChange={() => setStack(s.id)} style={{ marginTop: 2 }} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: stack === s.id ? '#a78bfa' : '#94a3b8' }}>{s.label}</div>
                          <div style={{ fontSize: 10, color: '#475569' }}>{s.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Blocks ({selectedBlocks.size} selected)</label>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {BLOCKS.map(b => {
                      const selected = selectedBlocks.has(b.id)
                      return (
                        <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: b.required ? 'default' : 'pointer', background: selected ? '#0f1c30' : 'transparent', border: `1px solid ${selected ? '#334155' : 'transparent'}` }}
                          onClick={() => toggleBlock(b.id)}>
                          <div style={{ width: 16, height: 16, borderRadius: 4, background: selected ? '#6366f1' : '#1e293b', border: `1px solid ${selected ? '#6366f1' : '#334155'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {selected && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 11 }}>{b.icon}</span>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: selected ? '#e2e8f0' : '#64748b' }}>{b.label}</span>
                            <span style={{ fontSize: 10, color: '#334155', marginLeft: 6 }}>{b.desc}</span>
                          </div>
                          {b.required && <span style={{ fontSize: 9, color: '#475569', fontStyle: 'italic' }}>required</span>}
                        </label>
                      )
                    })}
                  </div>
                </div>

                <button type="submit" disabled={building || !description.trim()} style={{
                  padding: '10px 20px', borderRadius: 8, border: 'none', cursor: building ? 'default' : 'pointer',
                  background: building ? '#1e293b' : '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  {building ? (
                    <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Scaffolding…</>
                  ) : '⚒ Scaffold App'}
                </button>

                {building && (
                  <button type="button" onClick={() => abortRef.current?.abort()} style={{ padding: '6px', borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: 11, cursor: 'pointer' }}>
                    Stop
                  </button>
                )}
              </form>
            </div>

            {/* Right panel — output */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Output stream */}
              <div style={{ background: '#020817', border: '1px solid #0f172a', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '8px 14px', borderBottom: '1px solid #0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>BUILD OUTPUT</span>
                  {building && <span style={{ fontSize: 10, color: '#6366f1' }}>● live</span>}
                  {done && <span style={{ fontSize: 10, color: '#22c55e' }}>✓ done</span>}
                </div>
                <pre ref={outputRef} style={{
                  margin: 0, padding: '14px', minHeight: 480, maxHeight: '60vh', overflowY: 'auto',
                  fontSize: 12, lineHeight: 1.6, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent',
                }}>
                  {output || (building ? '' : 'Scaffold output will appear here…\n\nDescribe your app, select blocks, and click "Scaffold App".\nThe agent will read the block library and assemble your project.')}
                </pre>
              </div>

              {/* Post-build actions */}
              {done && workspaceId && (
                <div style={{ background: '#0a1628', border: '1px solid #166534', borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>✓ Scaffold complete</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a href={`/?ws=${workspaceId}`} style={{ padding: '6px 14px', borderRadius: 6, background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                      💬 Fine-tune with Claude
                    </a>
                    <button onClick={() => {
                      const appPath = `/root/workspace/${workspaceId}/${appName || 'my-app'}`
                      navigator.clipboard.writeText(appPath)
                    }} style={{ padding: '6px 14px', borderRadius: 6, background: '#1e293b', color: '#94a3b8', fontSize: 12, cursor: 'pointer', border: '1px solid #334155' }}>
                      📋 Copy path
                    </button>
                    <button onClick={() => setTab('gemini')} style={{ padding: '6px 14px', borderRadius: 6, background: '#1e293b', color: '#94a3b8', fontSize: 12, cursor: 'pointer', border: '1px solid #334155' }}>
                      👁 Gemini UI review
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'gemini' && (
          <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20, alignItems: 'start' }}>
            {/* Gemini form */}
            <form onSubmit={handleGeminiUI} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', marginBottom: 4 }}>👁 Gemini UI Analysis</div>
                <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
                  Paste a public screenshot URL. Gemini Vision will analyze the UI, suggest improvements, or generate redesigned code.
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Screenshot URL</label>
                <input
                  value={screenshotUrl} onChange={e => setScreenshotUrl(e.target.value)}
                  placeholder="https://... (public image URL)"
                  required
                  style={{ width: '100%', marginTop: 6, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>Use 0x0.st, imgbb, or any public URL. Or take a screenshot via the agent first.</div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Task</label>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    { id: 'analyze', label: '🔍 Analyze', desc: 'UX feedback and specific improvement suggestions' },
                    { id: 'redesign', label: '🎨 Redesign', desc: 'Returns complete HTML+Tailwind redesign' },
                    { id: 'code', label: '⚛️ To React', desc: 'Converts screenshot to React component code' },
                  ].map(t => (
                    <label key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: geminiTask === t.id ? '#1e1b4b' : '#0f172a', border: `1px solid ${geminiTask === t.id ? '#6366f1' : '#1e293b'}` }}>
                      <input type="radio" value={t.id} checked={geminiTask === t.id} onChange={() => setGeminiTask(t.id)} style={{ marginTop: 2 }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: geminiTask === t.id ? '#a78bfa' : '#94a3b8' }}>{t.label}</div>
                        <div style={{ fontSize: 10, color: '#475569' }}>{t.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Extra context (optional)</label>
                <textarea
                  value={geminiContext} onChange={e => setGeminiContext(e.target.value)}
                  placeholder="e.g. This is a hotel booking platform targeting luxury guests. Make it feel premium."
                  rows={3}
                  style={{ width: '100%', marginTop: 6, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>

              <button type="submit" disabled={geminiLoading || !screenshotUrl.trim()} style={{
                padding: '10px 20px', borderRadius: 8, border: 'none', cursor: geminiLoading ? 'default' : 'pointer',
                background: geminiLoading ? '#1e293b' : '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700,
              }}>
                {geminiLoading ? '⟳ Analyzing…' : '👁 Analyze with Gemini'}
              </button>
            </form>

            {/* Gemini result */}
            <div style={{ background: '#020817', border: '1px solid #0f172a', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>GEMINI RESPONSE</span>
                {geminiLoading && <span style={{ fontSize: 10, color: '#6366f1' }}>● processing</span>}
              </div>
              <pre style={{
                margin: 0, padding: '14px', minHeight: 480, maxHeight: '70vh', overflowY: 'auto',
                fontSize: 12, lineHeight: 1.7, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent',
              }}>
                {geminiResult || 'Gemini\'s analysis will appear here.\n\nPaste a screenshot URL and choose a task.'}
              </pre>
              {geminiResult && (
                <div style={{ borderTop: '1px solid #0f172a', padding: '8px 14px' }}>
                  <button onClick={() => navigator.clipboard.writeText(geminiResult)} style={{ padding: '4px 10px', borderRadius: 6, background: '#1e293b', color: '#64748b', fontSize: 11, border: 'none', cursor: 'pointer' }}>
                    Copy result
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
