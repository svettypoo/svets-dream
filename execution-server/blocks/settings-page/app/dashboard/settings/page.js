'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'account', label: 'Account' },
  { id: 'notifications', label: 'Notifications' },
]

export default function SettingsPage() {
  const [tab, setTab] = useState('profile')
  const [user, setUser] = useState(null)
  const [fullName, setFullName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setUser(data.user)
      setFullName(data.user?.user_metadata?.full_name || '')
    })
  }, [])

  async function saveProfile(e) {
    e.preventDefault()
    setSaving(true)
    const supabase = createClient()
    await supabase.auth.updateUser({ data: { full_name: fullName } })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function changePassword(e) {
    e.preventDefault()
    const fd = new FormData(e.target)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: fd.get('newPassword') })
    if (error) alert(error.message)
    else { alert('Password updated'); e.target.reset() }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <form onSubmit={saveProfile} className="card space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input bg-gray-50" value={user?.email || ''} disabled readOnly />
          </div>
          <div>
            <label className="label">Full name</label>
            <input className="input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save profile'}</button>
            {saved && <span className="text-sm text-green-600">✓ Saved</span>}
          </div>
        </form>
      )}

      {tab === 'account' && (
        <form onSubmit={changePassword} className="card space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Change password</h2>
          <div>
            <label className="label">New password</label>
            <input name="newPassword" type="password" className="input" minLength={6} required placeholder="Min 6 characters" />
          </div>
          <button type="submit" className="btn-primary">Update password</button>
        </form>
      )}

      {tab === 'notifications' && (
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Email notifications</h2>
          {[
            { id: 'activity', label: 'Activity summary', desc: 'Daily digest of activity in your workspace' },
            { id: 'mentions', label: 'Mentions', desc: 'When someone mentions you' },
            { id: 'updates', label: 'Product updates', desc: 'New features and announcements' },
          ].map(item => (
            <label key={item.id} className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox" defaultChecked className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              <div>
                <p className="text-sm font-medium text-gray-700 group-hover:text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500">{item.desc}</p>
              </div>
            </label>
          ))}
          <button className="btn-primary">Save preferences</button>
        </div>
      )}
    </div>
  )
}
