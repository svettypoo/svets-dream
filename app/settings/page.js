'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const SERVICES = [
  { key: 'anthropic', label: 'Anthropic (Claude)', icon: '🤖', placeholder: 'sk-ant-api03-...' },
  { key: 'github', label: 'GitHub', icon: '🐙', placeholder: 'ghp_...' },
  { key: 'aws', label: 'AWS', icon: '☁️', placeholder: 'AKIA...' },
  { key: 'openai', label: 'OpenAI', icon: '🟢', placeholder: 'sk-...' },
  { key: 'vercel', label: 'Vercel', icon: '▲', placeholder: 'vercel_...' },
  { key: 'stripe', label: 'Stripe', icon: '💳', placeholder: 'sk_live_...' },
]

export default function SettingsPage() {
  const router = useRouter()
  const [keys, setKeys] = useState({})
  const [inputs, setInputs] = useState({})
  const [saving, setSaving] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    fetch('/api/settings/keys').then(r => r.json()).then(d => {
      setKeys(d.keys || {})
    })
  }, [router])

  async function saveKey(service) {
    const value = inputs[service]?.trim()
    if (!value) return
    setSaving(service)
    const res = await fetch('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, key: value }),
    })
    if (res.ok) {
      setKeys(k => ({ ...k, [service]: '••••••••' }))
      setInputs(i => ({ ...i, [service]: '' }))
      setMsg(`${service} key saved.`)
    } else {
      setMsg('Failed to save key.')
    }
    setSaving(null)
    setTimeout(() => setMsg(''), 3000)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', padding: '40px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <a href="/dashboard" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>← Dashboard</a>
          <span style={{ color: '#334155', fontSize: 13 }}>/</span>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>⚙️ API Key Settings</h1>
        </div>

        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
          Keys are encrypted with AES-256 before storage. Agents use these to act autonomously on your behalf.
        </p>

        {msg && (
          <div style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 8, padding: '10px 16px', marginBottom: 20, color: '#a5b4fc', fontSize: 13 }}>
            {msg}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {SERVICES.map(s => (
            <div key={s.key} style={{ background: '#1e293b', borderRadius: 10, padding: '16px 20px', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>{s.icon}</span>
                <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{s.label}</span>
                {keys[s.key] && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#22c55e', background: '#22c55e15', padding: '2px 8px', borderRadius: 10 }}>✓ Saved</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="password"
                  value={inputs[s.key] || ''}
                  onChange={e => setInputs(i => ({ ...i, [s.key]: e.target.value }))}
                  placeholder={keys[s.key] ? '••••••• (update)' : s.placeholder}
                  style={{
                    flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
                    color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none',
                  }}
                />
                <button
                  onClick={() => saveKey(s.key)}
                  disabled={!inputs[s.key]?.trim() || saving === s.key}
                  style={{
                    padding: '9px 18px', background: '#6366f1', border: 'none', borderRadius: 8,
                    color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    opacity: !inputs[s.key]?.trim() ? 0.4 : 1,
                  }}>
                  {saving === s.key ? '...' : 'Save'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 28, background: '#1e293b', borderRadius: 10, padding: '16px 20px', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>🖥️</span>
            <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>Virtual Machines</span>
          </div>
          <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 12px' }}>
            Agents use Docker containers for safe code execution, testing, and debugging.
            Requires Docker Desktop installed and running on this machine.
          </p>
          <a href="/vm" style={{
            display: 'inline-block', background: '#6366f1', borderRadius: 8,
            color: '#fff', padding: '8px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none',
          }}>Manage VMs →</a>
        </div>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <a href="/billing" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>
            💳 Billing & spend limits →
          </a>
        </div>
      </div>
    </div>
  )
}
