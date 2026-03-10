'use client'
import { useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react'
import {
  ReactFlow, Background, Controls,
  useNodesState, useEdgesState, MarkerType,
  ReactFlowProvider, useReactFlow,
} from '@xyflow/react'
import { toPng } from 'html-to-image'
import '@xyflow/react/dist/style.css'
import OrgNode from './OrgNode'

const NODE_TYPES = { orgNode: OrgNode }

function layoutNodes(rawNodes) {
  if (!rawNodes?.length) return { nodes: [], edges: [] }
  const rulesNode = rawNodes.find(n => n.type === 'rules' || n.id === 'rules')
  const orgNodes = rawNodes.filter(n => n.id !== 'rules')
  const levels = {}
  for (const n of orgNodes) {
    const lvl = n.level ?? 0
    if (!levels[lvl]) levels[lvl] = []
    levels[lvl].push(n)
  }
  const NODE_W = 260, NODE_H = 160, H_GAP = 50, V_GAP = 100
  const positioned = []
  const maxLevel = Math.max(...Object.keys(levels).map(Number))
  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const group = levels[lvl] || []
    const totalW = group.length * NODE_W + (group.length - 1) * H_GAP
    const startX = -totalW / 2
    group.forEach((n, i) => {
      positioned.push({
        id: n.id, type: 'orgNode',
        position: { x: startX + i * (NODE_W + H_GAP), y: lvl * (NODE_H + V_GAP) + 40 },
        data: { label: n.label, role: n.role, description: n.description, nodeType: n.type || 'agent', nodeId: n.id },
      })
    })
  }
  if (rulesNode) {
    const rightmostX = positioned.reduce((max, n) => Math.max(max, n.position.x), 0)
    positioned.push({
      id: 'rules', type: 'orgNode',
      position: { x: rightmostX + NODE_W + 60, y: 40 },
      data: { label: rulesNode.label || 'Global Rules', role: 'System Rules', description: rulesNode.description, nodeType: 'rules', nodeId: 'rules' },
    })
  }
  const edges = []
  for (const n of orgNodes) {
    // Support both parentId (single) and parentIds (array)
    const parents = n.parentIds?.length ? n.parentIds : (n.parentId ? [n.parentId] : [])
    for (const pid of parents) {
      if (pid && pid !== 'rules') {
        edges.push({
          id: `e-${pid}-${n.id}`, source: pid, target: n.id, type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#0EA5E9' },
          style: { stroke: '#0EA5E9', strokeWidth: 1.5 },
        })
      }
    }
  }
  return { nodes: positioned, edges }
}

const EMPTY_SET = new Set()

const OrgChartInner = forwardRef(function OrgChartInner({ orgData, onNodeClick, introNodeIds = EMPTY_SET, agentChats = {}, activeAgents = EMPTY_SET }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const containerRef = useRef(null)
  const { fitView } = useReactFlow()

  // Stable key for activeAgents set — only triggers re-render when the set contents change
  const activeAgentsKey = useMemo(() => [...activeAgents].sort().join(','), [activeAgents])

  useImperativeHandle(ref, () => ({
    async screenshot() {
      const el = containerRef.current
      if (!el) return null
      try {
        return await toPng(el, { backgroundColor: '#F0F9FF', quality: 0.8, pixelRatio: 1.0 })
      } catch { return null }
    }
  }))

  useEffect(() => {
    if (!orgData?.nodes?.length) return
    const { nodes: laid, edges: edged } = layoutNodes(orgData.nodes)
    const withClick = laid.map(n => ({
      ...n,
      data: {
        ...n.data,
        isNew: introNodeIds.has(n.data.nodeId),
        chatMessage: agentChats[n.data.nodeId] || null,
        onClick: n.data.nodeType !== 'rules'
          ? () => onNodeClick(orgData.nodes.find(raw => raw.id === n.data.nodeId))
          : undefined,
      },
    }))
    setNodes(withClick)
    setEdges(edged)
    // Refit after nodes render — double rAF ensures DOM has updated
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fitView({ padding: 0.28, maxZoom: 0.78 })
    }))
  }, [orgData, introNodeIds, agentChats]) // eslint-disable-line react-hooks/exhaustive-deps

  // Separately update isActive without re-running full layout
  useEffect(() => {
    setNodes(prev => prev.map(n => ({
      ...n,
      data: { ...n.data, isActive: activeAgents.has(n.data.nodeId) },
    })))
  }, [activeAgentsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const nodeTypes = useMemo(() => NODE_TYPES, [])

  if (!orgData?.nodes?.length) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 24,
        background: 'radial-gradient(ellipse 80% 80% at 50% 50%, rgba(99,102,241,0.05) 0%, #070d1c 70%)',
      }}>
        <style>{`
          @keyframes nodeFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
          @keyframes linePulse { 0%,100%{opacity:0.15} 50%{opacity:0.5} }
          @keyframes orgGlow { 0%,100%{filter:drop-shadow(0 0 8px rgba(99,102,241,0.3))} 50%{filter:drop-shadow(0 0 16px rgba(99,102,241,0.6))} }
        `}</style>
        {/* Abstract org chart SVG — larger, more detailed */}
        <svg width="220" height="160" viewBox="0 0 220 160" fill="none" style={{animation:'orgGlow 4s ease-in-out infinite'}}>
          {/* Connection lines */}
          <line x1="110" y1="38" x2="45" y2="90" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 2" style={{animation:'linePulse 2.5s ease-in-out infinite'}}/>
          <line x1="110" y1="38" x2="110" y2="90" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 2" style={{animation:'linePulse 2.5s 0.25s ease-in-out infinite'}}/>
          <line x1="110" y1="38" x2="175" y2="90" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 2" style={{animation:'linePulse 2.5s 0.5s ease-in-out infinite'}}/>
          <line x1="45" y1="112" x2="20" y2="140" stroke="#8b5cf6" strokeWidth="1" strokeDasharray="3 2" style={{animation:'linePulse 3s 0.3s ease-in-out infinite'}}/>
          <line x1="45" y1="112" x2="65" y2="140" stroke="#8b5cf6" strokeWidth="1" strokeDasharray="3 2" style={{animation:'linePulse 3s 0.6s ease-in-out infinite'}}/>
          {/* CTO node */}
          <rect x="82" y="10" width="56" height="28" rx="8" fill="rgba(99,102,241,0.3)" stroke="#6366f1" strokeWidth="1.5" style={{animation:'nodeFloat 3s ease-in-out infinite'}}/>
          <rect x="92" y="18" width="20" height="3" rx="1.5" fill="#a78bfa"/>
          <rect x="92" y="25" width="30" height="2" rx="1" fill="rgba(167,139,250,0.5)"/>
          {/* Level 1 nodes */}
          {[17, 82, 147].map((x, i) => (
            <g key={i} style={{animation:`nodeFloat 3s ${i*0.35}s ease-in-out infinite`}}>
              <rect x={x} y="90" width="56" height="22" rx="6" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" strokeWidth="1"/>
              <rect x={x+10} y="96" width="14" height="3" rx="1.5" fill="rgba(167,139,250,0.7)"/>
              <rect x={x+10} y="103" width="24" height="2" rx="1" fill="rgba(167,139,250,0.3)"/>
            </g>
          ))}
          {/* Level 2 mini nodes */}
          {[8, 53].map((x, i) => (
            <rect key={i} x={x} y="140" width="34" height="14" rx="4" fill="rgba(139,92,246,0.12)" stroke="rgba(139,92,246,0.3)" strokeWidth="1" style={{animation:`nodeFloat 4s ${i*0.5}s ease-in-out infinite`}}/>
          ))}
        </svg>

        <div style={{ textAlign: 'center', maxWidth: 240 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#c4b5fd', letterSpacing: '-0.3px', marginBottom: 8 }}>
            Your AI team assembles here
          </div>
          <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7 }}>
            Describe what you want to build in the chat. The CTO will design your agent organization.
          </div>
        </div>

        {/* Feature hints */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {[
            { icon: '🤝', label: 'Multi-agent' },
            { icon: '⚡', label: 'Live execution' },
            { icon: '🚀', label: 'Auto-deploy' },
          ].map(({ icon, label }) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 20,
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)',
              fontSize: 11, color: '#64748b',
            }}>
              <span>{icon}</span> {label}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ flex: 1, height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes} minZoom={0.2} maxZoom={2} defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}>
        <Background color="#0f172a" gap={24} size={1} />
        <Controls style={{ background: '#0d1526', border: '1px solid #1e293b' }} />
      </ReactFlow>
    </div>
  )
})

const OrgChart = forwardRef(function OrgChart({ introNodeIds, agentChats, activeAgents, ...props }, ref) {
  return (
    <ReactFlowProvider>
      <OrgChartInner {...props} introNodeIds={introNodeIds} agentChats={agentChats} activeAgents={activeAgents} ref={ref} />
    </ReactFlowProvider>
  )
})

export default OrgChart
