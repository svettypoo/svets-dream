'use client'
import { useEffect, useState } from 'react'
import { Handle, Position } from '@xyflow/react'

const NODE_COLORS = {
  rules: { bg: '#1E293B', border: '#475569', text: '#F8FAFC', accent: '#94A3B8' },
  department: { bg: '#0C4A6E', border: '#0EA5E9', text: '#F0F9FF', accent: '#38BDF8' },
  agent: { bg: '#EFF6FF', border: '#0EA5E9', text: '#0F172A', accent: '#0EA5E9' },
}

function shortIntro(description, label) {
  if (!description) return `Hi, I'm ${label}.`
  const first = description.split(/[.!]\s/)[0].trim()
  return first.length > 90 ? first.slice(0, 90) + '…' : first + '.'
}

export default function OrgNode({ data, selected }) {
  const [bubbleVisible, setBubbleVisible] = useState(!!data.isNew)

  useEffect(() => {
    if (!data.isNew) return
    setBubbleVisible(true)
    const t = setTimeout(() => setBubbleVisible(false), 5000)
    return () => clearTimeout(t)
  }, [data.isNew])

  const chatMessage = data.chatMessage || null
  const colors = NODE_COLORS[data.nodeType] || NODE_COLORS.agent
  const isRules = data.nodeType === 'rules'
  const avatarUrl = !isRules
    ? `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(data.label)}&backgroundColor=0ea5e9,38bdf8,6366f1&backgroundType=gradientLinear`
    : null

  return (
    <div style={{ position: 'relative' }}>
      <style>{`
        @keyframes nodePopIn {
          0% { opacity: 0; transform: scale(0.4) translateY(20px); }
          60% { transform: scale(1.08) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes bubbleFadeIn {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes bubbleFadeOut {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes chatPop {
          0% { opacity: 0; transform: translateX(-50%) scale(0.85); }
          60% { transform: translateX(-50%) scale(1.04); }
          100% { opacity: 1; transform: translateX(-50%) scale(1); }
        }
      `}</style>

      {/* Speech bubble */}
      {bubbleVisible && !isRules && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 12, zIndex: 999,
          animation: 'bubbleFadeIn 0.35s ease forwards',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: '#1e1b4b',
            border: '1px solid #6366f1',
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 11.5,
            color: '#c7d2fe',
            maxWidth: 210,
            lineHeight: 1.5,
            boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
            whiteSpace: 'normal',
            textAlign: 'center',
          }}>
            {shortIntro(data.description, data.label)}
          </div>
          {/* Triangle pointer */}
          <div style={{
            width: 0, height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: '7px solid #6366f1',
            margin: '0 auto',
          }} />
        </div>
      )}

      {/* Chat message bubble (inter-agent chatter) */}
      {chatMessage && !isRules && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: bubbleVisible ? 80 : 12, zIndex: 1000,
          animation: 'chatPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid #0EA5E9',
            borderRadius: 10,
            padding: '7px 11px',
            fontSize: 11,
            color: '#7dd3fc',
            maxWidth: 200,
            lineHeight: 1.5,
            boxShadow: '0 4px 16px rgba(14,165,233,0.35)',
            whiteSpace: 'normal',
            textAlign: 'left',
          }}>
            <span style={{ fontSize: 9, color: '#0EA5E9', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>{data.label}</span>
            {chatMessage}
          </div>
          <div style={{
            width: 0, height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid #0EA5E9',
            margin: '0 auto',
          }} />
        </div>
      )}

    <div
      onClick={data.onClick}
      style={{
        background: colors.bg,
        border: `2px solid ${selected ? '#6366F1' : colors.border}`,
        borderRadius: isRules ? 8 : 12,
        padding: avatarUrl ? '8px 16px 12px' : '12px 16px',
        minWidth: isRules ? 200 : 160,
        maxWidth: isRules ? 260 : 200,
        cursor: 'pointer',
        boxShadow: selected
          ? '0 0 0 3px rgba(99,102,241,0.4)'
          : `0 4px 12px rgba(14,165,233,${isRules ? '0.1' : '0.2'})`,
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
        position: 'relative',
        animation: data.isNew ? 'nodePopIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      {/* Avatar face */}
      {avatarUrl && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <img
            src={avatarUrl}
            alt={data.label}
            style={{
              width: 52, height: 52, borderRadius: '50%',
              border: `2px solid ${colors.border}`,
              background: '#fff', flexShrink: 0,
            }}
          />
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: colors.accent, flexShrink: 0,
        }} />
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.05em', color: colors.accent,
        }}>
          {isRules ? 'Rules' : data.role}
        </span>
      </div>

      {/* Name */}
      <div style={{
        fontSize: 14, fontWeight: 700, color: colors.text,
        marginBottom: isRules ? 8 : 4, lineHeight: 1.3,
      }}>
        {data.label}
      </div>

      {/* Description preview */}
      {isRules ? (
        <div style={{ fontSize: 11, color: colors.accent, lineHeight: 1.5 }}>
          {data.description?.split('\n').slice(0, 4).map((line, i) => (
            <div key={i} style={{ marginBottom: 2 }}>• {line.replace(/^[-•]\s*/, '')}</div>
          ))}
        </div>
      ) : (
        <div style={{
          fontSize: 11, color: colors.text === '#0F172A' ? '#64748B' : 'rgba(255,255,255,0.6)',
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {data.description}
        </div>
      )}

      {/* Click hint */}
      {!isRules && (
        <div style={{
          marginTop: 8, fontSize: 10, color: colors.accent,
          opacity: 0.7, fontStyle: 'italic',
        }}>
          Click to chat →
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
    </div>
  )
}
