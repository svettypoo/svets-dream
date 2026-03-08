'use client'
import { useState, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import BuilderChat from '@/components/BuilderChat'
import AgentModal from '@/components/AgentModal'

const OrgChart = dynamic(() => import('@/components/OrgChart'), { ssr: false })

export default function Home() {
  const [orgData, setOrgData] = useState(null)
  const [selectedAgent, setSelectedAgent] = useState(null)
  const chartRef = useRef(null)
  const chatRef = useRef(null)

  const rulesNode = orgData?.nodes?.find(n => n.id === 'rules')
  const rulesDescription = rulesNode?.description

  // After every org update: wait for render, screenshot, assess, inject into chat
  const handleOrgUpdate = useCallback(async (newOrg) => {
    setOrgData(newOrg)

    // Wait for React Flow to render the new layout
    await new Promise(r => setTimeout(r, 1200))

    try {
      const dataUrl = await chartRef.current?.screenshot()
      if (!dataUrl) return

      // Strip data: prefix — API expects raw base64
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')

      const res = await fetch('/api/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64,
          context: `Org has ${newOrg.nodes?.length} nodes including ${newOrg.nodes?.filter(n => n.id !== 'rules').map(n => n.label).join(', ')}`,
          question: 'Does this AI agent org chart look correct and complete? Check all nodes are visible, connections make sense, and the Rules node is present.',
        }),
      })

      const result = await res.json()
      chatRef.current?.addScreenshotMessage({
        screenshot: dataUrl,
        assessment: result.assessment,
        passed: result.passed,
      })
    } catch {
      // Silent — never surface screenshot errors to user
    }
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Left: Builder Chat */}
      <BuilderChat ref={chatRef} onOrgUpdate={handleOrgUpdate} />

      {/* Right: Org Chart */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ height: 48, borderBottom: '1px solid #BAE6FD', background: '#EFF6FF', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>
            {orgData?.nodes?.length
              ? `${orgData.nodes.filter(n => n.id !== 'rules').length} agents · Click any node to chat`
              : 'Describe your org in the chat to get started'}
          </span>
          {orgData && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#0EA5E9', background: '#E0F2FE', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>Live</span>
          )}
        </div>
        <OrgChart ref={chartRef} orgData={orgData} onNodeClick={setSelectedAgent} />
      </div>

      {selectedAgent && (
        <AgentModal agent={selectedAgent} orgData={orgData} rulesDescription={rulesDescription} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  )
}
