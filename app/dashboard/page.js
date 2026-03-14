'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  IconCamera, IconVideo, IconGitCommit, IconEye, IconServer,
  IconSearch, IconArrowBackUp, IconClock, IconCheck, IconAlertTriangle,
  IconBrandGithub, IconChevronDown, IconMoon, IconStar, IconFilter,
  IconRefresh, IconMapPin, IconCpu, IconCloud, IconActivity,
} from '@tabler/icons-react'

/* ── Module definitions ───────────────────────────── */
const MODULES = [
  { id: 'all', label: 'All Modules', color: '#3b82f6', icon: IconCloud },
  { id: 'birthdayboard', label: 'BirthdayBoard', color: '#0ea5e9', icon: IconStar },
  { id: 'meet', label: 'Meet', color: '#8b5cf6', icon: IconVideo },
  { id: 'concierge', label: 'Concierge', color: '#06b6d4', icon: IconActivity },
  { id: 'connect-ops', label: 'Connect Ops', color: '#f59e0b', icon: IconServer },
  { id: 'parking', label: 'Parking', color: '#22c55e', icon: IconMapPin },
  { id: 'atlas', label: 'Atlas', color: '#ef4444', icon: IconCpu },
  { id: 'matchfit', label: 'MatchFit', color: '#ec4899', icon: IconActivity },
  { id: 'frontdesk', label: 'Front Desk', color: '#6366f1', icon: IconServer },
]

const TABS = [
  { id: 'screenshots', label: 'Screenshots', icon: IconCamera },
  { id: 'videos', label: 'Videos', icon: IconVideo },
  { id: 'changelog', label: 'Change Log', icon: IconGitCommit },
  { id: 'liveview', label: 'Live View', icon: IconEye },
]

const MEDIA_BASE = 'https://media.stproperties.com'

/* ── Map media items to display format ────────────── */
function mapMediaItem(item) {
  const mod = MODULES.find(m => m.id !== 'all' && m.id === guessModule(item)) || { id: 'unknown', label: 'Unknown', color: '#475569' }
  return {
    id: item.id,
    module: mod.id,
    moduleLabel: mod.label,
    moduleColor: mod.color,
    timestamp: new Date(item.created_at + 'Z').getTime(),
    url: `${MEDIA_BASE}/media/${item.id}`,
    thumbUrl: `${MEDIA_BASE}/media/${item.id}/thumb`,
    commit: item.id.slice(0, 7),
    duration: item.duration_ms ? Math.round(item.duration_ms / 1000) : 0,
    source: item.source || '',
    width: item.width,
    height: item.height,
    size: item.size_bytes,
  }
}

/* Guess module from source/tags — will improve over time */
function guessModule(item) {
  const src = (item.source || '').toLowerCase()
  const tags = typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags || [])
  const all = src + ' ' + tags
  if (all.includes('meet')) return 'meet'
  if (all.includes('concierge')) return 'concierge'
  if (all.includes('connect') || all.includes('phone')) return 'connect-ops'
  if (all.includes('birthday')) return 'birthdayboard'
  if (all.includes('parking')) return 'parking'
  if (all.includes('atlas')) return 'atlas'
  if (all.includes('matchfit')) return 'matchfit'
  if (all.includes('frontdesk') || all.includes('front-desk')) return 'frontdesk'
  return 'all'
}

async function fetchMedia(type, limit = 50) {
  try {
    const res = await fetch(`/api/media?type=${type}&limit=${limit}`)
    const data = await res.json()
    if (data.ok && data.items) return data.items.map(mapMediaItem)
  } catch (e) { console.error('fetch media error:', e) }
  return []
}

/* ── Helpers ──────────────────────────────────────── */
function fmtTime(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' — ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Denver' }) + ' MT'
}

function fmtDuration(sec) {
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
}

const typeBadge = {
  deploy: { bg: '#22c55e20', color: '#22c55e', label: 'Deploy' },
  fix: { bg: '#ef444420', color: '#ef4444', label: 'Fix' },
  feature: { bg: '#3b82f620', color: '#3b82f6', label: 'Feature' },
  refactor: { bg: '#8b5cf620', color: '#8b5cf6', label: 'Refactor' },
  hotfix: { bg: '#f59e0b20', color: '#f59e0b', label: 'Hotfix' },
}

/* ── Components ───────────────────────────────────── */

function Sidebar({ activeModule, onSelect }) {
  return (
    <div style={{
      width: 220, flexShrink: 0, background: '#0f1629', borderRight: '1px solid #1a2744',
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(59,130,246,0.4)',
        }}>
          <IconMoon size={18} color="#fff" />
        </div>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.3px' }}>Dream</span>
      </div>

      {/* Module list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '8px 8px 6px', marginTop: 4 }}>
          Modules
        </div>
        {MODULES.map(mod => {
          const active = activeModule === mod.id
          const Icon = mod.icon
          return (
            <button
              key={mod.id}
              onClick={() => onSelect(mod.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: active ? `${mod.color}18` : 'transparent',
                transition: 'all 0.15s',
                marginBottom: 2,
              }}
            >
              <Icon size={16} color={active ? mod.color : '#475569'} />
              <span style={{
                fontSize: 13, fontWeight: active ? 600 : 400,
                color: active ? '#e2e8f0' : '#94a3b8',
              }}>{mod.label}</span>
              {mod.id !== 'all' && (
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', marginLeft: 'auto',
                  background: '#22c55e',
                  boxShadow: '0 0 6px rgba(34,197,94,0.5)',
                }} />
              )}
            </button>
          )
        })}

        <div style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '16px 8px 6px' }}>
          Infrastructure
        </div>
        <button
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'transparent', transition: 'all 0.15s',
          }}
          onClick={() => onSelect('vms')}
        >
          <IconServer size={16} color="#475569" />
          <span style={{ fontSize: 13, color: '#94a3b8' }}>VMs & Servers</span>
        </button>
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #1a2744', fontSize: 10, color: '#334155' }}>
        S&T Properties © 2026
      </div>
    </div>
  )
}

function SubTabs({ activeTab, onSelect }) {
  return (
    <div style={{
      height: 48, background: '#0a0e1a', borderBottom: '1px solid #1a2744',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 0,
    }}>
      <div style={{ display: 'flex', gap: 0, flex: 1 }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '12px 20px', border: 'none', cursor: 'pointer',
                background: 'transparent',
                borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={16} color={active ? '#3b82f6' : '#475569'} />
              <span style={{
                fontSize: 13, fontWeight: active ? 600 : 400,
                color: active ? '#e2e8f0' : '#64748b',
              }}>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Search + filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#151d2e', borderRadius: 8, padding: '6px 12px',
          border: '1px solid #1a2744',
        }}>
          <IconSearch size={14} color="#475569" />
          <input
            placeholder="Search deployments..."
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: '#e2e8f0', fontSize: 12, width: 160,
              fontFamily: 'inherit',
            }}
          />
        </div>
        <button style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: '#151d2e', borderRadius: 8, padding: '6px 10px',
          border: '1px solid #1a2744', cursor: 'pointer', color: '#64748b', fontSize: 12,
        }}>
          <IconFilter size={14} /> Filter
        </button>
      </div>
    </div>
  )
}

function ScreenshotGrid({ items }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      gap: 16, padding: 24,
    }}>
      {items.map(item => (
        <div key={item.id} style={{
          background: '#151d2e', borderRadius: 12, border: '1px solid #1a2744',
          overflow: 'hidden', transition: 'border-color 0.2s, box-shadow 0.2s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f640'; e.currentTarget.style.boxShadow = '0 0 20px rgba(59,130,246,0.1)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a2744'; e.currentTarget.style.boxShadow = 'none' }}
        >
          {/* Thumbnail */}
          <div style={{
            aspectRatio: '16/9', background: '#0f1629',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ width: '100%', height: '100%' }}>
                <img
                  src={item.thumbUrl || item.url}
                  alt={`${item.moduleLabel} screenshot`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                />
              </a>
            ) : (
              <IconCamera size={32} color="#1e3050" />
            )}
          </div>
          {/* Meta */}
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: `${item.moduleColor}20`, color: item.moduleColor,
              }}>{item.moduleLabel}</span>
              <code style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{item.commit}</code>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                <IconClock size={12} /> {fmtTime(item.timestamp)}
              </span>
              <button style={{
                fontSize: 11, color: '#ef4444', background: 'transparent', border: '1px solid #ef444440',
                borderRadius: 6, padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                transition: 'all 0.15s',
              }}>
                <IconArrowBackUp size={12} /> Revert
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function VideoGrid({ items }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      gap: 16, padding: 24,
    }}>
      {items.map(item => (
        <div key={item.id} style={{
          background: '#151d2e', borderRadius: 12, border: '1px solid #1a2744',
          overflow: 'hidden', transition: 'border-color 0.2s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#8b5cf640' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a2744' }}
        >
          <div style={{
            aspectRatio: '16/9', background: '#0f1629',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
            overflow: 'hidden',
          }}>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a' }}>
                <IconVideo size={40} color="#3b82f6" style={{ opacity: 0.6 }} />
              </a>
            ) : (
              <IconVideo size={32} color="#1e3050" />
            )}
            <span style={{
              position: 'absolute', bottom: 8, right: 8, fontSize: 11, color: '#e2e8f0',
              background: '#000000aa', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace',
            }}>{fmtDuration(item.duration)}</span>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: `${item.moduleColor}20`, color: item.moduleColor,
              }}>{item.moduleLabel}</span>
              <code style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{item.commit}</code>
            </div>
            <span style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <IconClock size={12} /> {fmtTime(item.timestamp)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ChangeLog({ items }) {
  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      {items.map((item, i) => (
        <div key={item.id} style={{
          display: 'flex', gap: 16, padding: '16px 0',
          borderBottom: i < items.length - 1 ? '1px solid #1a2744' : 'none',
        }}>
          {/* Timeline dot */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0, paddingTop: 4 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: typeBadge[item.type]?.color || '#475569',
              boxShadow: `0 0 8px ${typeBadge[item.type]?.color || '#475569'}40`,
            }} />
            {i < items.length - 1 && <div style={{ width: 1, flex: 1, background: '#1a2744', marginTop: 4 }} />}
          </div>

          {/* Content */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: `${item.moduleColor}20`, color: item.moduleColor,
              }}>{item.moduleLabel}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                background: typeBadge[item.type]?.bg, color: typeBadge[item.type]?.color,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>{typeBadge[item.type]?.label}</span>
              <code style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3 }}>
                <IconBrandGithub size={11} /> {item.commit}
              </code>
            </div>
            <p style={{ fontSize: 13, color: '#e2e8f0', margin: 0, lineHeight: 1.5 }}>{item.message}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                <IconClock size={12} /> {fmtTime(item.timestamp)}
              </span>
              {item.canRevert && (
                <button style={{
                  fontSize: 11, color: '#ef4444', background: 'transparent', border: '1px solid #ef444440',
                  borderRadius: 6, padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <IconArrowBackUp size={12} /> Revert
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function LiveView() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{
        background: '#151d2e', borderRadius: 12, border: '1px solid #1a2744',
        padding: 24, textAlign: 'center', minHeight: 400,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: 'linear-gradient(135deg, #3b82f620, #8b5cf620)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid #3b82f640',
        }}>
          <IconEye size={28} color="#3b82f6" />
        </div>
        <h3 style={{ fontSize: 16, color: '#e2e8f0', margin: 0 }}>Live VM Viewer</h3>
        <p style={{ fontSize: 13, color: '#64748b', maxWidth: 400, lineHeight: 1.6 }}>
          Watch Claude&apos;s browser activity in real-time. Select a VM session below to start streaming.
        </p>

        {/* VM session cards */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { id: 'claude-monitor', status: 'active', device: '1280×800' },
            { id: 'claude-mobile', status: 'idle', device: '390×844 (iOS)' },
          ].map(vm => (
            <div key={vm.id} style={{
              background: '#0f1629', borderRadius: 10, border: '1px solid #1a2744',
              padding: '14px 20px', minWidth: 200, textAlign: 'left',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: vm.status === 'active' ? '#22c55e' : '#f59e0b',
                  boxShadow: vm.status === 'active' ? '0 0 8px #22c55e80' : 'none',
                }} />
                <code style={{ fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace' }}>{vm.id}</code>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Viewport: {vm.device}</div>
              <button style={{
                marginTop: 8, fontSize: 11, color: '#3b82f6', background: '#3b82f615',
                border: '1px solid #3b82f630', borderRadius: 6, padding: '4px 12px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <IconEye size={12} /> Watch Live
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* VM Infrastructure */}
      <h3 style={{ fontSize: 14, color: '#e2e8f0', margin: '24px 0 12px', fontWeight: 600 }}>Infrastructure</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {[
          { name: 'mailcow-stproperties', ip: '178.156.202.118', loc: 'Ashburn, VA', spec: 'CPX41 — 8 vCPU / 16GB', status: 'running', containers: 24 },
          { name: 'test-runner-1', ip: '178.104.54.231', loc: 'Nuremberg, DE', spec: 'CAX11 — 2 vCPU ARM / 4GB', status: 'running', containers: 1 },
        ].map(vm => (
          <div key={vm.name} style={{
            background: '#151d2e', borderRadius: 10, border: '1px solid #1a2744', padding: '16px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: '#22c55e',
                boxShadow: '0 0 8px #22c55e80',
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{vm.name}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 11 }}>
              <span style={{ color: '#64748b' }}>IP</span>
              <code style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{vm.ip}</code>
              <span style={{ color: '#64748b' }}>Location</span>
              <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}><IconMapPin size={11} /> {vm.loc}</span>
              <span style={{ color: '#64748b' }}>Spec</span>
              <span style={{ color: '#94a3b8' }}>{vm.spec}</span>
              <span style={{ color: '#64748b' }}>Containers</span>
              <span style={{ color: '#94a3b8' }}>{vm.containers} running</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusBar() {
  return (
    <div style={{
      height: 32, flexShrink: 0, background: '#0a0e1a', borderTop: '1px solid #1a2744',
      display: 'flex', alignItems: 'center', padding: '0 20px', gap: 20,
      fontSize: 11, color: '#475569',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <IconServer size={12} /> 2 VMs Active
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <IconMapPin size={12} /> Hetzner: Ashburn, VA
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <IconRefresh size={12} /> Last deploy: 2 min ago
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e80' }} />
        All systems operational
      </span>
    </div>
  )
}

/* ── Main Dashboard ───────────────────────────────── */
export default function Dashboard() {
  const [activeModule, setActiveModule] = useState('all')
  const [activeTab, setActiveTab] = useState('screenshots')
  const [data, setData] = useState(null)

  // Filter by module
  const filter = useCallback((items) => {
    if (activeModule === 'all' || activeModule === 'vms') return items
    return items.filter(i => i.module === activeModule)
  }, [activeModule])

  // If user clicks "VMs & Servers", force Live View tab
  useEffect(() => {
    if (activeModule === 'vms') setActiveTab('liveview')
  }, [activeModule])

  useEffect(() => {
    async function load() {
      const [screenshots, videos] = await Promise.all([
        fetchMedia('screenshots', 50),
        fetchMedia('videos', 30),
      ])
      setData({ screenshots, videos })
    }
    load()
  }, [])

  if (!data) return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a', color: '#475569' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', background: '#0a0e1a' }}>
      <Sidebar activeModule={activeModule} onSelect={setActiveModule} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <SubTabs activeTab={activeTab} onSelect={setActiveTab} />

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'screenshots' && <ScreenshotGrid items={filter(data.screenshots)} />}
          {activeTab === 'videos' && <VideoGrid items={filter(data.videos)} />}
          {activeTab === 'changelog' && (
            <div style={{ padding: 24, color: '#475569', fontSize: 13 }}>
              Change log will be wired to git commit history. Coming soon.
            </div>
          )}
          {activeTab === 'liveview' && <LiveView />}
        </div>

        <StatusBar />
      </div>
    </div>
  )
}
