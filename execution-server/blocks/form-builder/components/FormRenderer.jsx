'use client';
import { useState } from 'react';

// FormRenderer — takes a form schema and renders it dynamically
// Schema example:
// { id, title, fields: [{ id, type, label, placeholder, required, options }] }
// types: text | email | tel | number | textarea | select | radio | checkbox | date | file

export default function FormRenderer({ form, onSubmit }) {
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function set(fieldId, value) {
    setValues(prev => ({ ...prev, [fieldId]: value }));
    if (errors[fieldId]) setErrors(prev => ({ ...prev, [fieldId]: '' }));
  }

  function validate() {
    const errs = {};
    for (const field of form.fields) {
      if (field.required && !values[field.id]) {
        errs[field.id] = `${field.label} is required`;
      }
      if (field.type === 'email' && values[field.id] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[field.id])) {
        errs[field.id] = 'Enter a valid email address';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    await onSubmit?.({ formId: form.id, values });
    setSubmitting(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-4">✅</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">{form.success_message || 'Thank you!'}</h3>
        <p className="text-gray-500">{form.success_detail || 'Your response has been recorded.'}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {form.title && <h2 className="text-2xl font-bold text-gray-900">{form.title}</h2>}
      {form.description && <p className="text-gray-500">{form.description}</p>}

      {form.fields?.map(field => (
        <div key={field.id}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>

          {['text', 'email', 'tel', 'number', 'date'].includes(field.type) && (
            <input
              type={field.type}
              value={values[field.id] || ''}
              onChange={e => set(field.id, e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors[field.id] ? 'border-red-400' : 'border-gray-300'}`}
            />
          )}

          {field.type === 'textarea' && (
            <textarea
              value={values[field.id] || ''}
              onChange={e => set(field.id, e.target.value)}
              placeholder={field.placeholder}
              rows={4}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${errors[field.id] ? 'border-red-400' : 'border-gray-300'}`}
            />
          )}

          {field.type === 'select' && (
            <select
              value={values[field.id] || ''}
              onChange={e => set(field.id, e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors[field.id] ? 'border-red-400' : 'border-gray-300'}`}
            >
              <option value="">Select...</option>
              {field.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}

          {field.type === 'radio' && (
            <div className="space-y-2">
              {field.options?.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={field.id}
                    value={opt.value}
                    checked={values[field.id] === opt.value}
                    onChange={() => set(field.id, opt.value)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          )}

          {field.type === 'checkbox' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!values[field.id]}
                onChange={e => set(field.id, e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-sm text-gray-700">{field.checkbox_label || field.label}</span>
            </label>
          )}

          {errors[field.id] && (
            <p className="text-red-500 text-xs mt-1">{errors[field.id]}</p>
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Submitting...' : (form.submit_label || 'Submit')}
      </button>
    </form>
  );
}
