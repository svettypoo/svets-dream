'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import BuilderChat from '@/components/BuilderChat'
import AgentModal from '@/components/AgentModal'
import ActivityFeed from '@/components/ActivityFeed'
import BuilderPreview from '@/components/BuilderPreview'
import { createClient } from '@/lib/supabase'
import { getPreset, DEFAULT_PRESET_ID } from '@/lib/org-presets'

const OrgChart = dynamic(() => import('@/components/OrgChart'), { ssr: false })

function getDefaultOrg() {
  const presetId = typeof window !== 'undefined'
    ? (localStorage.getItem('sd_default_org_preset') || DEFAULT_PRESET_ID)
    : DEFAULT_PRESET_ID
  return getPreset(presetId).org
}

let nextTabId = 2

function TabStrip({ tabs, activeTabId, onSelect, onAdd, onRename, onClose }) {
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef(null)

  function startEdit(tab) {
    setEditingId(tab.id)
    setEditValue(tab.name)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    if (editValue.trim()) onRename(editingId, editValue.trim())
    setEditingId(null)
  }

  return (
    <div style={{
      height: 36, background: 'rgba(5,13,26,0.98)', borderBottom: '1px solid #0f172a',
      display: 'flex', alignItems: 'stretch', gap: 0, flexShrink: 0, overflowX: 'auto',
      scrollbarWidth: 'none', paddingLeft: 4,
    }}>
      <style>{`div::-webkit-scrollbar{display:none}`}</style>
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          onDoubleClick={() => startEdit(tab)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 12px', cursor: 'pointer', flexShrink: 0,
            borderRight: '1px solid #0f172a',
            background: tab.id === activeTabId ? 'rgba(99,102,241,0.12)' : 'transparent',
            borderBottom: tab.id === activeTabId ? '2px solid #6366f1' : '2px solid transparent',
            transition: 'all 0.15s',
            position: 'relative',
          }}
        >
          <div style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: tab.orgData ? '#4ade80' : '#334155',
            boxShadow: tab.orgData ? '0 0 5px #4ade80' : 'none',
          }} />
          {editingId === tab.id ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null) }}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'transparent', border: 'none', outline: 'none',
                color: '#e2e8f0', fontSize: 12, fontWeight: 600, width: 90,
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <span style={{
              fontSize: 12, fontWeight: tab.id === activeTabId ? 600 : 400,
              color: tab.id === activeTabId ? '#e2e8f0' : '#64748b',
              maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {tab.name}
            </span>
          )}
          {tabs.length > 1 && (
            <button
              onClick={e => { e.stopPropagation(); onClose(tab.id) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#334155', fontSize: 13, padding: '0 2px', lineHeight: 1,
                display: 'flex', alignItems: 'center',
              }}
              title="Close tab"
            >×</button>
          )}
        </div>
      ))}
      <button
        onClick={onAdd}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#475569', fontSize: 18, padding: '0 14px',
          display: 'flex', alignItems: 'center', lineHeight: 1,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#a78bfa'}
        onMouseLeave={e => e.currentTarget.style.color = '#475569'}
        title="New project"
      >+</button>
    </div>
  )
}

export default function Dashboard() {
  const [tabs, setTabs] = useState(() => [{ id: 1, name: 'Project 1', orgData: getDefaultOrg(), builderActive: false }])
  const [activeTabId, setActiveTabId] = useState(1)
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [user, setUser] = useState(null)
  const chartRef = useRef(null)
  const chatRef = useRef(null)
  const router = useRouter()

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
      else setUser(data.user)
    })
  }, [router])

  // Show BuilderPreview when agents start executing on active tab
  useEffect(() => {
    function onBuild() {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, builderActive: true } : t))
    }
    window.addEventListener('builderUpdate', onBuild)
    return () => window.removeEventListener('builderUpdate', onBuild)
  }, [activeTabId])

  function updateTab(id, updates) {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }

  function addTab() {
    const id = nextTabId++
    const name = `Project ${id}`
    setTabs(prev => [...prev, { id, name, orgData: getDefaultOrg(), builderActive: false }])
    setActiveTabId(id)
    setSelectedAgent(null)
  }

  function closeTab(id) {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (activeTabId === id) setActiveTabId(next[next.length - 1]?.id || next[0]?.id)
      return next
    })
    setSelectedAgent(null)
  }

  function renameTab(id, name) {
    updateTab(id, { name })
  }

  function selectTab(id) {
    setActiveTabId(id)
    setSelectedAgent(null)
  }

  const rulesNode = activeTab?.orgData?.nodes?.find(n => n.id === 'rules')
  const rulesDescription = rulesNode?.description

  const handleOrgUpdate = useCallback(async (newOrg) => {
    updateTab(activeTabId, { orgData: newOrg })
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
  }, [activeTabId])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', flexDirection: 'column', background: '#050d1a' }}>
      <style>{`
        @keyframes drift { 0%{transform:translateY(0)} 50%{transform:translateY(-8px)} 100%{transform:translateY(0)} }
        @keyframes shootingstar { 0%{transform:translateX(0) translateY(0);opacity:1} 100%{transform:translateX(200px) translateY(80px);opacity:0} }
      `}</style>

      {/* Top bar */}
      <div style={{
        height: 44, background: 'rgba(5,13,26,0.95)', borderBottom: '1px solid #0f172a',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
        backdropFilter: 'blur(8px)',
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#a78bfa', letterSpacing: '-0.3px' }}>
          ✦ Svet's Dream
        </span>
        <span style={{ flex: 1 }} />
        <a href="/billing" style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, border: '1px solid #6366f130' }}>💳 Billing</a>
        <a href="/transactions" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, border: '1px solid #33333380' }}>📊 Transactions</a>
        <a href="/vm" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, border: '1px solid #33333380' }}>🖥️ VMs</a>
        <a href="/settings" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, border: '1px solid #33333380' }}>⚙️ Settings</a>
        <a href="/setup" style={{ fontSize: 12, color: '#f59e0b', textDecoration: 'none', padding: '4px 10px', borderRadius: 6, border: '1px solid #f59e0b30' }}>🚀 Setup</a>
        {user && <span style={{ fontSize: 11, color: '#64748b' }}>{user.email}</span>}
        <button onClick={handleSignOut} style={{ fontSize: 11, color: '#ef4444', background: 'transparent', border: '1px solid #ef444430', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>
          Sign out
        </button>
      </div>

      {/* Tab strip */}
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={selectTab}
        onAdd={addTab}
        onRename={renameTab}
        onClose={closeTab}
      />

      {/* Main layout — key on activeTabId so BuilderChat/OrgChart remount fresh per tab */}
      <div key={activeTabId} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: Builder Chat */}
        <BuilderChat ref={chatRef} onOrgUpdate={handleOrgUpdate} />

        {/* Center: Org Chart */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div style={{ height: 48, borderBottom: '1px solid #0f172a', background: 'rgba(5,13,26,0.9)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
              {activeTab?.orgData?.nodes?.length
                ? `${activeTab.orgData.nodes.filter(n => n.id !== 'rules').length} agents · Click any node to chat`
                : 'Describe your org in the chat to get started'}
            </span>
            {activeTab?.orgData && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#a78bfa', background: '#a78bfa15', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>Live</span>
            )}
          </div>
          <OrgChart ref={chartRef} orgData={activeTab?.orgData} onNodeClick={setSelectedAgent} />
        </div>

        {/* Build Preview — slides in when agents start executing */}
        <BuilderPreview visible={activeTab?.builderActive} />

        {/* Right: Activity Feed */}
        <ActivityFeed />
      </div>

      {selectedAgent && (
        <AgentModal
          agent={selectedAgent}
          orgData={activeTab?.orgData}
          rulesDescription={rulesDescription}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
