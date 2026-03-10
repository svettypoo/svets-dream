'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function BillingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    daily_budget_usd: 10,
    card_last4: '',
    card_brand: '',
    card_exp: '',
  })
  const [cardInput, setCardInput] = useState({
    number: '',
    expiry: '',
    cvc: '',
    name: '',
  })
  const [showCardForm, setShowCardForm] = useState(false)
  const [todaySpend, setTodaySpend] = useState(0)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const res = await fetch('/api/billing/settings')
    if (res.ok) {
      const data = await res.json()
      if (data.settings) setSettings(s => ({ ...s, ...data.settings }))
      setTodaySpend(data.today_spend || 0)
    }
    setLoading(false)
  }

  async function saveBudget() {
    setSaving(true)
    const res = await fetch('/api/billing/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_budget_usd: settings.daily_budget_usd }),
    })
    if (res.ok) setMsg('Daily budget saved.')
    else setMsg('Failed to save.')
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  async function saveCard() {
    if (!cardInput.number || !cardInput.expiry || !cardInput.cvc) {
      setMsg('Please fill in all card fields.')
      return
    }
    setSaving(true)
    const res = await fetch('/api/billing/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardInput),
    })
    const data = await res.json()
    if (res.ok) {
      setSettings(s => ({ ...s, card_last4: data.last4, card_brand: data.brand, card_exp: data.exp }))
      setShowCardForm(false)
      setCardInput({ number: '', expiry: '', cvc: '', name: '' })
      setMsg('Card saved securely.')
    } else {
      setMsg(data.error || 'Failed to save card.')
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 4000)
  }

  const budgetPercent = settings.daily_budget_usd > 0
    ? Math.min(100, (todaySpend / settings.daily_budget_usd) * 100)
    : 0

  const barColor = budgetPercent > 90 ? '#ef4444' : budgetPercent > 70 ? '#f59e0b' : '#6366f1'

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #060d1b 0%, #03080f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#64748b', fontSize: 14 }}>Loading billing settings...</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #060d1b 0%, #03080f 100%)', padding: '40px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <a href="/dashboard" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>← Dashboard</a>
          <span style={{ color: '#334155', fontSize: 13 }}>/</span>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>💳 Billing & Spend Limits</h1>
        </div>

        {msg && (
          <div style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 8, padding: '10px 16px', marginBottom: 20, color: '#a5b4fc', fontSize: 13 }}>
            {msg}
          </div>
        )}

        {/* Today's spend */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid #334155', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <span style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600 }}>Today's AI Spend</span>
            <span style={{ color: '#e2e8f0', fontSize: 28, fontWeight: 700 }}>
              ${todaySpend.toFixed(4)}
              <span style={{ color: '#475569', fontSize: 14, fontWeight: 400 }}> / ${settings.daily_budget_usd.toFixed(2)}</span>
            </span>
          </div>
          <div style={{ height: 8, background: '#0f172a', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${budgetPercent}%`, background: barColor, borderRadius: 4, transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
            {budgetPercent >= 100
              ? '⛔ Daily limit reached — AI calls paused'
              : budgetPercent > 80
              ? `⚠️ ${(100 - budgetPercent).toFixed(0)}% remaining`
              : `${(settings.daily_budget_usd - todaySpend).toFixed(4)} remaining today`
            }
          </div>
        </div>

        {/* Daily budget setting */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid #334155', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          <h3 style={{ margin: '0 0 16px', color: '#e2e8f0', fontSize: 15, fontWeight: 600 }}>Daily Spending Limit</h3>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13 }}>
            AI will stop making API calls once this limit is reached. Resets at midnight UTC.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: 16 }}>$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={settings.daily_budget_usd}
              onChange={e => setSettings(s => ({ ...s, daily_budget_usd: parseFloat(e.target.value) || 0 }))}
              style={{
                flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
                color: '#e2e8f0', padding: '10px 14px', fontSize: 16, outline: 'none',
              }}
            />
            <span style={{ color: '#475569', fontSize: 13 }}>USD / day</span>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            {[1, 5, 10, 25, 50].map(v => (
              <button key={v} onClick={() => setSettings(s => ({ ...s, daily_budget_usd: v }))}
                style={{
                  padding: '6px 12px', borderRadius: 6, border: '1px solid #334155',
                  background: settings.daily_budget_usd === v ? '#6366f1' : '#0f172a',
                  color: settings.daily_budget_usd === v ? '#fff' : '#94a3b8',
                  cursor: 'pointer', fontSize: 13,
                }}>
                ${v}
              </button>
            ))}
          </div>
          <button
            onClick={saveBudget}
            disabled={saving}
            style={{
              marginTop: 16, width: '100%', padding: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
              boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
            }}>
            {saving ? 'Saving...' : 'Save Daily Limit'}
          </button>
        </div>

        {/* Credit card */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, border: '1px solid #334155', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          <h3 style={{ margin: '0 0 16px', color: '#e2e8f0', fontSize: 15, fontWeight: 600 }}>Payment Method</h3>
          {settings.card_last4 ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600 }}>
                  {settings.card_brand || 'Card'} •••• {settings.card_last4}
                </div>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Expires {settings.card_exp}</div>
              </div>
              <button onClick={() => setShowCardForm(true)}
                style={{ color: '#6366f1', background: 'transparent', border: '1px solid #6366f130', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                Update
              </button>
            </div>
          ) : (
            <div>
              <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13 }}>
                Add a card to enable automatic payments when your AI agents incur costs.
              </p>
              <button onClick={() => setShowCardForm(true)}
                style={{ padding: '10px 20px', background: '#6366f115', border: '1px solid #6366f1', borderRadius: 8, color: '#a5b4fc', cursor: 'pointer', fontSize: 14 }}>
                + Add Card
              </button>
            </div>
          )}

          {showCardForm && (
            <div style={{ marginTop: 24, borderTop: '1px solid #334155', paddingTop: 20 }}>
              <h4 style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: 14 }}>Card Details (stored encrypted)</h4>
              {[
                { key: 'name', label: 'Cardholder Name', placeholder: 'Jane Smith' },
                { key: 'number', label: 'Card Number', placeholder: '1234 5678 9012 3456' },
                { key: 'expiry', label: 'Expiry (MM/YY)', placeholder: '12/27' },
                { key: 'cvc', label: 'CVC', placeholder: '123' },
              ].map(f => (
                <div key={f.key} style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>{f.label}</label>
                  <input
                    type={f.key === 'number' ? 'text' : f.key === 'cvc' ? 'text' : 'text'}
                    value={cardInput[f.key]}
                    onChange={e => setCardInput(c => ({ ...c, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
                      color: '#e2e8f0', padding: '10px 14px', fontSize: 14, outline: 'none',
                    }}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button onClick={saveCard} disabled={saving}
                  style={{ flex: 1, padding: '11px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Saving...' : 'Save Card'}
                </button>
                <button onClick={() => setShowCardForm(false)}
                  style={{ padding: '11px 20px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', fontSize: 14, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
              <p style={{ marginTop: 12, color: '#475569', fontSize: 11 }}>
                🔒 Card details are encrypted with AES-256 before storage. Never stored in plain text.
              </p>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <a href="/transactions" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>
            View all transactions →
          </a>
        </div>
      </div>
    </div>
  )
}
