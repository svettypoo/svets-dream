'use client'
import { useState, useEffect, useCallback } from 'react'

function formatInterval(minutes) {
  if (minutes >= 10080) return `every ${minutes / 10080}w`
  if (minutes >= 1440) return `every ${minutes / 1440}d`
  if (minutes >= 60) return `every ${minutes / 60}h`
  return `every ${minutes}m`
}

function timeUntil(iso) {
  if (!iso) return '—'
  const diff = new Date(iso) - Date.now()
  if (diff < 0) return 'now'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

export default function WorkflowsPanel() {
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', task: '', interval_minutes: 60, description: '' })
  const [showForm, setShowForm] = useState(false)

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows')
      const data = await res.json()
      if (Array.isArray(data)) setWorkflows(data)
    } catch {}
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchWorkflows().finally(() => setLoading(false))
  }, [fetchWorkflows])

  // Listen for WORKFLOW_CREATED events from BuilderChat
  useEffect(() => {
    function onWorkflowCreated(e) {
      fetchWorkflows()
    }
    window.addEventListener('workflowCreated', onWorkflowCreated)
    return () => window.removeEventListener('workflowCreated', onWorkflowCreated)
  }, [fetchWorkflows])

  async function toggleActive(wf) {
    setWorkflows(prev => prev.map(w => w.id === wf.id ? { ...w, active: !w.active } : w))
    await fetch('/api/workflows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: wf.id, active: !wf.active }),
    })
    fetchWorkflows()
  }

  async function deleteWorkflow(id) {
    setWorkflows(prev => prev.filter(w => w.id !== id))
    await fetch(`/api/workflows?id=${id}`, { method: 'DELETE' })
  }

  async function createWorkflow(e) {
    e.preventDefault()
    if (!form.name || !form.task) return
    setCreating(true)
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setForm({ name: '', task: '', interval_minutes: 60, description: '' })
        setShowForm(false)
        fetchWorkflows()
      }
    } finally {
      setCreating(false)
    }
  }

  const active = workflows.filter(w => w.active)
  const inactive = workflows.filter(w => !w.active)

  return (
    <div style={{
      width: 300, minWidth: 300, height: '100%',
      background: 'rgba(5,13,26,0.97)',
      borderLeft: '1px solid #0f172a',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        height: 36, borderBottom: '1px solid #0f172a',
        display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6, flexShrink: 0,
      }}>
        <span style={{ fontSize: 13 }}>⏰</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', flex: 1 }}>Workflows</span>
        <button onClick={() => setShowForm(v => !v)} title="New workflow" style={{
          background: showForm ? 'rgba(99,102,241,0.2)' : 'none',
          border: `1px solid ${showForm ? '#6366f1' : '#1e293b'}`,
          cursor: 'pointer', color: '#a78bfa', fontSize: 14, padding: '1px 7px', borderRadius: 5,
          transition: 'all 0.15s',
        }}>+</button>
        <button onClick={fetchWorkflows} title="Refresh" style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#475569', fontSize: 12, padding: '2px 4px',
        }}>↺</button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={createWorkflow} style={{
          padding: '10px 12px', borderBottom: '1px solid #0f172a',
          display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
        }}>
          <input
            placeholder="Name (e.g. Morning review)"
            value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            style={{ background: '#0a1628', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: 11 }}
          />
          <textarea
            placeholder="Task instruction (what the agent should do)"
            value={form.task} onChange={e => setForm(p => ({ ...p, task: e.target.value }))}
            rows={2}
            style={{ background: '#0a1628', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: 11, resize: 'none', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={form.interval_minutes}
              onChange={e => setForm(p => ({ ...p, interval_minutes: parseInt(e.target.value) }))}
              style={{ flex: 1, background: '#0a1628', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: 11 }}
            >
              <option value={5}>Every 5 minutes</option>
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
              <option value={360}>Every 6 hours</option>
              <option value={720}>Every 12 hours</option>
              <option value={1440}>Daily</option>
              <option value={10080}>Weekly</option>
            </select>
            <button type="submit" disabled={creating || !form.name || !form.task} style={{
              background: 'rgba(99,102,241,0.3)', border: '1px solid #6366f1',
              color: '#c4b5fd', fontSize: 11, padding: '5px 12px', borderRadius: 6,
              cursor: creating ? 'default' : 'pointer', fontFamily: 'inherit',
            }}>
              {creating ? '…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
        {loading ? (
          <div style={{ color: '#334155', fontSize: 11, textAlign: 'center', paddingTop: 24 }}>Loading…</div>
        ) : workflows.length === 0 ? (
          <div style={{ color: '#334155', fontSize: 11, textAlign: 'center', paddingTop: 24, lineHeight: 1.8 }}>
            No workflows yet.<br />
            <span style={{ fontSize: 10 }}>Tell the agent "remind me every hour to…"<br />or use the + button above.</span>
          </div>
        ) : (
          <>
            {active.map(wf => <WorkflowCard key={wf.id} wf={wf} onToggle={toggleActive} onDelete={deleteWorkflow} />)}
            {inactive.length > 0 && (
              <>
                <div style={{ fontSize: 9, color: '#334155', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '10px 0 6px' }}>PAUSED</div>
                {inactive.map(wf => <WorkflowCard key={wf.id} wf={wf} onToggle={toggleActive} onDelete={deleteWorkflow} />)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function WorkflowCard({ wf, onToggle, onDelete }) {
  return (
    <div style={{
      background: 'rgba(15,23,42,0.8)',
      border: `1px solid ${wf.active ? 'rgba(99,102,241,0.2)' : '#1e293b'}`,
      borderLeft: `3px solid ${wf.active ? '#6366f1' : '#334155'}`,
      borderRadius: 8, padding: '9px 11px', marginBottom: 7,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: wf.active ? '#e2e8f0' : '#475569',
            marginBottom: 3, wordBreak: 'break-word',
          }}>{wf.name}</div>
          <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.5 }}>
            {wf.task.slice(0, 90)}{wf.task.length > 90 ? '…' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 5, alignItems: 'center' }}>
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: wf.active ? '#818cf8' : '#334155',
              background: wf.active ? 'rgba(99,102,241,0.12)' : '#0f172a',
              padding: '1px 6px', borderRadius: 4,
            }}>{formatInterval(wf.interval_minutes)}</span>
            {wf.active && (
              <span style={{ fontSize: 9, color: '#475569' }}>
                next {timeUntil(wf.next_run)}
              </span>
            )}
            {wf.run_count > 0 && (
              <span style={{ fontSize: 9, color: '#334155' }}>
                ran {wf.run_count}×
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
          <button onClick={() => onToggle(wf)} title={wf.active ? 'Pause' : 'Resume'} style={{
            background: 'none', border: `1px solid ${wf.active ? '#1e293b' : 'rgba(99,102,241,0.3)'}`,
            cursor: 'pointer', color: wf.active ? '#475569' : '#818cf8',
            fontSize: 11, padding: '2px 5px', borderRadius: 4, transition: 'all 0.15s',
            lineHeight: 1,
          }}>{wf.active ? '⏸' : '▶'}</button>
          <button onClick={() => onDelete(wf.id)} title="Delete" style={{
            background: 'none', border: '1px solid #1e293b',
            cursor: 'pointer', color: '#334155', fontSize: 11,
            padding: '2px 5px', borderRadius: 4, transition: 'color 0.15s', lineHeight: 1,
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
          onMouseLeave={e => e.currentTarget.style.color = '#334155'}
          >×</button>
        </div>
      </div>
    </div>
  )
}
