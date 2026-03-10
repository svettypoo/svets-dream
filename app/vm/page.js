'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const IMAGES = [
  { value: 'ubuntu:22.04', label: 'Ubuntu 22.04 LTS' },
  { value: 'ubuntu:20.04', label: 'Ubuntu 20.04 LTS' },
  { value: 'debian:12', label: 'Debian 12 (Bookworm)' },
  { value: 'node:20-slim', label: 'Node.js 20' },
  { value: 'python:3.11-slim', label: 'Python 3.11' },
  { value: 'alpine:3.19', label: 'Alpine Linux 3.19 (tiny)' },
]

const STATUS_COLORS = {
  running: '#22c55e',
  stopped: '#64748b',
  error: '#ef4444',
}

export default function VMPage() {
  const router = useRouter()
  const [vms, setVMs] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newVM, setNewVM] = useState({ name: '', image: 'ubuntu:22.04', memoryMb: 512 })
  const [activeVM, setActiveVM] = useState(null)
  const [terminal, setTerminal] = useState([])
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState(false)
  const [actionLoading, setActionLoading] = useState({})
  const termRef = useRef(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadVMs()
  }, [router])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [terminal])

  async function loadVMs() {
    setLoading(true)
    const res = await fetch('/api/vm')
    const data = await res.json()
    setVMs(data.vms || [])
    setLoading(false)
  }

  async function handleCreate() {
    if (!newVM.name.trim()) return
    setCreating(true)
    setTerminal([{ type: 'info', text: `⏳ Creating VM "${newVM.name}"... pulling image ${newVM.image} (this may take a minute)` }])
    setShowCreate(false)
    const res = await fetch('/api/vm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newVM),
    })
    const data = await res.json()
    if (data.vm) {
      setVMs(v => [data.vm, ...v])
      setActiveVM(data.vm)
      setTerminal(t => [...t, { type: 'success', text: `✅ VM "${data.vm.name}" created and running!` }])
    } else {
      setTerminal(t => [...t, { type: 'error', text: `❌ Error: ${data.error}` }])
    }
    setCreating(false)
    setNewVM({ name: '', image: 'ubuntu:22.04', memoryMb: 512 })
  }

  async function handleAction(vmId, action) {
    setActionLoading(a => ({ ...a, [vmId]: action }))
    const res = await fetch(`/api/vm/${vmId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json()
    if (data.vm) setVMs(v => v.map(vm => vm.id === vmId ? data.vm : vm))
    if (activeVM?.id === vmId && data.vm) setActiveVM(data.vm)
    setActionLoading(a => ({ ...a, [vmId]: null }))
  }

  async function handleDelete(vmId) {
    if (!confirm('Destroy this VM? All data inside will be lost.')) return
    setActionLoading(a => ({ ...a, [vmId]: 'delete' }))
    await fetch(`/api/vm/${vmId}`, { method: 'DELETE' })
    setVMs(v => v.filter(vm => vm.id !== vmId))
    if (activeVM?.id === vmId) { setActiveVM(null); setTerminal([]) }
    setActionLoading(a => ({ ...a, [vmId]: null }))
  }

  async function handleExec(e) {
    e.preventDefault()
    if (!cmd.trim() || !activeVM || running) return
    const command = cmd.trim()
    setCmd('')
    setRunning(true)
    setTerminal(t => [...t, { type: 'cmd', text: `$ ${command}` }])

    const res = await fetch(`/api/vm/${activeVM.id}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, stream: true }),
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let output = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      output += decoder.decode(value, { stream: true })
    }
    if (output) setTerminal(t => [...t, { type: 'output', text: output }])
    setRunning(false)
  }

  const s = { minHeight: '100vh', background: 'linear-gradient(180deg, #060d1b 0%, #03080f 100%)', fontFamily: 'system-ui, sans-serif', display: 'flex' }

  return (
    <div style={s}>
      {/* Sidebar */}
      <div style={{ width: 280, background: '#0f0f1a', borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
          <a href="/dashboard" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 12 }}>← Dashboard</a>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>🖥️ Virtual Machines</h1>
            <button
              onClick={() => setShowCreate(true)}
              style={{ background: '#6366f1', border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600, padding: '4px 10px', cursor: 'pointer' }}
            >+ New</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading ? (
            <div style={{ padding: '20px 16px', color: '#475569', fontSize: 13 }}>Loading...</div>
          ) : vms.length === 0 ? (
            <div style={{ padding: '20px 16px', color: '#475569', fontSize: 13, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🖥️</div>
              No VMs yet.<br />Create one to get started.
            </div>
          ) : vms.map(vm => (
            <div
              key={vm.id}
              onClick={() => { setActiveVM(vm); setTerminal([]) }}
              style={{
                padding: '10px 16px', cursor: 'pointer',
                background: activeVM?.id === vm.id ? '#1e293b' : 'transparent',
                borderLeft: activeVM?.id === vm.id ? '2px solid #6366f1' : '2px solid transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLORS[vm.status] || '#64748b', flexShrink: 0 }} />
                <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vm.name}</span>
              </div>
              <div style={{ color: '#475569', fontSize: 11, marginTop: 2, marginLeft: 15 }}>{vm.image} · {vm.memory_mb}MB</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, marginLeft: 15 }}>
                {vm.status === 'stopped' && (
                  <button onClick={e => { e.stopPropagation(); handleAction(vm.id, 'start') }}
                    disabled={!!actionLoading[vm.id]}
                    style={{ background: '#166534', border: 'none', borderRadius: 4, color: '#86efac', fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>
                    {actionLoading[vm.id] === 'start' ? '...' : '▶ Start'}
                  </button>
                )}
                {vm.status === 'running' && (
                  <button onClick={e => { e.stopPropagation(); handleAction(vm.id, 'stop') }}
                    disabled={!!actionLoading[vm.id]}
                    style={{ background: '#292524', border: 'none', borderRadius: 4, color: '#a8a29e', fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>
                    {actionLoading[vm.id] === 'stop' ? '...' : '⏹ Stop'}
                  </button>
                )}
                <button onClick={e => { e.stopPropagation(); handleDelete(vm.id) }}
                  disabled={!!actionLoading[vm.id]}
                  style={{ background: '#450a0a', border: 'none', borderRadius: 4, color: '#fca5a5', fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>
                  {actionLoading[vm.id] === 'delete' ? '...' : '🗑'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {activeVM ? (
          <>
            {/* VM header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[activeVM.status] || '#64748b' }} />
              <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 15 }}>{activeVM.name}</span>
              <span style={{ color: '#475569', fontSize: 12 }}>{activeVM.image}</span>
              <span style={{ color: '#475569', fontSize: 12 }}>·</span>
              <span style={{ color: '#475569', fontSize: 12 }}>{activeVM.memory_mb}MB RAM</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: STATUS_COLORS[activeVM.status], background: `${STATUS_COLORS[activeVM.status]}20`, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                {activeVM.status}
              </span>
            </div>

            {/* Terminal */}
            <div
              ref={termRef}
              style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', fontFamily: '"Fira Code", "Cascadia Code", monospace', fontSize: 13 }}
            >
              {terminal.length === 0 && (
                <div style={{ color: '#334155', fontSize: 13 }}>
                  {activeVM.status === 'running'
                    ? 'VM is running. Type a command below to execute it.'
                    : 'VM is stopped. Start it to run commands.'}
                </div>
              )}
              {terminal.map((line, i) => (
                <div key={i} style={{
                  marginBottom: 4,
                  color: line.type === 'cmd' ? '#818cf8' : line.type === 'error' ? '#f87171' : line.type === 'success' ? '#86efac' : line.type === 'info' ? '#fbbf24' : '#94a3b8',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {line.text}
                </div>
              ))}
              {running && <div style={{ color: '#818cf8' }}>⠋ Running...</div>}
            </div>

            {/* Command input */}
            <form onSubmit={handleExec} style={{ padding: '12px 20px', borderTop: '1px solid #1e293b', display: 'flex', gap: 8 }}>
              <span style={{ color: '#6366f1', fontFamily: 'monospace', fontSize: 14, display: 'flex', alignItems: 'center' }}>$</span>
              <input
                value={cmd}
                onChange={e => setCmd(e.target.value)}
                disabled={activeVM.status !== 'running' || running}
                placeholder={activeVM.status === 'running' ? 'Enter command...' : 'Start the VM to run commands'}
                style={{
                  flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
                  color: '#e2e8f0', padding: '8px 12px', fontSize: 13, fontFamily: 'monospace', outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={activeVM.status !== 'running' || running || !cmd.trim()}
                style={{
                  background: '#6366f1', border: 'none', borderRadius: 6,
                  color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', opacity: activeVM.status !== 'running' ? 0.4 : 1,
                }}
              >Run</button>
            </form>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 48 }}>🖥️</div>
            <p style={{ color: '#475569', fontSize: 14, textAlign: 'center' }}>
              Select a VM from the sidebar or create a new one.<br />
              Agents use VMs for testing, building, and running code safely.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              style={{ background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >Create your first VM</button>
          </div>
        )}
      </div>

      {/* Create VM Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 28, width: 400, maxWidth: '90vw' }}>
            <h2 style={{ margin: '0 0 20px', color: '#e2e8f0', fontSize: 17 }}>🖥️ Create New VM</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>VM Name</label>
              <input
                autoFocus
                value={newVM.name}
                onChange={e => setNewVM(n => ({ ...n, name: e.target.value }))}
                placeholder="e.g. Dev Sandbox"
                style={{ width: '100%', background: '#0a0a0f', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>OS Image</label>
              <select
                value={newVM.image}
                onChange={e => setNewVM(n => ({ ...n, image: e.target.value }))}
                style={{ width: '100%', background: '#0a0a0f', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 13, outline: 'none' }}
              >
                {IMAGES.map(img => <option key={img.value} value={img.value}>{img.label}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Memory: {newVM.memoryMb}MB</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[256, 512, 1024, 2048].map(mb => (
                  <button key={mb} onClick={() => setNewVM(n => ({ ...n, memoryMb: mb }))}
                    style={{
                      flex: 1, padding: '6px 0', background: newVM.memoryMb === mb ? '#6366f1' : '#1e293b',
                      border: 'none', borderRadius: 6, color: newVM.memoryMb === mb ? '#fff' : '#94a3b8',
                      fontSize: 12, cursor: 'pointer', fontWeight: newVM.memoryMb === mb ? 600 : 400,
                    }}
                  >{mb < 1024 ? `${mb}MB` : `${mb / 1024}GB`}</button>
                ))}
              </div>
            </div>

            <p style={{ color: '#475569', fontSize: 11, marginBottom: 16 }}>
              Requires Docker Desktop to be installed and running. The image will be pulled automatically.
            </p>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCreate(false)}
                style={{ flex: 1, background: '#1e293b', border: 'none', borderRadius: 8, color: '#94a3b8', padding: '10px', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={!newVM.name.trim() || creating}
                style={{ flex: 1, background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: !newVM.name.trim() ? 0.5 : 1 }}>
                {creating ? 'Creating...' : 'Create VM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
