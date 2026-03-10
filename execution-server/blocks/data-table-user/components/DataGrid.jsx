'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

// User-facing spreadsheet-like data grid
// Features: search, sort, filter, inline edit, add row, delete row, pagination, CSV export
// Usage: <DataGrid table="inventory" columns={[{key:'name',label:'Name',editable:true},{key:'qty',label:'Qty',type:'number',editable:true}]} />

export default function DataGrid({
  table,
  columns = [],
  title,
  allowAdd = true,
  allowDelete = true,
  allowEdit = true,
  pageSize = 25,
}) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(0);
  const [editingCell, setEditingCell] = useState(null); // { rowId, colKey }
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const searchTimeout = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      table,
      search,
      sort: sortKey,
      dir: sortDir,
      limit: pageSize,
      offset: page * pageSize,
      ...filters,
    });
    const res = await fetch(`/api/data?${params}`);
    const data = await res.json();
    setRows(data.rows || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [table, search, sortKey, sortDir, page, pageSize, filters]);

  useEffect(() => { load(); }, [load]);

  function handleSearch(value) {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setSearch(value); setPage(0); }, 300);
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(0);
  }

  function startEdit(rowId, colKey, currentValue) {
    if (!allowEdit) return;
    setEditingCell({ rowId, colKey });
    setEditValue(currentValue ?? '');
  }

  async function saveEdit(rowId) {
    if (!editingCell) return;
    setSaving(true);
    const patch = { [editingCell.colKey]: editValue };
    await fetch('/api/data', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, id: rowId, patch }),
    });
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, [editingCell.colKey]: editValue } : r));
    setEditingCell(null);
    setSaving(false);
  }

  async function addRow() {
    const blank = {};
    columns.forEach(c => { if (c.key !== 'id' && c.key !== 'created_at') blank[c.key] = ''; });
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, row: blank }),
    });
    const data = await res.json();
    if (data.row) setRows(prev => [data.row, ...prev]);
  }

  async function deleteRow(id) {
    if (!confirm('Delete this row?')) return;
    await fetch(`/api/data?table=${table}&id=${id}`, { method: 'DELETE' });
    setRows(prev => prev.filter(r => r.id !== id));
    setTotal(t => t - 1);
  }

  function exportCSV() {
    const headers = columns.map(c => c.label || c.key).join(',');
    const rowsCSV = rows.map(r => columns.map(c => {
      const v = String(r[c.key] ?? '');
      return v.includes(',') ? `"${v}"` : v;
    }).join(',')).join('\n');
    const blob = new Blob([headers + '\n' + rowsCSV], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${table}.csv`; a.click();
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {title && <h2 className="text-lg font-bold text-gray-900">{title}</h2>}
          <p className="text-sm text-gray-500">{total.toLocaleString()} rows</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search..."
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
          />
          <button onClick={() => setShowFilters(f => !f)}
            className={`px-3 py-1.5 text-sm border rounded-lg ${showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            Filters {Object.keys(filters).length > 0 && `(${Object.keys(filters).length})`}
          </button>
          <button onClick={exportCSV} className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
            ↓ CSV
          </button>
          {allowAdd && (
            <button onClick={addRow} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              + Add Row
            </button>
          )}
        </div>
      </div>

      {/* Filter row */}
      {showFilters && (
        <div className="flex gap-2 flex-wrap p-3 bg-gray-50 rounded-lg border border-gray-200">
          {columns.filter(c => c.filterable).map(col => (
            <div key={col.key}>
              <label className="block text-xs text-gray-500 mb-1">{col.label}</label>
              {col.filterOptions ? (
                <select value={filters[col.key] || ''} onChange={e => setFilters(f => ({ ...f, [col.key]: e.target.value || undefined }))}
                  className="border border-gray-300 rounded px-2 py-1 text-sm">
                  <option value="">All</option>
                  {col.filterOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input value={filters[col.key] || ''} onChange={e => setFilters(f => ({ ...f, [col.key]: e.target.value || undefined }))}
                  placeholder={`Filter ${col.label}...`}
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-32" />
              )}
            </div>
          ))}
          <button onClick={() => setFilters({})} className="self-end text-xs text-gray-400 hover:text-red-500 px-2">Clear</button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {columns.map(col => (
                <th key={col.key} onClick={() => toggleSort(col.key)}
                  className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap select-none">
                  <span className="flex items-center gap-1">
                    {col.label || col.key}
                    {sortKey === col.key && <span className="text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                </th>
              ))}
              {allowDelete && <th className="w-10 px-2 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={columns.length + 1} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="px-4 py-12 text-center text-gray-400">No data found</td></tr>
            ) : rows.map(row => (
              <tr key={row.id} className="hover:bg-blue-50/30 group">
                {columns.map(col => {
                  const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === col.key;
                  const val = row[col.key];
                  return (
                    <td key={col.key} className="px-4 py-2.5 text-gray-700"
                      onDoubleClick={() => col.editable && startEdit(row.id, col.key, val)}>
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveEdit(row.id)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(row.id); if (e.key === 'Escape') setEditingCell(null); }}
                          type={col.type || 'text'}
                          className="w-full border border-blue-400 rounded px-2 py-1 text-sm focus:outline-none ring-2 ring-blue-200"
                        />
                      ) : (
                        <span className={col.editable ? 'cursor-text group-hover:bg-yellow-50 rounded px-1 -mx-1' : ''}>
                          {col.render ? col.render(val, row) : (val === null || val === undefined ? <span className="text-gray-300">—</span> : String(val))}
                        </span>
                      )}
                    </td>
                  );
                })}
                {allowDelete && (
                  <td className="px-2 py-2.5">
                    <button onClick={() => deleteRow(row.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity text-lg">×</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 text-sm border border-gray-300 rounded disabled:opacity-40">«</button>
            <button onClick={() => setPage(p => p - 1)} disabled={page === 0} className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-40">‹</button>
            <span className="px-3 py-1 text-sm bg-blue-600 text-white rounded">{page + 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-40">›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 text-sm border border-gray-300 rounded disabled:opacity-40">»</button>
          </div>
        </div>
      )}
    </div>
  );
}
