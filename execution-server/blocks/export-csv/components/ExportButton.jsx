'use client';
import { useState } from 'react';

// Drop-in export button — add to any table header
// <ExportButton table="users" label="Export Users" columns={['name','email','created_at']} filters={{ status: 'active' }} />
export default function ExportButton({ table, label, columns, filters = {}, filename }) {
  const [loading, setLoading] = useState(false);

  async function download() {
    setLoading(true);
    const params = new URLSearchParams({ table, columns: (columns || []).join(','), ...filters });
    const res = await fetch(`/api/export?${params}`);
    if (!res.ok) { alert('Export failed'); setLoading(false); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${table}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setLoading(false);
  }

  return (
    <button onClick={download} disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
      {loading ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>
      )}
      {loading ? 'Exporting...' : (label || `Export ${table}`)}
    </button>
  );
}
