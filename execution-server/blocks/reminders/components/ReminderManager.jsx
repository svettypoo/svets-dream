'use client';
import { useState, useEffect } from 'react';

const CHANNELS = ['email', 'sms', 'whatsapp'];
const REPEAT_OPTIONS = [
  { value: '', label: 'Once' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

function localDatetimeNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function ReminderManager({ userId, userEmail, userPhone }) {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', sendAt: localDatetimeNow(), channels: ['email'], repeat: '' });

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/reminders?userId=${userId}`)
      .then(r => r.json())
      .then(d => { setReminders(d.reminders || []); setLoading(false); });
  }, [userId]);

  function toggleChannel(ch) {
    setForm(f => ({
      ...f,
      channels: f.channels.includes(ch) ? f.channels.filter(c => c !== ch) : [...f.channels, ch],
    }));
  }

  async function create(e) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        title: form.title,
        message: form.message,
        sendAt: new Date(form.sendAt).toISOString(),
        channels: form.channels,
        email: form.channels.includes('email') ? userEmail : null,
        phone: (form.channels.includes('sms') || form.channels.includes('whatsapp')) ? userPhone : null,
        repeat: form.repeat || null,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setReminders(prev => [...prev, data.reminder].sort((a, b) => new Date(a.send_at) - new Date(b.send_at)));
      setForm({ title: '', message: '', sendAt: localDatetimeNow(), channels: ['email'], repeat: '' });
    }
    setCreating(false);
  }

  async function deleteReminder(id) {
    await fetch(`/api/reminders?id=${id}`, { method: 'DELETE' });
    setReminders(prev => prev.filter(r => r.id !== id));
  }

  const statusColor = { pending: 'text-blue-600 bg-blue-50', sent: 'text-green-600 bg-green-50', failed: 'text-red-600 bg-red-50' };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">My Reminders</h2>

      {/* Create form */}
      <form onSubmit={create} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">Set a new reminder</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 md:col-span-1">
            <label className="block text-sm text-gray-600 mb-1">Title *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Follow up with client" required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="block text-sm text-gray-600 mb-1">When *</label>
            <input type="datetime-local" value={form.sendAt} onChange={e => setForm(f => ({ ...f, sendAt: e.target.value }))} required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Message (optional)</label>
          <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            placeholder="Additional details..." rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
        <div className="flex gap-4 flex-wrap items-center">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Send via</label>
            <div className="flex gap-2">
              {CHANNELS.map(ch => (
                <label key={ch} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm font-medium transition-colors ${form.channels.includes(ch) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500'}`}>
                  <input type="checkbox" checked={form.channels.includes(ch)} onChange={() => toggleChannel(ch)} className="sr-only" />
                  {ch === 'email' ? '📧' : ch === 'sms' ? '📱' : '💬'} {ch}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Repeat</label>
            <select value={form.repeat} onChange={e => setForm(f => ({ ...f, repeat: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button type="submit" disabled={creating || !form.title || !form.sendAt}
            className="self-end px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {creating ? 'Saving...' : 'Set Reminder'}
          </button>
        </div>
      </form>

      {/* List */}
      {loading ? <div className="text-gray-400 text-sm">Loading...</div> : (
        <div className="space-y-2">
          {reminders.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">No reminders yet</div>}
          {reminders.map(r => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-200">
              <div className="flex items-center gap-3">
                <span className="text-xl">{r.channels?.includes('whatsapp') ? '💬' : r.channels?.includes('sms') ? '📱' : '📧'}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 text-sm">{r.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                    {r.repeat && <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">{r.repeat}</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(r.send_at).toLocaleString()}
                    {r.message && ` · ${r.message}`}
                  </div>
                </div>
              </div>
              {r.status === 'pending' && (
                <button onClick={() => deleteReminder(r.id)} className="text-gray-300 hover:text-red-500 text-lg px-2">×</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
