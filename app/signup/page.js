'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({ email, password })
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
        @keyframes float1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(15px,-25px)} }
        @keyframes float2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-12px,18px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        .signup-input:focus { outline: none; border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important; }
        .signup-btn:hover:not(:disabled) { background: #7c3aed !important; transform: translateY(-1px); box-shadow: 0 8px 25px rgba(99,102,241,0.4) !important; }
        .signup-btn { transition: all 0.2s; }
      `}</style>

      <div style={{ position: 'absolute', top: '-15%', right: '-10%', width: 450, height: 450, background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)', animation: 'float1 9s ease-in-out infinite', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-10%', left: '-10%', width: 350, height: 350, background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)', animation: 'float2 11s ease-in-out infinite', pointerEvents: 'none' }} />

      <div style={{
        background: 'rgba(10,18,35,0.85)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 20, padding: '44px 40px',
        width: '100%', maxWidth: 420,
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(99,102,241,0.15)',
        animation: 'fadeUp 0.5s ease-out',
      }}>
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
            Create your agent organization account
          </p>
        </div>

        <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} required
            className="signup-input"
            style={{
              padding: '11px 14px', borderRadius: 10,
              border: '1px solid rgba(99,102,241,0.2)',
              background: 'rgba(6,13,27,0.8)', color: '#e2e8f0',
              fontSize: 14, width: '100%', boxSizing: 'border-box', transition: 'all 0.2s',
            }}
          />
          <input
            type="password" placeholder="Password (min 8 chars)" value={password}
            onChange={e => setPassword(e.target.value)} required minLength={8}
            className="signup-input"
            style={{
              padding: '11px 14px', borderRadius: 10,
              border: '1px solid rgba(99,102,241,0.2)',
              background: 'rgba(6,13,27,0.8)', color: '#e2e8f0',
              fontSize: 14, width: '100%', boxSizing: 'border-box', transition: 'all 0.2s',
            }}
          />

          {error && (
            <div style={{
              color: '#fca5a5', fontSize: 13, padding: '10px 14px',
              background: 'rgba(239,68,68,0.1)', borderRadius: 8,
              border: '1px solid rgba(239,68,68,0.2)',
            }}>{error}</div>
          )}

          <button type="submit" disabled={loading} className="signup-btn"
            style={{
              padding: '12px', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1,
              marginTop: 4,
              boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
            }}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ color: '#475569', fontSize: 13, marginTop: 22, textAlign: 'center' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 500 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
