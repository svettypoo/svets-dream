'use client'
import { Handle, Position } from '@xyflow/react'

const NODE_COLORS = {
  rules: { bg: '#1E293B', border: '#475569', text: '#F8FAFC', accent: '#94A3B8' },
  department: { bg: '#0C4A6E', border: '#0EA5E9', text: '#F0F9FF', accent: '#38BDF8' },
  agent: { bg: '#EFF6FF', border: '#0EA5E9', text: '#0F172A', accent: '#0EA5E9' },
}

export default function OrgNode({ data, selected }) {
  const colors = NODE_COLORS[data.nodeType] || NODE_COLORS.agent
  const isRules = data.nodeType === 'rules'

  return (
    <div
      onClick={data.onClick}
      style={{
        background: colors.bg,
        border: `2px solid ${selected ? '#6366F1' : colors.border}`,
        borderRadius: isRules ? 8 : 12,
        padding: '12px 16px',
        minWidth: isRules ? 200 : 160,
        maxWidth: isRules ? 260 : 200,
        cursor: 'pointer',
        boxShadow: selected
          ? '0 0 0 3px rgba(99,102,241,0.4)'
          : `0 4px 12px rgba(14,165,233,${isRules ? '0.1' : '0.2'})`,
        transition: 'all 0.15s ease',
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

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
  )
}
