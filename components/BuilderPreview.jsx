'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

const EXEC_URL = 'https://svets-dream-production.up.railway.app'
const EXEC_TOKEN = 'svets-exec-token-2026'

// File type icons
function fileIcon(name) {
  if (!name) return '📄'
  const ext = name.split('.').pop()?.toLowerCase()
  const map = {
    html: '🌐', htm: '🌐',
    js: '📜', jsx: '📜', ts: '📜', tsx: '📜', mjs: '📜',
    css: '🎨', scss: '🎨', sass: '🎨',
    json: '{}', jsonc: '{}',
    md: '📝', mdx: '📝',
    py: '🐍',
    sh: '⚙', bash: '⚙',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼', ico: '🖼', webp: '🖼',
    pdf: '📕',
    env: '🔒', gitignore: '🙈',
    toml: '⚙', yaml: '⚙', yml: '⚙',
    lock: '🔒',
    txt: '📄',
  }
  return map[ext] || '📄'
}

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

// Recursive tree node
function TreeNode({ node, depth = 0, execUrl, execToken, onSelectFile, selectedPath, wsPath }) {
  const [open, setOpen] = useState(depth < 2) // auto-expand first 2 levels
  const isDir = node.type === 'dir'
  const indent = depth * 14
  const fullPath = wsPath ? `${wsPath}/${node.name}` : node.name

  return (
    <div>
      <div
        onClick={() => isDir ? setOpen(o => !o) : onSelectFile(fullPath, node.name)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: `3px 8px 3px ${8 + indent}px`,
          cursor: 'pointer', borderRadius: 4,
          background: selectedPath === fullPath ? 'rgba(99,102,241,0.18)' : 'transparent',
          transition: 'background 0.1s',
          userSelect: 'none',
        }}
        onMouseEnter={e => { if (selectedPath !== fullPath) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
        onMouseLeave={e => { if (selectedPath !== fullPath) e.currentTarget.style.background = 'transparent' }}
      >
        {isDir ? (
          <span style={{ fontSize: 9, color: '#475569', width: 10, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}
        <span style={{ fontSize: 12, flexShrink: 0 }}>
          {isDir ? (open ? '📂' : '📁') : fileIcon(node.name)}
        </span>
        <span style={{
          fontSize: 11.5, color: isDir ? '#cbd5e1' : '#94a3b8',
          fontFamily: '"Cascadia Code", "Fira Code", monospace',
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontWeight: isDir ? 600 : 400,
        }}>
          {node.name}
        </span>
        {!isDir && node.size != null && (
          <span style={{ fontSize: 9.5, color: '#334155', flexShrink: 0 }}>{formatSize(node.size)}</span>
        )}
      </div>
      {isDir && open && node.children?.map((child, i) => (
        <TreeNode
          key={i}
          node={child}
          depth={depth + 1}
          execUrl={execUrl}
          execToken={execToken}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
          wsPath={fullPath}
        />
      ))}
    </div>
  )
}

export default function BuilderPreview({ visible, workspaceId }) {
  const [tab, setTab] = useState('terminal')
  const [entries, setEntries] = useState([])
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewHtml, setPreviewHtml] = useState(null)
  const [urlInput, setUrlInput] = useState('http://localhost:3000')
  const bottomRef = useRef(null)
  const entryIdRef = useRef(0)

  // File tree state
  const [fileTree, setFileTree] = useState([])
  const [selectedFilePath, setSelectedFilePath] = useState(null)
  const [selectedFileContent, setSelectedFileContent] = useState(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [treeLoading, setTreeLoading] = useState(false)
  const treeRefreshTimer = useRef(null)

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

  // Fetch file tree from Railway when workspaceId is available
  const fetchTree = useCallback(async () => {
    if (!workspaceId) return
    setTreeLoading(true)
    try {
      const res = await fetch(
        `${EXEC_URL}/ls?path=/root/workspace/${workspaceId}&recursive=true`,
        { headers: { Authorization: `Bearer ${EXEC_TOKEN}` } }
      )
      if (res.ok) {
        const data = await res.json()
        setFileTree(Array.isArray(data) ? data : [])
      }
    } catch {}
    setTreeLoading(false)
  }, [workspaceId])

  // Auto-refresh tree when files tab is active
  useEffect(() => {
    if (tab === 'files' && workspaceId) {
      fetchTree()
      treeRefreshTimer.current = setInterval(fetchTree, 5000)
    }
    return () => { if (treeRefreshTimer.current) clearInterval(treeRefreshTimer.current) }
  }, [tab, workspaceId, fetchTree])

  // Fetch file content when user clicks a file
  async function handleSelectFile(fullPath, name) {
    setSelectedFilePath(fullPath)
    setSelectedFileContent(null)
    setFileLoading(true)
    try {
      const res = await fetch(
        `${EXEC_URL}/read?path=/root/workspace/${workspaceId}/${fullPath}`,
        { headers: { Authorization: `Bearer ${EXEC_TOKEN}` } }
      )
      if (res.ok) {
        const text = await res.text()
        setSelectedFileContent(text)
      } else {
        setSelectedFileContent('(could not read file)')
      }
    } catch {
      setSelectedFileContent('(error reading file)')
    }
    setFileLoading(false)
  }

  if (!visible) return null

  // Deduplicate by path — keep latest write only (used in terminal tab)
  const filesMap = {}
  entries.filter(e => e.type === 'file').forEach(e => { filesMap[e.data.path] = e })

  return (
    <div style={{
      width: 400,
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
        .tree-scroll::-webkit-scrollbar { display: none; }
        .file-content::-webkit-scrollbar { width: 5px; }
        .file-content::-webkit-scrollbar-track { background: transparent; }
        .file-content::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 3px; }
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
            <div style={{ color: '#3d5473', marginTop: 40, textAlign: 'center', fontSize: 12, lineHeight: 1.8, padding: '0 20px' }}>
              <div style={{ fontSize: 28, opacity: 0.4, marginBottom: 12 }}>⬡</div>
              <div style={{ color: '#475569', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>No build running</div>
              <div style={{ color: '#334155' }}>Terminal output will appear here once an agent starts executing commands.</div>
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

      {/* Files tab — tree view */}
      {tab === 'files' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tree + file preview split */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left: file tree */}
            <div style={{
              width: selectedFilePath ? 180 : '100%',
              flexShrink: 0,
              overflowY: 'auto',
              borderRight: selectedFilePath ? '1px solid #0f2030' : 'none',
              padding: '8px 0',
              scrollbarWidth: 'none',
            }} className="tree-scroll">
              {/* Toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 6px', borderBottom: '1px solid #0d1f35' }}>
                <span style={{ fontSize: 9, color: '#334155', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {workspaceId ? `ws/${workspaceId.slice(0, 16)}` : 'no workspace'}
                </span>
                <button
                  onClick={fetchTree}
                  disabled={treeLoading}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: treeLoading ? '#334155' : '#475569', fontSize: 11, padding: '1px 4px', borderRadius: 3 }}
                  title="Refresh"
                >
                  {treeLoading ? '…' : '↻'}
                </button>
              </div>

              {!workspaceId ? (
                <div style={{ color: '#334155', padding: 20, textAlign: 'center', fontSize: 11.5, lineHeight: 1.7 }}>
                  <div style={{ fontSize: 20, opacity: 0.3, marginBottom: 8 }}>📂</div>
                  Start a build to see files
                </div>
              ) : fileTree.length === 0 && !treeLoading ? (
                <div style={{ color: '#334155', padding: 20, textAlign: 'center', fontSize: 11.5, lineHeight: 1.7 }}>
                  <div style={{ fontSize: 20, opacity: 0.3, marginBottom: 8 }}>📂</div>
                  Workspace is empty
                </div>
              ) : (
                fileTree.map((node, i) => (
                  <TreeNode
                    key={i}
                    node={node}
                    depth={0}
                    onSelectFile={handleSelectFile}
                    selectedPath={selectedFilePath}
                    wsPath=""
                  />
                ))
              )}
            </div>

            {/* Right: file content preview */}
            {selectedFilePath && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                {/* File header */}
                <div style={{ padding: '6px 10px', borderBottom: '1px solid #0d1f35', display: 'flex', alignItems: 'center', gap: 6, background: '#040b14' }}>
                  <span style={{ fontSize: 11, color: '#fbbf24', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedFilePath.split('/').pop()}
                  </span>
                  <button
                    onClick={() => { setSelectedFilePath(null); setSelectedFileContent(null) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
                    title="Close"
                  >×</button>
                </div>
                {/* Content */}
                <div
                  className="file-content"
                  style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '8px 10px' }}
                >
                  {fileLoading ? (
                    <div style={{ color: '#334155', fontSize: 11, padding: 12 }}>Loading…</div>
                  ) : selectedFileContent != null ? (
                    <pre style={{
                      margin: 0, color: '#94a3b8', fontSize: 10.5, lineHeight: 1.6,
                      fontFamily: '"Cascadia Code", "Fira Code", monospace',
                      whiteSpace: 'pre', wordBreak: 'normal',
                    }}>
                      {selectedFileContent.length > 8000
                        ? selectedFileContent.slice(0, 8000) + '\n… (truncated)'
                        : selectedFileContent}
                    </pre>
                  ) : null}
                </div>
              </div>
            )}
          </div>
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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#3d5473', fontSize: 12, gap: 8, padding: '0 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, opacity: 0.35, marginBottom: 4 }}>🌐</div>
              <div style={{ color: '#475569', fontWeight: 600, fontSize: 13 }}>No preview yet</div>
              <div style={{ color: '#334155', lineHeight: 1.6 }}>Enter a URL above or wait for an agent to deploy a site — it will open here automatically.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
