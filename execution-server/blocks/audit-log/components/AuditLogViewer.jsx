'use client';
import { useState, useEffect, useCallback } from 'react';

const ACTION_COLORS = {
  'user.login': 'bg-green-100 text-green-700',
  'user.logout': 'bg-gray-100 text-gray-600',
  'user.delete': 'bg-red-100 text-red-700',
  'data.create': 'bg-blue-100 text-blue-700',
  'data.update': 'bg-yellow-100 text-yellow-700',
  'data.delete': 'bg-red-100 text-red-700',
  'role.change': 'bg-purple-100 text-purple-700',
};

function getActionColor(action) {
  return ACTION_COLORS[action] || 'bg-gray-100 text-gray-600';
}

export default function AuditLogViewer({ userId, resource }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('');
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: LIMIT, offset: page * LIMIT });
    if (userId) params.set('userId', userId);
    if (resource) params.set('resource', resource);
    if (filter) params.set('action', filter);
    const res = await fetch(`/api/audit?${params}`);
    const data = await res.json();
    setLogs(data.logs || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [userId, resource, filter, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Audit Log</h2>
        <span className="text-sm text-gray-500">{total.toLocaleString()} events</span>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Filter by action (e.g. user.login)..."
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(0); }}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={load} className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">
          Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Time</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Resource</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No audit events found</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{log.profiles?.full_name || '—'}</div>
                  <div className="text-xs text-gray-400">{log.profiles?.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {log.resource}{log.resource_id ? ` #${log.resource_id.slice(0, 8)}` : ''}
                </td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{log.ip_address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="px-3 py-1 bg-gray-100 text-gray-600 rounded text-sm disabled:opacity-40"
            >← Prev</button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * LIMIT >= total}
              className="px-3 py-1 bg-gray-100 text-gray-600 rounded text-sm disabled:opacity-40"
            >Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
