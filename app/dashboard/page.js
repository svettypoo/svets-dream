'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import BuilderChat from '@/components/BuilderChat'
import AgentModal from '@/components/AgentModal'
import ActivityFeed from '@/components/ActivityFeed'
import BuilderPreview from '@/components/BuilderPreview'
import TasksPanel from '@/components/TasksPanel'
import WorkflowsPanel from '@/components/WorkflowsPanel'
import { createClient } from '@/lib/supabase'
import { getPreset, DEFAULT_PRESET_ID } from '@/lib/org-presets'

const OrgChart = dynamic(() => import('@/components/OrgChart'), {
  ssr: false,
  loading: () => (
    <div style={{
      flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 20,
      background: 'radial-gradient(ellipse 80% 80% at 50% 50%, rgba(99,102,241,0.06) 0%, #070d1c 65%)',
    }}>
      <svg width="220" height="160" viewBox="0 0 220 160" fill="none" style={{opacity:0.5}}>
        <line x1="110" y1="38" x2="45" y2="90" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 2"/>
        <line x1="110" y1="38" x2="110" y2="90" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 2"/>
        <line x1="110" y1="38" x2="175" y2="90" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 2"/>
        <rect x="82" y="10" width="56" height="28" rx="8" fill="rgba(99,102,241,0.3)" stroke="#6366f1" strokeWidth="1.5"/>
        <rect x="92" y="18" width="20" height="3" rx="1.5" fill="#a78bfa"/>
        <rect x="92" y="25" width="30" height="2" rx="1" fill="rgba(167,139,250,0.5)"/>
        {[17, 82, 147].map((x, i) => (
          <g key={i}><rect x={x} y="90" width="56" height="22" rx="6" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" strokeWidth="1"/>
          <rect x={x+10} y="96" width="14" height="3" rx="1.5" fill="rgba(167,139,250,0.7)"/>
          <rect x={x+10} y="103" width="24" height="2" rx="1" fill="rgba(167,139,250,0.3)"/></g>
        ))}
      </svg>
      <div style={{ textAlign: 'center', maxWidth: 240 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#c4b5fd', marginBottom: 6 }}>Your AI team assembles here</div>
        <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.7 }}>Describe what you want to build in the chat.</div>
      </div>
    </div>
  ),
})

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
  const [tabs, setTabs] = useState([{ id: 1, name: 'Project 1', orgData: null, builderActive: false }])
  const [activeTabId, setActiveTabId] = useState(1)
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [agentKickoff, setAgentKickoff] = useState(null)
  const [user, setUser] = useState(null)
  const [introNodeIds, setIntroNodeIds] = useState(new Set())
  const [agentChats, setAgentChats] = useState({}) // nodeId → message string
  const [activeAgents, setActiveAgents] = useState(new Set())
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(null)
  const [showActivity, setShowActivity] = useState(false)
  const [showTasks, setShowTasks] = useState(true)
  const [showWorkflows, setShowWorkflows] = useState(false)
  const revealTimersRef = useRef([])
  const chartRef = useRef(null)
  const chatRef = useRef(null)
  const router = useRouter()

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs }, [tabs])

  // Auth disabled — open access

  // Show BuilderPreview when agents start executing on active tab
  useEffect(() => {
    function onBuild() {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, builderActive: true } : t))
      // Capture workspaceId from chat so BuilderPreview can fetch the file tree
      if (chatRef.current?.getWorkspaceId) {
        setCurrentWorkspaceId(chatRef.current.getWorkspaceId())
      }
    }
    window.addEventListener('builderUpdate', onBuild)
    return () => window.removeEventListener('builderUpdate', onBuild)
  }, [activeTabId])

  // Open agent modal from BuilderChat "Start Building" button
  useEffect(() => {
    function onOpenAgent(e) {
      const { agent, kickoff } = e.detail || {}
      if (!agent) return
      setSelectedAgent(agent)
      setAgentKickoff(kickoff || null)
    }
    window.addEventListener('openAgent', onOpenAgent)
    return () => window.removeEventListener('openAgent', onOpenAgent)
  }, [])

  // Track which agents are actively working (spinning gear)
  useEffect(() => {
    function onAgentStatus(e) {
      const { agentId, active } = e.detail || {}
      if (!agentId) return
      setActiveAgents(prev => {
        const next = new Set(prev)
        if (active) next.add(agentId)
        else next.delete(agentId)
        return next
      })
    }
    window.addEventListener('agentStatus', onAgentStatus)
    return () => window.removeEventListener('agentStatus', onAgentStatus)
  }, [])

  function updateTab(id, updates) {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }

  function addTab() {
    const id = nextTabId++
    const name = `Project ${id}`
    setTabs(prev => [...prev, { id, name, orgData: null, builderActive: false }])
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

  function buildChatScript(nodes) {
    const ids = new Set(nodes.map(n => n.id))
    // Pick the top-level agent (non-rules, level 0)
    const top = nodes.find(n => n.id !== 'rules' && (n.level ?? 0) === 0)
    const topId = top?.id || null
    // Build role map
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
    const level1 = nodes.filter(n => n.id !== 'rules' && n.level === 1)
    const level2 = nodes.filter(n => n.id !== 'rules' && n.level === 2)

    const seq = []
    let delay = 0
    const add = (nodeId, message) => {
      if (ids.has(nodeId)) { seq.push({ nodeId, message, delay }); delay += 3800 }
    }

    if (topId) add(topId, 'Team — stand by. New project incoming.')
    if (level1[0]) add(level1[0].id, `Ready. Waiting on ${top?.label || 'lead'} direction.`)
    if (topId) add(topId, 'Vision doc first. No code until I approve the spec.')
    if (level2[0]) add(level2[0].id, 'Standing by. Tell me what to build.')
    if (level1[0]) add(level1[0].id, 'Pulling competitor screenshots now.')
    if (topId) add(topId, 'Show me Linear and Notion side-by-side. Then propose.')
    return seq
  }

  const handleOrgUpdate = useCallback((newOrg) => {
    if (!newOrg?.nodes?.length) return

    // Skip reload if org structure hasn't changed (same node IDs)
    const currentTab = tabsRef.current.find(t => t.id === activeTabId)
    const currentNodes = currentTab?.orgData?.nodes
    if (currentNodes?.length === newOrg.nodes.length) {
      const currentIds = currentNodes.map(n => n.id).sort().join(',')
      const newIds = newOrg.nodes.map(n => n.id).sort().join(',')
      if (currentIds === newIds) return
    }

    // Clear any in-progress reveal
    revealTimersRef.current.forEach(clearTimeout)
    revealTimersRef.current = []

    // Sort nodes: top-level (no parent) first, then by level
    const sorted = [...newOrg.nodes].sort((a, b) => {
      if (a.id === 'rules') return 1
      if (b.id === 'rules') return -1
      return (a.level ?? 0) - (b.level ?? 0)
    })

    // Start with empty org
    const tabId = activeTabId
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, orgData: { ...newOrg, nodes: [] } } : t))

    // Reveal one by one
    sorted.forEach((node, i) => {
      const t = setTimeout(() => {
        setTabs(prev => prev.map(t => {
          if (t.id !== tabId) return t
          const existing = t.orgData?.nodes || []
          if (existing.find(n => n.id === node.id)) return t
          return { ...t, orgData: { ...newOrg, nodes: [...existing, node] } }
        }))
        // Mark as new for speech bubble
        setIntroNodeIds(prev => new Set([...prev, node.id]))
        const clearT = setTimeout(() => {
          setIntroNodeIds(prev => { const n = new Set(prev); n.delete(node.id); return n })
        }, 5000)
        revealTimersRef.current.push(clearT)
      }, i * 750)
      revealTimersRef.current.push(t)
    })

    // After all revealed, fire inter-agent chatter
    const chatDelay = sorted.length * 750 + 800
    const chatScript = buildChatScript(newOrg.nodes)
    chatScript.forEach(({ nodeId, message, delay }) => {
      const t = setTimeout(() => {
        setAgentChats(prev => ({ ...prev, [nodeId]: message }))
        const clearT = setTimeout(() => {
          setAgentChats(prev => { const n = { ...prev }; delete n[nodeId]; return n })
        }, 3500)
        revealTimersRef.current.push(clearT)
      }, chatDelay + delay)
      revealTimersRef.current.push(t)
    })

    // After all revealed, take screenshot
    const screenshotDelay = sorted.length * 750 + 1500
    const screenshotT = setTimeout(async () => {
      try {
        const dataUrl = await chartRef.current?.screenshot()
        if (!dataUrl) return
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        // Skip if image is too large (>1.5MB base64 ≈ ~1.1MB image)
        if (base64.length > 1500000) return
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
        chatRef.current?.addScreenshotMessage({ screenshot: dataUrl, assessment: result.assessment, passed: result.passed })
      } catch {}
    }, screenshotDelay)
    revealTimersRef.current.push(screenshotT)
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
        height: 44, background: 'rgba(5,13,26,0.97)', borderBottom: '1px solid #0f172a',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0,
        backdropFilter: 'blur(8px)',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa', letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', fontSize: 11, boxShadow: '0 2px 8px rgba(99,102,241,0.4)' }}>✦</span>
          Svet&apos;s Dream
        </span>
        <span style={{ flex: 1 }} />
        {/* Nav items — compact icon+label */}
        {[
          { href: '/billing', icon: '💳', label: 'Billing', accent: '#6366f1' },
          { href: '/vm', icon: '🖥', label: 'VMs', accent: null },
          { href: '/settings', icon: '⚙', label: 'Settings', accent: null },
          { href: '/setup', icon: '🚀', label: 'Setup', accent: null },
        ].map(({ href, icon, label, accent }) => (
          <a key={href} href={href} style={{
            fontSize: 11, color: accent || '#64748b', textDecoration: 'none',
            padding: '4px 9px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4,
            border: `1px solid ${accent ? accent + '25' : '#1e293b'}`,
            transition: 'color 0.15s, border-color 0.15s',
          }}>{icon} {label}</a>
        ))}
        <div style={{ width: 1, height: 20, background: '#1e293b', margin: '0 4px' }} />
        <button onClick={() => setShowWorkflows(v => !v)} style={{
          fontSize: 11, color: showWorkflows ? '#a78bfa' : '#475569', background: 'transparent',
          border: `1px solid ${showWorkflows ? 'rgba(167,139,250,0.3)' : '#1e293b'}`,
          padding: '4px 9px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
        }}>⏰ Workflows</button>
        <button onClick={() => setShowTasks(v => !v)} style={{
          fontSize: 11, color: showTasks ? '#a78bfa' : '#475569', background: 'transparent',
          border: `1px solid ${showTasks ? 'rgba(167,139,250,0.3)' : '#1e293b'}`,
          padding: '4px 9px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
        }}>📋 Tasks</button>
        <button onClick={() => setShowActivity(v => !v)} style={{
          fontSize: 11, color: showActivity ? '#a78bfa' : '#475569', background: 'transparent',
          border: `1px solid ${showActivity ? 'rgba(167,139,250,0.3)' : '#1e293b'}`,
          padding: '4px 9px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
        }}>👁 Activity</button>
        {user && <span style={{ fontSize: 10, color: '#334155', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>}
        <button onClick={handleSignOut} style={{ fontSize: 11, color: '#64748b', background: 'transparent', border: '1px solid #1e293b', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
        >
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 200, height: '100%' }}>
          <div style={{ height: 36, borderBottom: '1px solid #0f172a', background: 'rgba(5,13,26,0.9)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10 }}>
            <span style={{ fontSize: 11, color: activeTab?.orgData?.nodes?.length ? '#64748b' : '#475569', fontWeight: 500 }}>
              {activeTab?.orgData?.nodes?.length
                ? `${activeTab.orgData.nodes.filter(n => n.id !== 'rules').length} agents assembled · click to chat`
                : 'Agent org chart will appear here after you describe what to build'}
            </span>
            {activeTab?.orgData && (
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#a78bfa', background: '#a78bfa12', padding: '2px 9px', borderRadius: 20, fontWeight: 700, letterSpacing: '0.05em' }}>LIVE</span>
            )}
          </div>
          <OrgChart ref={chartRef} orgData={activeTab?.orgData} onNodeClick={setSelectedAgent} introNodeIds={introNodeIds} agentChats={agentChats} activeAgents={activeAgents} />
        </div>

        {/* Build Preview — always visible */}
        <BuilderPreview visible={true} workspaceId={currentWorkspaceId} />

        {/* Right: Workflows Panel — toggleable */}
        {showWorkflows && <WorkflowsPanel />}

        {/* Right: Tasks Panel — toggleable */}
        {showTasks && <TasksPanel workspaceId={currentWorkspaceId} />}

        {/* Right: Activity Feed — toggleable */}
        {showActivity && <ActivityFeed />}
      </div>

      {selectedAgent && (
        <AgentModal
          agent={selectedAgent}
          orgData={activeTab?.orgData}
          rulesDescription={rulesDescription}
          initialMessage={agentKickoff}
          onClose={() => { setSelectedAgent(null); setAgentKickoff(null) }}
        />
      )}
    </div>
  )
}
