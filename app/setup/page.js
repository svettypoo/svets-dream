'use client'
import { useState, useEffect } from 'react'

const DOCKER_INSTALL_URL = 'https://www.docker.com/products/docker-desktop/'
const SUPABASE_TOKENS_URL = 'https://supabase.com/dashboard/account/tokens'
const SUPABASE_SQL_URL = `https://supabase.com/dashboard/project/xocfduqugghailalzlqy/sql/new`

function StatusDot({ ok, loading }) {
  if (loading) return <span style={{ fontSize: 14 }}>⏳</span>
  return <span style={{ fontSize: 14 }}>{ok ? '✅' : '❌'}</span>
}

export default function SetupPage() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [initLoading, setInitLoading] = useState(false)
  const [initResult, setInitResult] = useState(null)
  const [showSQL, setShowSQL] = useState(false)
  const [sqlCopied, setSQLCopied] = useState(false)

  useEffect(() => { check() }, [])

  async function check() {
    setLoading(true)
    const res = await fetch('/api/setup/check')
    setStatus(await res.json())
    setLoading(false)
  }

  async function initDB() {
    setInitLoading(true)
    setInitResult(null)
    const res = await fetch('/api/setup/init-db', { method: 'POST' })
    const data = await res.json()
    setInitResult(data)
    setInitLoading(false)
    if (data.ok) setTimeout(check, 1000)
    if (data.manual) setShowSQL(true)
  }

  async function copySQL() {
    if (initResult?.sql) {
      await navigator.clipboard.writeText(initResult.sql)
      setSQLCopied(true)
      setTimeout(() => setSQLCopied(false), 2000)
    }
  }

  const allGood = status && status.supabase?.ok && status.docker?.ok && status.bash?.ok && Object.values(status.env || {}).every(Boolean)

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #060d1b 0%, #03080f 100%)', padding: '40px 24px', fontFamily: 'system-ui, sans-serif', overflowY: 'auto' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <a href="/dashboard" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>← Dashboard</a>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>🚀 Setup & Health Check</h1>
        </div>

        {allGood && (
          <div style={{ background: '#052e16', border: '1px solid #166534', borderRadius: 10, padding: '14px 20px', marginBottom: 24, color: '#86efac', fontSize: 14 }}>
            ✅ Everything is set up and working! Your agents are ready to run.
          </div>
        )}

        {/* Database */}
        <section style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <StatusDot ok={status?.supabase?.ok} loading={loading} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>Supabase Database Tables</h2>
          </div>

          {!loading && status?.supabase && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {Object.entries(status.supabase.tables).map(([table, ok]) => (
                  <div key={table} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1e293b', borderRadius: 6, padding: '8px 12px' }}>
                    <span style={{ fontSize: 12 }}>{ok ? '✅' : '❌'}</span>
                    <span style={{ color: ok ? '#94a3b8' : '#f87171', fontSize: 12, fontFamily: 'monospace' }}>{table}</span>
                  </div>
                ))}
              </div>

              {!status.supabase.ok && (
                <div>
                  {!status.supabase.canAutoInit && (
                    <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
                      Add <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, color: '#a5b4fc' }}>SUPABASE_ACCESS_TOKEN</code> to <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, color: '#a5b4fc' }}>.env.local</code> from{' '}
                      <a href={SUPABASE_TOKENS_URL} target="_blank" rel="noreferrer" style={{ color: '#6366f1' }}>app.supabase.com/account/tokens</a>{' '}
                      to auto-initialize, or run the SQL manually below.
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={initDB}
                      disabled={initLoading}
                      style={{ background: '#6366f1', border: 'none', borderRadius: 7, color: '#fff', padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {initLoading ? '⏳ Initializing...' : status.supabase.canAutoInit ? '⚡ Auto-Initialize Database' : '📋 Show SQL to Copy'}
                    </button>
                    <a href={SUPABASE_SQL_URL} target="_blank" rel="noreferrer"
                      style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 7, color: '#94a3b8', padding: '9px 18px', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                      Open SQL Editor ↗
                    </a>
                  </div>

                  {initResult && !initResult.manual && (
                    <div style={{ marginTop: 12, background: initResult.ok ? '#052e16' : '#2d1515', border: `1px solid ${initResult.ok ? '#166534' : '#7f1d1d'}`, borderRadius: 8, padding: '12px', fontSize: 13 }}>
                      {initResult.ok
                        ? <span style={{ color: '#86efac' }}>✅ Database initialized! {initResult.total} statements ran successfully.</span>
                        : <span style={{ color: '#f87171' }}>⚠️ {initResult.failed}/{initResult.total} statements failed. Check your access token.</span>
                      }
                    </div>
                  )}

                  {showSQL && initResult?.sql && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ color: '#94a3b8', fontSize: 12 }}>Paste this into the Supabase SQL Editor:</span>
                        <button onClick={copySQL}
                          style={{ background: '#1e293b', border: 'none', borderRadius: 5, color: sqlCopied ? '#86efac' : '#94a3b8', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                          {sqlCopied ? '✓ Copied!' : 'Copy SQL'}
                        </button>
                      </div>
                      <pre style={{ background: '#0a0a0f', border: '1px solid #1e293b', borderRadius: 8, padding: '12px', color: '#64748b', fontSize: 11, overflow: 'auto', maxHeight: 200, fontFamily: 'monospace' }}>
                        {initResult.sql}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* Docker */}
        <section style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <StatusDot ok={status?.docker?.ok} loading={loading} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>Docker Desktop</h2>
            {!loading && status?.docker?.ok && (
              <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 12 }}>v{status.docker.version}</span>
            )}
          </div>
          {!loading && !status?.docker?.ok && (
            <div>
              <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 12px' }}>
                Docker is required for VM features. Agents use it to run code safely in isolated containers.
              </p>
              <a href={DOCKER_INSTALL_URL} target="_blank" rel="noreferrer"
                style={{ display: 'inline-block', background: '#0ea5e9', border: 'none', borderRadius: 7, color: '#fff', padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Download Docker Desktop ↗
              </a>
              <p style={{ color: '#475569', fontSize: 11, marginTop: 8 }}>After installing, open Docker Desktop and wait for it to start, then click Recheck below.</p>
            </div>
          )}
        </section>

        {/* Bash */}
        <section style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <StatusDot ok={status?.bash?.ok} loading={loading} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>Bash Shell</h2>
            {!loading && status?.bash?.ok && (
              <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 12 }}>available</span>
            )}
          </div>
          {!loading && !status?.bash?.ok && (
            <p style={{ color: '#64748b', fontSize: 13, margin: '8px 0 0' }}>
              Install Git for Windows (includes Git Bash) or Scoop: <code style={{ color: '#a5b4fc' }}>scoop install git</code>
            </p>
          )}
        </section>

        {/* Environment Variables */}
        <section style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '20px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <StatusDot ok={!loading && Object.values(status?.env || {}).every(Boolean)} loading={loading} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>Environment Variables</h2>
          </div>
          {!loading && status?.env && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(status.env).map(([key, ok]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11 }}>{ok ? '✅' : '❌'}</span>
                  <code style={{ color: ok ? '#94a3b8' : '#f87171', fontSize: 12 }}>
                    {key === 'anthropicKey' ? 'ANTHROPIC_API_KEY'
                      : key === 'supabaseUrl' ? 'NEXT_PUBLIC_SUPABASE_URL'
                      : key === 'supabaseAnonKey' ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
                      : 'SUPABASE_SERVICE_ROLE_KEY'}
                  </code>
                </div>
              ))}
              <p style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>Set in <code style={{ color: '#a5b4fc' }}>.env.local</code> at the project root.</p>
            </div>
          )}
        </section>

        <button
          onClick={check}
          disabled={loading}
          style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', padding: '10px 20px', fontSize: 13, cursor: 'pointer', width: '100%' }}
        >
          {loading ? '⏳ Checking...' : '🔄 Recheck All'}
        </button>
      </div>
    </div>
  )
}
