'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TransactionsPage() {
  const router = useRouter()
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all, today, week

  useEffect(() => {
    fetch(`/api/billing/transactions?filter=${filter}`)
      .then(r => r.json())
      .then(data => {
        setTransactions(data.transactions || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [filter])

  const total = transactions.reduce((s, t) => s + (t.cost_usd || 0), 0)

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', padding: '40px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <a href="/dashboard" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>← Dashboard</a>
          <span style={{ color: '#334155', fontSize: 13 }}>/</span>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>📊 AI Transaction History</h1>
          <span style={{ marginLeft: 'auto' }}>
            <a href="/billing" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13, border: '1px solid #6366f130', padding: '5px 12px', borderRadius: 6 }}>
              💳 Billing Settings
            </a>
          </span>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[['all', 'All Time'], ['today', 'Today'], ['week', 'This Week']].map(([v, label]) => (
            <button key={v} onClick={() => { setFilter(v); setLoading(true) }}
              style={{
                padding: '7px 16px', borderRadius: 8,
                background: filter === v ? '#6366f1' : '#1e293b',
                border: `1px solid ${filter === v ? '#6366f1' : '#334155'}`,
                color: filter === v ? '#fff' : '#94a3b8',
                cursor: 'pointer', fontSize: 13, fontWeight: filter === v ? 600 : 400,
              }}>
              {label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#64748b', fontSize: 13 }}>Total:</span>
            <span style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>${total.toFixed(4)}</span>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>Loading transactions...</div>
        ) : transactions.length === 0 ? (
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 48, textAlign: 'center', border: '1px solid #334155' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>No AI transactions yet</div>
            <div style={{ color: '#475569', fontSize: 12, marginTop: 8 }}>Start chatting with your agents and costs will appear here</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {transactions.map((tx, i) => (
              <div key={tx.id || i} style={{
                background: '#1e293b', borderRadius: 10, padding: '16px 20px',
                border: '1px solid #334155', display: 'flex', gap: 16, alignItems: 'flex-start',
              }}>
                <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>
                  {tx.agent_name ? '🤖' : '🔧'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>
                      {tx.agent_name || 'System'}
                    </div>
                    <div style={{ color: '#a78bfa', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                      ${(tx.cost_usd || 0).toFixed(4)}
                    </div>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 4, lineClamp: 2, overflow: 'hidden' }}>
                    {tx.reason || tx.message_preview || 'API call'}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#475569', background: '#0f172a', padding: '2px 8px', borderRadius: 4 }}>
                      {tx.model || 'claude-opus-4-6'}
                    </span>
                    <span style={{ fontSize: 11, color: '#475569' }}>
                      ↑ {(tx.input_tokens || 0).toLocaleString()} in · ↓ {(tx.output_tokens || 0).toLocaleString()} out
                    </span>
                    <span style={{ fontSize: 11, color: '#334155', marginLeft: 'auto' }}>
                      {tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
