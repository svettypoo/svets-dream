'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import BuilderChat from '@/components/BuilderChat'
import AgentModal from '@/components/AgentModal'
import { createClient } from '@/lib/supabase'

const OrgChart = dynamic(() => import('@/components/OrgChart'), { ssr: false })

export default function Dashboard() {
  const [orgData, setOrgData] = useState(null)
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [user, setUser] = useState(null)
  const chartRef = useRef(null)
  const chatRef = useRef(null)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
      else setUser(data.user)
    })
  }, [router])

  const rulesNode = orgData?.nodes?.find(n => n.id === 'rules')
  const rulesDescription = rulesNode?.description

  const handleOrgUpdate = useCallback(async (newOrg) => {
    setOrgData(newOrg)
    await new Promise(r => setTimeout(r, 1200))
    try {
      const dataUrl = await chartRef.current?.screenshot()
      if (!dataUrl) return
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
    } catch {}
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{
        height: 44, background: '#0f0f0f', borderBottom: '1px solid #222',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#a78bfa', letterSpacing: '-0.3px' }}>
          ✦ Svet's Dream
        </span>
        <span style={{ flex: 1 }} />
        <a href="/billing" style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, border: '1px solid #6366f130' }}>
          💳 Billing
        </a>
        <a href="/transactions" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, border: '1px solid #33333380' }}>
          📊 Transactions
        </a>
        <a href="/settings" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, border: '1px solid #33333380' }}>
          ⚙️ Settings
        </a>
        {user && (
          <span style={{ fontSize: 11, color: '#64748b' }}>{user.email}</span>
        )}
        <button onClick={handleSignOut} style={{
          fontSize: 11, color: '#ef4444', background: 'transparent', border: '1px solid #ef444430',
          padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
        }}>
          Sign out
        </button>
      </div>

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: Builder Chat */}
        <BuilderChat ref={chatRef} onOrgUpdate={handleOrgUpdate} />

        {/* Right: Org Chart */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ height: 48, borderBottom: '1px solid #1e293b', background: '#0f172a', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
              {orgData?.nodes?.length
                ? `${orgData.nodes.filter(n => n.id !== 'rules').length} agents · Click any node to chat`
                : 'Describe your org in the chat to get started'}
            </span>
            {orgData && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#a78bfa', background: '#a78bfa15', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>Live</span>
            )}
          </div>
          <OrgChart ref={chartRef} orgData={orgData} onNodeClick={setSelectedAgent} />
        </div>
      </div>

      {selectedAgent && (
        <AgentModal agent={selectedAgent} orgData={orgData} rulesDescription={rulesDescription} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  )
}
