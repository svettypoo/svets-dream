'use client'
import { useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, MarkerType,
  ReactFlowProvider,
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
  const NODE_W = 220, NODE_H = 130, H_GAP = 40, V_GAP = 80
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
    if (n.parentId && n.parentId !== 'rules') {
      edges.push({
        id: `e-${n.parentId}-${n.id}`, source: n.parentId, target: n.id, type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#0EA5E9' },
        style: { stroke: '#0EA5E9', strokeWidth: 1.5 },
      })
    }
  }
  return { nodes: positioned, edges }
}

const OrgChartInner = forwardRef(function OrgChartInner({ orgData, onNodeClick, introNodeIds = new Set(), agentChats = {} }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const containerRef = useRef(null)

  useImperativeHandle(ref, () => ({
    async screenshot() {
      const el = containerRef.current
      if (!el) return null
      try {
        return await toPng(el, { backgroundColor: '#F0F9FF', quality: 0.95, pixelRatio: 1.5 })
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
  }, [orgData, introNodeIds, agentChats])

  const nodeTypes = useMemo(() => NODE_TYPES, [])

  if (!orgData?.nodes?.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20, background: '#070d1c' }}>
        <style>{`
          @keyframes nodeFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
          @keyframes linePulse { 0%,100%{opacity:0.2} 50%{opacity:0.6} }
        `}</style>
        {/* Abstract org chart SVG */}
        <svg width="180" height="120" viewBox="0 0 180 120" fill="none">
          {/* Lines */}
          <line x1="90" y1="28" x2="40" y2="68" stroke="#6366f1" strokeWidth="1.5" style={{animation:'linePulse 2.5s ease-in-out infinite'}}/>
          <line x1="90" y1="28" x2="90" y2="68" stroke="#6366f1" strokeWidth="1.5" style={{animation:'linePulse 2.5s 0.3s ease-in-out infinite'}}/>
          <line x1="90" y1="28" x2="140" y2="68" stroke="#6366f1" strokeWidth="1.5" style={{animation:'linePulse 2.5s 0.6s ease-in-out infinite'}}/>
          {/* Top node */}
          <rect x="68" y="8" width="44" height="22" rx="6" fill="rgba(99,102,241,0.25)" stroke="#6366f1" strokeWidth="1.5" style={{animation:'nodeFloat 3s ease-in-out infinite'}}/>
          <rect x="75" y="14" width="14" height="3" rx="1.5" fill="#a78bfa"/>
          <rect x="75" y="20" width="22" height="2" rx="1" fill="rgba(167,139,250,0.4)"/>
          {/* Bottom nodes */}
          {[18,68,118].map((x, i) => (
            <g key={i} style={{animation:`nodeFloat 3s ${i*0.4}s ease-in-out infinite`}}>
              <rect x={x} y="68" width="44" height="22" rx="6" fill="rgba(99,102,241,0.12)" stroke="rgba(99,102,241,0.4)" strokeWidth="1"/>
              <rect x={x+7} y="74" width="10" height="3" rx="1.5" fill="rgba(167,139,250,0.6)"/>
              <rect x={x+7} y="80" width="18" height="2" rx="1" fill="rgba(167,139,250,0.25)"/>
            </g>
          ))}
        </svg>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.2px' }}>Tell us what you want to build</div>
          <div style={{ fontSize: 12, color: '#334155', marginTop: 5 }}>Your team will assemble here</div>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ flex: 1, height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.3} maxZoom={2}>
        <Background color="#0f172a" gap={24} size={1} />
        <Controls style={{ background: '#0d1526', border: '1px solid #1e293b' }} />
        <MiniMap nodeColor={n => n.data?.nodeType === 'rules' ? '#334155' : '#6366f1'}
          style={{ background: '#0d1526', border: '1px solid #1e293b' }} />
      </ReactFlow>
    </div>
  )
})

const OrgChart = forwardRef(function OrgChart({ introNodeIds, agentChats, ...props }, ref) {
  return (
    <ReactFlowProvider>
      <OrgChartInner {...props} introNodeIds={introNodeIds} agentChats={agentChats} ref={ref} />
    </ReactFlowProvider>
  )
})

export default OrgChart
