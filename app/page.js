'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import BuilderChat from '@/components/BuilderChat'
import AgentModal from '@/components/AgentModal'

// React Flow must be client-side only
const OrgChart = dynamic(() => import('@/components/OrgChart'), { ssr: false })

export default function Home() {
  const [orgData, setOrgData] = useState(null)
  const [selectedAgent, setSelectedAgent] = useState(null)

  const rulesNode = orgData?.nodes?.find(n => n.id === 'rules')
  const rulesDescription = rulesNode?.description

  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden',
    }}>
      {/* Left: Builder Chat */}
      <BuilderChat onOrgUpdate={setOrgData} />

      {/* Right: Org Chart */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          height: 48, borderBottom: '1px solid #BAE6FD', background: '#EFF6FF',
          display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12,
        }}>
          <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>
            {orgData?.nodes?.length
              ? `${orgData.nodes.filter(n => n.id !== 'rules').length} agents · Click any node to chat`
              : 'Describe your org in the chat to get started'}
          </span>
          {orgData && (
            <span style={{
              marginLeft: 'auto', fontSize: 11, color: '#0EA5E9',
              background: '#E0F2FE', padding: '3px 10px', borderRadius: 20, fontWeight: 600,
            }}>
              Live
            </span>
          )}
        </div>

        {/* Chart */}
        <OrgChart orgData={orgData} onNodeClick={setSelectedAgent} />
      </div>

      {/* Agent Chat Modal */}
      {selectedAgent && (
        <AgentModal
          agent={selectedAgent}
          orgData={orgData}
          rulesDescription={rulesDescription}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
