'use client'
import { useState, useEffect } from 'react'
import { ExternalLink, Github, BarChart2, Settings, CreditCard, Code2, Play } from 'lucide-react'

const RAILWAY_URL = 'https://exec.stproperties.com'
const EXEC_TOKEN = 'svets-exec-token-2026'

const PLAN_LABELS = { starter: 'Starter · $29/mo', pro: 'Pro · $79/mo', export: 'Export tier' }
const PLAN_COLORS = { starter: '#6366f1', pro: '#f59e0b', export: '#10b981' }
const STATUS_COLORS = { active: '#10b981', suspended: '#f59e0b', cancelled: '#ef4444' }

export default function MyAppsPage() {
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [usage, setUsage] = useState({})

  useEffect(() => { loadTenants() }, [])

  async function loadTenants() {
    setLoading(true)
    const res = await fetch(`${RAILWAY_URL}/forge/tenants`, {
      headers: { 'Authorization': `Bearer ${EXEC_TOKEN}` }
    })
    const data = await res.json()
    setTenants(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  const statusDot = (s) => (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s] || '#94a3b8', marginRight: 6 }} />
  )

  return (
    <div style={{ minHeight: '100vh', background: '#050d1a', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #0f172a', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href="/forge" style={{ color: '#475569', textDecoration: 'none', fontSize: 12 }}>← Forge</a>
        <span style={{ color: '#1e293b' }}>|</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#6366f1' }}>📱 My Apps</span>
        <span style={{ fontSize: 11, color: '#334155' }}>Running apps under your account</span>
        <a href="/forge" style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 7, background: 'linear-gradient(135deg,#f59e0b,#6366f1)', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
          + Build new app
        </a>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
        {/* App list */}
        <div style={{ width: 280, borderRight: '1px solid #0f172a', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, color: '#334155', fontSize: 12 }}>Loading apps…</div>
          ) : tenants.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏗</div>
              <div style={{ fontSize: 13, color: '#475569', marginBottom: 16 }}>No apps yet</div>
              <a href="/forge" style={{ padding: '8px 16px', borderRadius: 8, background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>Build your first app</a>
            </div>
          ) : tenants.map(t => (
            <div key={t.id} onClick={() => setSelected(t)} style={{ padding: '14px 16px', borderBottom: '1px solid #0f172a', cursor: 'pointer', background: selected?.id === t.id ? '#0a1628' : 'transparent', transition: 'background 0.15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{t.app_name}</span>
                <span style={{ fontSize: 10, color: STATUS_COLORS[t.status] }}>{statusDot(t.status)}{t.status}</span>
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>{t.slug}.svets-dream.app</div>
              <div style={{ fontSize: 10, color: PLAN_COLORS[t.plan] || '#64748b' }}>{PLAN_LABELS[t.plan] || t.plan}</div>
            </div>
          ))}
        </div>

        {/* App detail */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
          {!selected ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#1e293b' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>←</div>
                <p style={{ fontSize: 14 }}>Select an app to manage it</p>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 720 }}>
              {/* App header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', margin: 0 }}>{selected.app_name}</h1>
                  <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0' }}>Tenant ID: {selected.id}</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href={`https://${selected.slug}.svets-dream.app`} target="_blank" rel="noreferrer"
                    style={{ padding: '7px 14px', borderRadius: 7, background: '#10b981', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ExternalLink size={13} /> Open App
                  </a>
                  {selected.repo_url && (
                    <a href={selected.repo_url} target="_blank" rel="noreferrer"
                      style={{ padding: '7px 14px', borderRadius: 7, background: '#1e293b', color: '#94a3b8', fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #334155' }}>
                      <Github size={13} /> Repo
                    </a>
                  )}
                </div>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Plan', value: PLAN_LABELS[selected.plan] || selected.plan, color: PLAN_COLORS[selected.plan] },
                  { label: 'Status', value: selected.status, color: STATUS_COLORS[selected.status] },
                  { label: 'Monthly', value: `$${((selected.monthly_price_cents || 2900) / 100).toFixed(2)}`, color: '#f59e0b' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#0a1220', border: '1px solid #1e293b', borderRadius: 12, padding: '16px 20px' }}>
                    <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color || '#e2e8f0' }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Config summary */}
              {selected.config && (
                <div style={{ background: '#0a1220', border: '1px solid #1e293b', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Build Config</div>
                  <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', lineHeight: 1.7 }}>
                    {(() => {
                      try {
                        const c = typeof selected.config === 'string' ? JSON.parse(selected.config) : selected.config
                        return (
                          <>
                            <div><span style={{ color: '#a78bfa' }}>blocks</span> {(c.blocks || []).join(', ')}</div>
                            {c.entities?.length > 0 && <div><span style={{ color: '#22d3ee' }}>entities</span> {c.entities.map(e => e.name).join(', ')}</div>}
                            {c.primaryColor && <div><span style={{ color: '#f59e0b' }}>color</span> {c.primaryColor}</div>}
                          </>
                        )
                      } catch { return <div>{String(selected.config)}</div> }
                    })()}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ background: '#0a1220', border: '1px solid #1e293b', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Actions</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <a href={`/forge?clone=${selected.id}`} style={{ padding: '8px 16px', borderRadius: 8, background: '#1e293b', color: '#818cf8', fontSize: 12, fontWeight: 600, textDecoration: 'none', border: '1px solid #312e81' }}>
                    🔄 Rebuild / Update
                  </a>
                  <a href={`/?ws=${selected.workspace_id || selected.id}&prompt=I want to add a new feature to ${selected.app_name}`}
                    style={{ padding: '8px 16px', borderRadius: 8, background: '#1e293b', color: '#a78bfa', fontSize: 12, fontWeight: 600, textDecoration: 'none', border: '1px solid #334155' }}>
                    💬 Fine-tune with Claude
                  </a>
                  {selected.plan !== 'export' && (
                    <button style={{ padding: '8px 16px', borderRadius: 8, background: '#0a2e12', color: '#4ade80', fontSize: 12, fontWeight: 600, border: '1px solid #166534', cursor: 'pointer' }}>
                      📦 Export Code — upgrade to unlock
                    </button>
                  )}
                </div>
              </div>

              {/* Danger zone */}
              <div style={{ background: '#1a0a0a', border: '1px solid #450a0a', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Danger Zone</div>
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Suspending your app will take it offline. Your data is preserved for 30 days.</p>
                <button style={{ padding: '7px 16px', borderRadius: 7, background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', fontSize: 12, cursor: 'pointer' }}>
                  Suspend App
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
