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
    if (remember) localStorage.setItem(STORAGE_KEY, JSON.stringify({ email, password }))
    else localStorage.removeItem(STORAGE_KEY)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else router.push('/dashboard')
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse 120% 120% at 50% -20%, #0f1e3a 0%, #060d1b 50%, #03080f 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflow: 'hidden', position: 'relative',
    }}>
      <style>{`
        @keyframes float1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(20px,-30px) scale(1.05)} }
        @keyframes float2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-15px,20px)} }
        @keyframes shimmer { 0%{opacity:0.4} 50%{opacity:0.9} 100%{opacity:0.4} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        .login-input { transition: border-color 0.2s, box-shadow 0.2s; }
        .login-input:focus { outline: none; border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important; }
        .login-btn:hover:not(:disabled) { background: #7c3aed !important; transform: translateY(-1px); box-shadow: 0 8px 25px rgba(99,102,241,0.4) !important; }
        .login-btn { transition: all 0.2s; }
      `}</style>

      {/* Background glow orbs */}
      <div style={{
        position: 'absolute', top: '-15%', left: '-10%', width: 500, height: 500,
        background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
        animation: 'float1 8s ease-in-out infinite', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-10%', right: '-10%', width: 400, height: 400,
        background: 'radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)',
        animation: 'float2 10s ease-in-out infinite', pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        background: 'rgba(10,18,35,0.85)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 20, padding: '44px 40px',
        width: '100%', maxWidth: 420,
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(99,102,241,0.15)',
        animation: 'fadeUp 0.5s ease-out',
      }}>
        {/* Logo area */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
            marginBottom: 16, fontSize: 24,
          }}>✦</div>
          <h1 style={{ color: '#f1f5f9', margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px' }}>
            Svet&apos;s Dream
          </h1>
          <p style={{ color: '#475569', margin: '6px 0 0', fontSize: 14 }}>
            Sign in to your agent organization
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} required
            className="login-input"
            style={{
              padding: '11px 14px', borderRadius: 10,
              border: '1px solid rgba(99,102,241,0.2)',
              background: 'rgba(6,13,27,0.8)', color: '#e2e8f0',
              fontSize: 14, width: '100%', boxSizing: 'border-box',
            }}
          />
          <input
            type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} required
            className="login-input"
            style={{
              padding: '11px 14px', borderRadius: 10,
              border: '1px solid rgba(99,102,241,0.2)',
              background: 'rgba(6,13,27,0.8)', color: '#e2e8f0',
              fontSize: 14, width: '100%', boxSizing: 'border-box',
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: '#6366f1', cursor: 'pointer' }} />
            <span style={{ color: '#64748b', fontSize: 13 }}>Remember me</span>
          </label>

          {error && (
            <div style={{
              color: '#fca5a5', fontSize: 13, padding: '10px 14px',
              background: 'rgba(239,68,68,0.1)', borderRadius: 8,
              border: '1px solid rgba(239,68,68,0.2)',
            }}>{error}</div>
          )}

          <button type="submit" disabled={loading} className="login-btn"
            style={{
              padding: '12px', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1,
              marginTop: 4,
              boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
              letterSpacing: '0.2px',
            }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ color: '#475569', fontSize: 13, marginTop: 22, textAlign: 'center' }}>
          No account?{' '}
          <Link href="/signup" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 500 }}>
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
