'use client';
import { useState, useEffect } from 'react';

const ROLES = ['admin', 'moderator', 'member', 'guest'];
const ROLE_COLORS = {
  admin: 'bg-red-100 text-red-700',
  moderator: 'bg-purple-100 text-purple-700',
  member: 'bg-blue-100 text-blue-700',
  guest: 'bg-gray-100 text-gray-600',
};

export default function RoleManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/roles')
      .then(r => r.json())
      .then(d => { setUsers(d.users || []); setLoading(false); });
  }, []);

  async function changeRole(userId, newRole) {
    setSaving(userId);
    const res = await fetch('/api/roles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole }),
    });
    const data = await res.json();
    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } else {
      alert(data.error || 'Failed to update role');
    }
    setSaving(null);
  }

  const filtered = users.filter(u =>
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="p-8 text-center text-gray-500">Loading users...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Role Management</h2>
        <span className="text-sm text-gray-500">{users.length} users</span>
      </div>

      <input
        type="text"
        placeholder="Search by name or email..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Current Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Change Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(user => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{user.full_name || 'Unnamed'}</div>
                  <div className="text-gray-500 text-xs">{user.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] || ROLE_COLORS.guest}`}>
                    {user.role || 'guest'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={user.role || 'guest'}
                    onChange={e => changeRole(user.id, e.target.value)}
                    disabled={saving === user.id}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {saving === user.id && (
                    <span className="ml-2 text-xs text-gray-400">Saving...</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">No users found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
