'use client'
import { useState, useEffect, useCallback } from 'react'

const STATUS_COLS = [
  { key: 'todo',        label: 'To Do',       color: '#64748b', dot: '#475569' },
  { key: 'in_progress', label: 'In Progress',  color: '#6366f1', dot: '#818cf8' },
  { key: 'done',        label: 'Done',         color: '#22c55e', dot: '#4ade80' },
  { key: 'waiting',     label: 'Waiting',      color: '#f59e0b', dot: '#fbbf24' },
  { key: 'cancelled',   label: 'Cancelled',    color: '#ef4444', dot: '#f87171' },
]

const NEXT_STATUS = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
  waiting: 'in_progress',
  cancelled: 'todo',
}

const PRIORITY_LABEL = { 1: '🔥', 2: '⬆', 3: '▶', 4: '⬇', 5: '🧊' }

function TaskCard({ task, onStatusChange }) {
  const col = STATUS_COLS.find(c => c.key === task.status) || STATUS_COLS[0]
  const [busy, setBusy] = useState(false)

  async function cycle(e) {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      await onStatusChange(task.id, NEXT_STATUS[task.status] || 'todo')
    } finally {
      setBusy(false)
    }
  }

  const tags = task.tags || []

  return (
    <div style={{
      background: 'rgba(15,23,42,0.8)',
      border: `1px solid ${col.color}22`,
      borderLeft: `3px solid ${col.dot}`,
      borderRadius: 8, padding: '10px 12px', marginBottom: 8,
      cursor: 'default',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button
          onClick={cycle}
          title={`Mark as ${NEXT_STATUS[task.status]}`}
          style={{
            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
            background: 'transparent', border: `2px solid ${col.dot}`,
            cursor: 'pointer', marginTop: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {busy ? <span style={{ fontSize: 8, color: col.dot }}>…</span>
            : task.status === 'done' ? <span style={{ fontSize: 9, color: col.dot }}>✓</span>
            : null}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: task.status === 'done' ? '#475569' : '#e2e8f0',
            lineHeight: 1.4, wordBreak: 'break-word',
            textDecoration: task.status === 'done' ? 'line-through' : 'none',
          }}>
            {PRIORITY_LABEL[task.priority] || ''} {task.title}
          </div>
          {task.description && (
            <div style={{ fontSize: 11, color: '#475569', marginTop: 3, lineHeight: 1.5 }}>
              {task.description.slice(0, 120)}{task.description.length > 120 ? '…' : ''}
            </div>
          )}
          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 9, fontWeight: 600, color: '#a78bfa',
                  background: '#a78bfa15', border: '1px solid #a78bfa30',
                  padding: '1px 6px', borderRadius: 4,
                }}>#{tag}</span>
              ))}
            </div>
          )}
          {task.due_date && (
            <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>
              Due {task.due_date}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TasksPanel({ workspaceId }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')
  const [compact, setCompact] = useState(false)

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (workspaceId) params.set('workspaceId', workspaceId)
      const res = await fetch(`/api/tasks?${params}`)
      const data = await res.json()
      if (Array.isArray(data)) setTasks(data)
    } catch {}
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    fetchTasks().finally(() => setLoading(false))
  }, [fetchTasks])

  // Listen for TASK_UPDATE events from BuilderChat stream parsing
  useEffect(() => {
    function onTaskUpdate(e) {
      const task = e.detail
      if (!task?.id) return
      setTasks(prev => {
        const idx = prev.findIndex(t => t.id === task.id)
        if (idx === -1) return [task, ...prev]
        const next = [...prev]
        next[idx] = { ...next[idx], ...task }
        return next
      })
    }
    function onTaskList(e) {
      const list = e.detail
      if (!Array.isArray(list)) return
      setTasks(list)
    }
    window.addEventListener('taskUpdate', onTaskUpdate)
    window.addEventListener('taskList', onTaskList)
    return () => {
      window.removeEventListener('taskUpdate', onTaskUpdate)
      window.removeEventListener('taskList', onTaskList)
    }
  }, [])

  async function handleStatusChange(id, newStatus) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t))
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      })
    } catch {}
  }

  const filtered = activeFilter === 'all'
    ? tasks.filter(t => t.status !== 'cancelled')
    : tasks.filter(t => t.status === activeFilter)

  const byStatus = STATUS_COLS.reduce((acc, col) => {
    acc[col.key] = filtered.filter(t => t.status === col.key)
    return acc
  }, {})

  const counts = STATUS_COLS.reduce((acc, col) => {
    acc[col.key] = tasks.filter(t => t.status === col.key).length
    return acc
  }, {})

  return (
    <div style={{
      width: compact ? 48 : 320,
      minWidth: compact ? 48 : 320,
      height: '100%',
      background: 'rgba(5,13,26,0.97)',
      borderLeft: '1px solid #0f172a',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.2s, min-width 0.2s',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        height: 36, borderBottom: '1px solid #0f172a',
        display: 'flex', alignItems: 'center',
        padding: compact ? '0 8px' : '0 12px', gap: 6, flexShrink: 0,
      }}>
        <span style={{ fontSize: 13 }}>📋</span>
        {!compact && (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', flex: 1 }}>Tasks</span>
            <button onClick={fetchTasks} title="Refresh" style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#475569', fontSize: 12, padding: '2px 4px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#a78bfa'}
            onMouseLeave={e => e.currentTarget.style.color = '#475569'}
            >↺</button>
          </>
        )}
        <button onClick={() => setCompact(v => !v)} title={compact ? 'Expand' : 'Collapse'} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#475569', fontSize: 12, padding: '2px 4px',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#a78bfa'}
        onMouseLeave={e => e.currentTarget.style.color = '#475569'}
        >{compact ? '◀' : '▶'}</button>
      </div>

      {compact ? null : (
        <>
          {/* Filter tabs */}
          <div style={{
            display: 'flex', gap: 0, borderBottom: '1px solid #0f172a',
            padding: '0 4px', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0,
          }}>
            {[{ key: 'all', label: 'All' }, ...STATUS_COLS.slice(0, 3)].map(({ key, label }) => (
              <button key={key} onClick={() => setActiveFilter(key)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: activeFilter === key ? 700 : 400,
                color: activeFilter === key ? '#a78bfa' : '#475569',
                padding: '6px 8px', borderBottom: activeFilter === key ? '2px solid #6366f1' : '2px solid transparent',
                whiteSpace: 'nowrap', transition: 'all 0.15s',
              }}>
                {label}
                {key !== 'all' && counts[key] > 0 && (
                  <span style={{
                    marginLeft: 4, fontSize: 9, fontWeight: 700,
                    color: STATUS_COLS.find(c => c.key === key)?.dot || '#64748b',
                    background: 'rgba(99,102,241,0.1)', padding: '0 4px', borderRadius: 8,
                  }}>{counts[key]}</span>
                )}
                {key === 'all' && tasks.length > 0 && (
                  <span style={{ marginLeft: 4, fontSize: 9, color: '#475569' }}>{tasks.filter(t => t.status !== 'cancelled').length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Task list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
            {loading ? (
              <div style={{ color: '#334155', fontSize: 11, textAlign: 'center', paddingTop: 24 }}>Loading tasks…</div>
            ) : filtered.length === 0 ? (
              <div style={{ color: '#334155', fontSize: 11, textAlign: 'center', paddingTop: 24, lineHeight: 1.8 }}>
                No {activeFilter === 'all' ? '' : activeFilter} tasks yet.<br />
                <span style={{ fontSize: 10 }}>The agent will create tasks automatically.</span>
              </div>
            ) : activeFilter !== 'all' ? (
              filtered.map(task => (
                <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} />
              ))
            ) : (
              STATUS_COLS.filter(col => byStatus[col.key]?.length > 0).map(col => (
                <div key={col.key} style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 9, fontWeight: 800, color: col.dot, letterSpacing: '0.08em',
                    marginBottom: 6, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: col.dot, display: 'inline-block' }} />
                    {col.label} · {byStatus[col.key].length}
                  </div>
                  {byStatus[col.key].map(task => (
                    <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} />
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
