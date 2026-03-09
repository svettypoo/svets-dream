'use client'
import { Handle, Position } from '@xyflow/react'

const NODE_COLORS = {
  rules: { bg: '#1E293B', border: '#475569', text: '#F8FAFC', accent: '#94A3B8' },
  department: { bg: '#0C4A6E', border: '#0EA5E9', text: '#F0F9FF', accent: '#38BDF8' },
  agent: { bg: '#EFF6FF', border: '#0EA5E9', text: '#0F172A', accent: '#0EA5E9' },
}

export default function OrgNode({ data, selected }) {
  const chatMessage = data.chatMessage || null
  const colors = NODE_COLORS[data.nodeType] || NODE_COLORS.agent
  const isRules = data.nodeType === 'rules'
  const avatarUrl = !isRules
    ? `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(data.label)}&backgroundColor=0ea5e9,38bdf8,6366f1&backgroundType=gradientLinear`
    : null

  const isActive = !!data.isActive

  return (
    <div style={{ position: 'relative' }}>
      <style>{`
        @keyframes nodePopIn {
          0%{opacity:0;transform:scale(0.4) translateY(20px)}
          60%{transform:scale(1.08) translateY(-4px)}
          100%{opacity:1;transform:scale(1) translateY(0)}
        }
        @keyframes chatPop {
          0%{opacity:0;transform:translateX(-50%) scale(0.85)}
          60%{transform:translateX(-50%) scale(1.04)}
          100%{opacity:1;transform:translateX(-50%) scale(1)}
        }
        @keyframes spinGear{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes activePulse{
          0%,100%{box-shadow:0 0 0 3px rgba(16,185,129,0.3),0 4px 12px rgba(16,185,129,0.2)}
          50%{box-shadow:0 0 0 6px rgba(16,185,129,0.15),0 4px 20px rgba(16,185,129,0.4)}
        }
      `}</style>

      {/* Chat message bubble (inter-agent chatter) */}
      {chatMessage && !isRules && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 12, zIndex: 1000,
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
        border: `2px solid ${selected ? '#6366F1' : isActive ? '#10B981' : colors.border}`,
        borderRadius: isRules ? 8 : 12,
        padding: avatarUrl ? '8px 16px 12px' : '12px 16px',
        minWidth: isRules ? 220 : 190,
        maxWidth: isRules ? 300 : 240,
        cursor: 'pointer',
        boxShadow: selected
          ? '0 0 0 3px rgba(99,102,241,0.4)'
          : isActive
          ? undefined
          : `0 4px 12px rgba(14,165,233,${isRules ? '0.1' : '0.2'})`,
        animation: data.isNew
          ? 'nodePopIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
          : isActive ? 'activePulse 2s ease-in-out infinite' : 'none',
        transition: 'border-color 0.15s ease',
        position: 'relative',
      }}
    >
      {/* Spinning gear for active agents */}
      {isActive && !isRules && (
        <div style={{
          position: 'absolute', top: 6, right: 8,
          fontSize: 14, lineHeight: 1,
          animation: 'spinGear 1.5s linear infinite',
          transformOrigin: 'center',
        }}>⚙️</div>
      )}
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
          lineHeight: 1.5,
          maxHeight: 72,
          overflowY: 'auto',
          scrollbarWidth: 'none',
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
