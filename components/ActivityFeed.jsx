'use client'
import { useState, useEffect, useRef } from 'react'

const TYPE_ICON = {
  thinking: '🧠',
  bash:     '💻',
  vm:       '🖥️',
  browser:  '🌐',
  search:   '🔍',
  complete: '✓',
  sent:     '→',
  observe:  '👁',
  error:    '✗',
}

const TYPE_COLOR = {
  thinking: '#a78bfa',
  bash:     '#34d399',
  vm:       '#60a5fa',
  browser:  '#f472b6',
  search:   '#fbbf24',
  complete: '#4ade80',
  sent:     '#94a3b8',
  observe:  '#c084fc',
  error:    '#f87171',
}

function StarField() {
  const [stars, setStars] = useState([])
  useEffect(() => {
    const s = []
    for (let i = 0; i < 160; i++) {
      s.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 0.4,
        opacity: Math.random() * 0.7 + 0.15,
        delay: Math.random() * 6,
        duration: Math.random() * 4 + 2,
        color: i % 12 === 0 ? '#c4b5fd' : i % 8 === 0 ? '#93c5fd' : '#fff',
      })
    }
    setStars(s)
  }, [])
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: var(--op); transform: scale(1); }
          50% { opacity: calc(var(--op) * 0.2); transform: scale(0.6); }
        }
        @keyframes moonGlow {
          0%, 100% { box-shadow: 0 0 18px 6px rgba(196,181,253,0.25); }
          50% { box-shadow: 0 0 28px 10px rgba(196,181,253,0.45); }
        }
      `}</style>
      {/* Moon */}
      <div style={{
        position: 'absolute', top: 18, right: 18,
        width: 28, height: 28, borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 35%, #f1f5f9, #c4b5fd)',
        boxShadow: '0 0 18px 6px rgba(196,181,253,0.25)',
        animation: 'moonGlow 4s ease-in-out infinite',
      }}>
        {/* Crater details */}
        <div style={{ position:'absolute', top:7, left:9, width:5, height:5, borderRadius:'50%', background:'rgba(0,0,0,0.1)' }}/>
        <div style={{ position:'absolute', top:14, left:5, width:3, height:3, borderRadius:'50%', background:'rgba(0,0,0,0.08)' }}/>
      </div>
      {stars.map((s, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${s.x}%`,
          top: `${s.y}%`,
          width: s.size,
          height: s.size,
          borderRadius: '50%',
          background: s.color,
          '--op': s.opacity,
          opacity: s.opacity,
          animation: `twinkle ${s.duration}s ${s.delay}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  )
}

export default function ActivityFeed() {
  const [events, setEvents] = useState([
    { id: 0, agent: 'System', type: 'observe', text: 'Monitoring agent activity...', ts: Date.now() },
  ])
  const bottomRef = useRef(null)
  const idRef = useRef(1)

  useEffect(() => {
    function onActivity(e) {
      const { agent, type, text } = e.detail || {}
      if (!text) return
      setEvents(prev => {
        const next = [...prev, { id: idRef.current++, agent, type, text, ts: Date.now() }]
        return next.slice(-60) // keep last 60
      })
    }
    window.addEventListener('agentActivity', onActivity)
    return () => window.removeEventListener('agentActivity', onActivity)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  function fmt(ts) {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div style={{
      width: 260,
      flexShrink: 0,
      background: 'linear-gradient(180deg, #050d1a 0%, #0a0a1a 60%, #080810 100%)',
      borderLeft: '1px solid #1e293b',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
      userSelect: 'none',
      pointerEvents: 'none',
    }}>
      <StarField />

      {/* Header */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '1px solid #1e293b',
        position: 'relative',
        zIndex: 1,
        background: 'rgba(5,13,26,0.7)',
        backdropFilter: 'blur(4px)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#475569', textTransform: 'uppercase' }}>
          Agent Activity
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: '#4ade80',
            boxShadow: '0 0 6px #4ade80',
            animation: 'pulse 2s ease-in-out infinite',
          }} />
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
          <span style={{ fontSize: 10, color: '#4ade80' }}>Live</span>
        </div>
      </div>

      {/* Feed */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 0',
        position: 'relative',
        zIndex: 1,
        scrollbarWidth: 'none',
      }}>
        <style>{`div::-webkit-scrollbar { display: none; }`}</style>
        {events.map(ev => (
          <div key={ev.id} style={{
            padding: '5px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10, color: TYPE_COLOR[ev.type] || '#94a3b8' }}>
                {TYPE_ICON[ev.type] || '·'}
              </span>
              <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.agent}
              </span>
              <span style={{ fontSize: 9, color: '#334155' }}>{fmt(ev.ts)}</span>
            </div>
            <div style={{
              fontSize: 10.5,
              color: '#94a3b8',
              lineHeight: 1.4,
              paddingLeft: 15,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}>
              {ev.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Bottom glow */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
        background: 'linear-gradient(transparent, rgba(99,102,241,0.06))',
        pointerEvents: 'none', zIndex: 2,
      }} />
    </div>
  )
}
