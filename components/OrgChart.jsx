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

const OrgChartInner = forwardRef(function OrgChartInner({ orgData, onNodeClick }, ref) {
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
        onClick: n.data.nodeType !== 'rules'
          ? () => onNodeClick(orgData.nodes.find(raw => raw.id === n.data.nodeId))
          : undefined,
      },
    }))
    setNodes(withClick)
    setEdges(edged)
  }, [orgData])

  const nodeTypes = useMemo(() => NODE_TYPES, [])

  if (!orgData?.nodes?.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#94A3B8' }}>
        <div style={{ fontSize: 48 }}>🏢</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Describe your organization</div>
        <div style={{ fontSize: 13 }}>Your agent corporate structure will appear here</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ flex: 1, height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.3} maxZoom={2}>
        <Background color="#BAE6FD" gap={24} size={1} />
        <Controls style={{ background: '#EFF6FF', border: '1px solid #BAE6FD' }} />
        <MiniMap nodeColor={n => n.data?.nodeType === 'rules' ? '#1E293B' : '#0EA5E9'}
          style={{ background: '#EFF6FF', border: '1px solid #BAE6FD' }} />
      </ReactFlow>
    </div>
  )
})

const OrgChart = forwardRef(function OrgChart(props, ref) {
  return (
    <ReactFlowProvider>
      <OrgChartInner {...props} ref={ref} />
    </ReactFlowProvider>
  )
})

export default OrgChart
