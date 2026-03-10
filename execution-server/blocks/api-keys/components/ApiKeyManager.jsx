'use client';
import { useState, useEffect } from 'react';

export default function ApiKeyManager({ userId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null); // revealed once after creation
  const [form, setForm] = useState({ name: '', scopes: '', expiresInDays: '' });

  useEffect(() => {
    if (!userId) return;
    fetch('/api/keys', { headers: { 'x-user-id': userId } })
      .then(r => r.json())
      .then(d => { setKeys(d.keys || []); setLoading(false); });
  }, [userId]);

  async function create(e) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({
        name: form.name || 'My Key',
        scopes: form.scopes ? form.scopes.split(',').map(s => s.trim()) : [],
        expiresInDays: form.expiresInDays ? parseInt(form.expiresInDays) : null,
      }),
    });
    const data = await res.json();
    setCreating(false);
    if (res.ok) {
      setNewKey(data.key.key);
      setKeys(prev => [data.key, ...prev]);
      setForm({ name: '', scopes: '', expiresInDays: '' });
    }
  }

  async function revoke(id) {
    if (!confirm('Revoke this API key? Any apps using it will stop working.')) return;
    await fetch(`/api/keys?id=${id}`, { method: 'DELETE', headers: { 'x-user-id': userId } });
    setKeys(prev => prev.map(k => k.id === id ? { ...k, is_active: false } : k));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">API Keys</h2>
        <span className="text-sm text-gray-500">{keys.filter(k => k.is_active).length} active</span>
      </div>

      {/* Revealed key banner */}
      {newKey && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-green-800">⚠ Copy this key now — it won't be shown again</span>
            <button onClick={() => setNewKey(null)} className="text-green-600 hover:text-green-800 text-lg">×</button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded px-3 py-2 text-sm font-mono break-all">{newKey}</code>
            <button onClick={() => navigator.clipboard.writeText(newKey)}
              className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex-shrink-0">
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={create} className="bg-gray-50 rounded-xl p-4 space-y-3">
        <h3 className="font-medium text-gray-700 text-sm">Create New Key</h3>
        <div className="grid grid-cols-3 gap-3">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Key name (e.g. Production)" required
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={form.scopes} onChange={e => setForm(f => ({ ...f, scopes: e.target.value }))}
            placeholder="Scopes (e.g. read,write)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={form.expiresInDays} onChange={e => setForm(f => ({ ...f, expiresInDays: e.target.value }))}
            placeholder="Expires in days (blank = never)" type="number" min="1"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" disabled={creating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {creating ? 'Generating...' : 'Generate Key'}
        </button>
      </form>

      {/* Keys list */}
      <div className="space-y-2">
        {loading ? <div className="text-gray-400 text-sm">Loading...</div> : keys.map(k => (
          <div key={k.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border ${k.is_active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 text-sm">{k.name}</span>
                {!k.is_active && <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Revoked</span>}
                {k.scopes?.length > 0 && k.scopes.map(s => (
                  <span key={s} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{s}</span>
                ))}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                <code className="font-mono">{k.key_prefix}</code>
                {' · '}Used {k.use_count || 0} times
                {k.last_used_at && ` · Last: ${new Date(k.last_used_at).toLocaleDateString()}`}
                {k.expires_at && ` · Expires: ${new Date(k.expires_at).toLocaleDateString()}`}
              </div>
            </div>
            {k.is_active && (
              <button onClick={() => revoke(k.id)} className="text-xs text-red-400 hover:text-red-600 px-3 py-1 border border-red-200 rounded-lg hover:bg-red-50">
                Revoke
              </button>
            )}
          </div>
        ))}
        {!loading && keys.length === 0 && (
          <div className="text-center text-gray-400 py-8 text-sm">No API keys yet</div>
        )}
      </div>
    </div>
  );
}
