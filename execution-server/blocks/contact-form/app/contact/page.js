'use client'
import { useState } from 'react'
import { Mail, MessageSquare, Send } from 'lucide-react'

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' })
  const [status, setStatus] = useState(null) // null | 'sending' | 'sent' | 'error'

  function update(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus('sending')
    try {
      const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json()
      setStatus(data.ok ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center">
          <div className="text-4xl mb-4">✉️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Message sent!</h2>
          <p className="text-gray-500 mb-6">We'll get back to you within 24 hours.</p>
          <button onClick={() => { setForm({ name: '', email: '', subject: '', message: '' }); setStatus(null) }} className="btn btn-secondary">Send another message</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-20 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Get in touch</h1>
          <p className="text-gray-500">Have a question or feedback? We'd love to hear from you.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[
            { icon: <Mail size={20} />, title: 'Email', value: 'hello@yourdomain.com' },
            { icon: <MessageSquare size={20} />, title: 'Chat', value: 'Available 9am–6pm EST' },
          ].map(item => (
            <div key={item.title} className="card flex items-center gap-3 p-4">
              <div className="text-brand-600">{item.icon}</div>
              <div>
                <div className="font-medium text-gray-900 text-sm">{item.title}</div>
                <div className="text-xs text-gray-500">{item.value}</div>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Name</label>
              <input value={form.name} onChange={e => update('name', e.target.value)} required className="input" placeholder="Your name" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)} required className="input" placeholder="you@example.com" />
            </div>
          </div>
          <div>
            <label className="label">Subject</label>
            <input value={form.subject} onChange={e => update('subject', e.target.value)} required className="input" placeholder="How can we help?" />
          </div>
          <div>
            <label className="label">Message</label>
            <textarea value={form.message} onChange={e => update('message', e.target.value)} required className="input" rows={5} placeholder="Tell us more…" />
          </div>
          {status === 'error' && <p className="text-sm text-red-600">Something went wrong. Please try again.</p>}
          <button type="submit" disabled={status === 'sending'} className="btn btn-primary w-full">
            <Send size={14} className="mr-2" />
            {status === 'sending' ? 'Sending…' : 'Send Message'}
          </button>
        </form>
      </div>
    </div>
  )
}
