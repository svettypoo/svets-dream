'use client';
import { useState } from 'react';

const FIELD_TYPES = [
  { value: 'text', label: 'Short Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio Buttons' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
];

function newField() {
  return { id: crypto.randomUUID(), type: 'text', label: '', placeholder: '', required: false, options: [] };
}

export default function FormBuilderEditor({ onSave }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [successMessage, setSuccessMessage] = useState('Thank you!');
  const [submitLabel, setSubmitLabel] = useState('Submit');
  const [fields, setFields] = useState([newField()]);
  const [saving, setSaving] = useState(false);

  function addField() { setFields(prev => [...prev, newField()]); }
  function removeField(id) { setFields(prev => prev.filter(f => f.id !== id)); }
  function updateField(id, patch) {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }
  function moveField(id, dir) {
    setFields(prev => {
      const idx = prev.findIndex(f => f.id === id);
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const form = { title, description, success_message: successMessage, submit_label: submitLabel, fields };
    const res = await fetch('/api/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) onSave?.(data.form);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Build a Form</h2>

      {/* Form metadata */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Form Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Contact Us"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-3">
        {fields.map((field, idx) => (
          <div key={field.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <select value={field.type} onChange={e => updateField(field.id, { type: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input value={field.label} onChange={e => updateField(field.id, { label: e.target.value })}
                placeholder="Field label" className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={field.required} onChange={e => updateField(field.id, { required: e.target.checked })} className="accent-blue-600" />
                Required
              </label>
              <button onClick={() => moveField(field.id, -1)} disabled={idx === 0} className="text-gray-400 hover:text-gray-600 disabled:opacity-30">↑</button>
              <button onClick={() => moveField(field.id, 1)} disabled={idx === fields.length - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-30">↓</button>
              <button onClick={() => removeField(field.id)} className="text-red-400 hover:text-red-600 text-lg">×</button>
            </div>

            {['text', 'email', 'tel', 'number', 'textarea'].includes(field.type) && (
              <input value={field.placeholder || ''} onChange={e => updateField(field.id, { placeholder: e.target.value })}
                placeholder="Placeholder text (optional)"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            )}

            {['select', 'radio'].includes(field.type) && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Options (one per line: value|Label)</p>
                <textarea
                  value={(field.options || []).map(o => `${o.value}|${o.label}`).join('\n')}
                  onChange={e => updateField(field.id, {
                    options: e.target.value.split('\n').filter(Boolean).map(line => {
                      const [value, ...rest] = line.split('|');
                      return { value: value.trim(), label: rest.join('|').trim() || value.trim() };
                    })
                  })}
                  rows={3}
                  placeholder="option1|Option One&#10;option2|Option Two"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={addField}
        className="w-full py-2 border-2 border-dashed border-gray-300 text-gray-500 rounded-xl hover:border-blue-400 hover:text-blue-500 text-sm font-medium transition-colors">
        + Add Field
      </button>

      {/* Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="font-medium text-gray-700 text-sm">Form Settings</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Submit Button Label</label>
            <input value={submitLabel} onChange={e => setSubmitLabel(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Success Message</label>
            <input value={successMessage} onChange={e => setSuccessMessage(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      <button onClick={save} disabled={saving || !title}
        className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Saving...' : 'Save Form'}
      </button>
    </div>
  );
}
