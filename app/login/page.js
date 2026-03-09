'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const STORAGE_KEY = 'sd_remember'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved?.email) { setEmail(saved.email); setPassword(saved.password || ''); setRemember(true) }
    } catch {}
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    if (remember) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ email, password }))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else router.push('/dashboard')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f', fontFamily: 'sans-serif' }}>
      <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '40px', width: '100%', maxWidth: 400 }}>
        <h1 style={{ color: '#fff', marginBottom: 8, fontSize: 24 }}>Svet&apos;s Dream</h1>
        <p style={{ color: '#888', marginBottom: 32, fontSize: 14 }}>Sign in to your agent organization</p>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input
            type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #333', background: '#111', color: '#fff', fontSize: 14 }}
          />
          <input
            type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #333', background: '#111', color: '#fff', fontSize: 14 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: '#6366f1', cursor: 'pointer' }} />
            <span style={{ color: '#888', fontSize: 13 }}>Remember me</span>
          </label>
          {error && <p style={{ color: '#f87171', fontSize: 13 }}>{error}</p>}
          <button type="submit" disabled={loading}
            style={{ padding: '10px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p style={{ color: '#888', fontSize: 13, marginTop: 20, textAlign: 'center' }}>
          No account? <Link href="/signup" style={{ color: '#6366f1' }}>Sign up</Link>
        </p>
      </div>
    </div>
  )
}
