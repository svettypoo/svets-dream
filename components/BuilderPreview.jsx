'use client'
import { useState, useEffect, useRef } from 'react'

export default function BuilderPreview({ visible }) {
  const [tab, setTab] = useState('terminal')
  const [entries, setEntries] = useState([])
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewHtml, setPreviewHtml] = useState(null)
  const [urlInput, setUrlInput] = useState('http://localhost:3000')
  const bottomRef = useRef(null)
  const entryIdRef = useRef(0)

  useEffect(() => {
    function onBuild(e) {
      const { type, data } = e.detail || {}
      if (!type) return
      setEntries(prev => {
        const entry = { id: entryIdRef.current++, type, data, ts: Date.now() }
        return [...prev, entry].slice(-300)
      })
      if (type === 'url') {
        setPreviewUrl(data.url)
        setUrlInput(data.url)
        setTab('preview')
      }
      if (type === 'html' && data?.html) {
        setPreviewHtml(data.html)
        setTab('preview')
      }
    }
    window.addEventListener('builderUpdate', onBuild)
    return () => window.removeEventListener('builderUpdate', onBuild)
  }, [])

  useEffect(() => {
    if (tab === 'terminal') bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries, tab])

  if (!visible) return null

  const files = entries.filter(e => e.type === 'file')

  return (
    <div style={{
      width: 460,
      flexShrink: 0,
      background: '#060d1b',
      borderLeft: '1px solid #1e3a5f',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      animation: 'slideInPreview 0.35s cubic-bezier(0.16,1,0.3,1)',
    }}>
      <style>{`
        @keyframes slideInPreview {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #1e3a5f',
        background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%', background: '#4ade80',
          boxShadow: '0 0 7px #4ade80', animation: 'blink 2s ease-in-out infinite',
        }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#475569', textTransform: 'uppercase' }}>
          Build Preview
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {['terminal', 'files', 'preview'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
              background: tab === t ? '#6366f1' : 'transparent',
              color: tab === t ? '#fff' : '#475569',
            }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal tab */}
      {tab === 'terminal' && (
        <div style={{
          flex: 1, overflowY: 'auto', padding: '10px 14px',
          fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
          fontSize: 11.5, scrollbarWidth: 'none', display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <style>{`div::-webkit-scrollbar{display:none}`}</style>
          {entries.length === 0 && (
            <div style={{ color: '#334155', marginTop: 32, textAlign: 'center', fontSize: 12, lineHeight: 1.7 }}>
              <div style={{ fontSize: 20, opacity: 0.3, marginBottom: 8 }}>⬡</div>
              Waiting for agent to start building...
            </div>
          )}
          {entries.map(e => {
            if (e.type === 'command') return (
              <div key={e.id} style={{ color: '#a78bfa', lineHeight: 1.4 }}>
                <span style={{ color: '#334155' }}>$ </span>
                <span style={{ color: '#e2e8f0' }}>{e.data.command}</span>
              </div>
            )
            if (e.type === 'output') return (
              <div key={e.id} style={{
                background: '#040b14', border: '1px solid #0f2030', borderRadius: 6,
                padding: '8px 10px', lineHeight: 1.55, marginBottom: 4,
                borderLeft: `3px solid ${e.data.exitCode === 0 ? '#22c55e' : '#ef4444'}`,
              }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: e.data.exitCode === 0 ? '#94a3b8' : '#fca5a5', maxHeight: 280, overflowY: 'auto' }}>
                  {e.data.output || '(no output)'}
                </pre>
                <div style={{ marginTop: 4, fontSize: 10, color: e.data.exitCode === 0 ? '#4ade80' : '#f87171' }}>
                  ✓ exit {e.data.exitCode}
                </div>
              </div>
            )
            if (e.type === 'info') return (
              <div key={e.id} style={{ color: '#60a5fa', fontSize: 11 }}>ℹ {e.data.text}</div>
            )
            if (e.type === 'error') return (
              <div key={e.id} style={{ color: '#f87171', fontSize: 11 }}>✗ {e.data.text}</div>
            )
            if (e.type === 'url') return (
              <div key={e.id} style={{ color: '#34d399', fontSize: 11 }}>
                🌐 Server detected: <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => { setPreviewUrl(e.data.url); setTab('preview') }}>{e.data.url}</span>
              </div>
            )
            if (e.type === 'file') return (
              <div key={e.id} style={{ color: '#fbbf24', fontSize: 11 }}>
                📄 {e.data.path}
              </div>
            )
            return null
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Files tab */}
      {tab === 'files' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', scrollbarWidth: 'none' }}>
          {files.length === 0 ? (
            <div style={{ color: '#334155', marginTop: 32, textAlign: 'center', fontSize: 12, lineHeight: 1.7 }}>
              <div style={{ fontSize: 20, opacity: 0.3, marginBottom: 8 }}>📂</div>
              No files created yet
            </div>
          ) : (
            files.map(e => (
              <div key={e.id} style={{ marginBottom: 14 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 11, color: '#fbbf24',
                  fontFamily: '"Cascadia Code", monospace',
                  background: 'rgba(251,191,36,0.08)', padding: '3px 9px', borderRadius: 5, marginBottom: 6,
                }}>
                  📄 {e.data.path}
                </div>
                {e.data.content && (
                  <pre style={{
                    margin: 0, background: '#040b14', border: '1px solid #0f2030',
                    borderRadius: 6, padding: '8px 10px', color: '#94a3b8',
                    fontSize: 11, lineHeight: 1.5, overflowX: 'auto',
                    maxHeight: 220, overflowY: 'auto',
                    fontFamily: '"Cascadia Code", "Fira Code", monospace',
                    whiteSpace: 'pre',
                  }}>
                    {e.data.content.length > 2400 ? e.data.content.slice(0, 2400) + '\n… (truncated)' : e.data.content}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Preview tab */}
      {tab === 'preview' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e293b', display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setPreviewUrl(urlInput)}
              placeholder="http://localhost:3000"
              style={{
                flex: 1, padding: '5px 10px', borderRadius: 6, border: '1px solid #1e293b',
                background: '#040b14', color: '#e2e8f0', fontSize: 11,
                fontFamily: 'monospace', outline: 'none',
              }}
            />
            <button onClick={() => { setPreviewUrl(urlInput); setPreviewHtml(null) }} style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 600,
            }}>Go</button>
            {previewHtml && (
              <button onClick={() => setPreviewHtml(null)} style={{
                padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: '#334155', color: '#94a3b8', fontSize: 11,
              }}>URL</button>
            )}
          </div>
          {previewHtml ? (
            <iframe
              key={previewHtml.slice(0, 40)}
              srcDoc={previewHtml}
              style={{ flex: 1, border: 'none', background: '#fff' }}
              title="Build Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : previewUrl ? (
            <iframe
              key={previewUrl}
              src={previewUrl}
              style={{ flex: 1, border: 'none', background: '#fff' }}
              title="Build Preview"
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 12, gap: 8 }}>
              <div style={{ fontSize: 24, opacity: 0.3 }}>⬡</div>
              Enter a URL or wait for an agent to generate a site
            </div>
          )}
        </div>
      )}
    </div>
  )
}
