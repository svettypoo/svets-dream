'use client'
import { useState } from 'react'
import { Send, Users, FileText } from 'lucide-react'

export default function CampaignBuilder({ onSend }) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipients, setRecipients] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  async function handleSend(e) {
    e.preventDefault()
    setSending(true)
    setResult(null)
    const emailList = recipients.split(/[\n,]+/).map(e => e.trim()).filter(Boolean)
    try {
      const res = await fetch('/api/emails/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, htmlBody: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">${body.replace(/\n/g,'<br>')}</div>`, recipients: emailList }),
      })
      const data = await res.json()
      setResult(data)
    } finally {
      setSending(false)
    }
  }

  const recipientCount = recipients.split(/[\n,]+/).filter(e => e.trim()).length

  return (
    <form onSubmit={handleSend} className="space-y-5">
      <div>
        <label className="label flex items-center gap-1"><FileText size={13} /> Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} required className="input" placeholder="Your email subject line" />
      </div>

      <div>
        <label className="label flex items-center gap-1"><Users size={13} /> Recipients <span className="text-gray-400 font-normal ml-1">({recipientCount} emails)</span></label>
        <textarea value={recipients} onChange={e => setRecipients(e.target.value)} required className="input font-mono text-xs" rows={4} placeholder="one@example.com, two@example.com&#10;or one per line" />
      </div>

      <div>
        <label className="label">Message Body</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} required className="input" rows={8} placeholder="Write your email body here. Plain text is fine — it'll be wrapped in clean HTML." />
      </div>

      {result && (
        <div className={`rounded-lg p-3 text-sm ${result.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {result.error ? `Error: ${result.error}` : `✓ Sent to ${result.sent} recipients`}
        </div>
      )}

      <button type="submit" disabled={sending || !subject || !body || !recipients} className="btn btn-primary w-full">
        <Send size={14} className="mr-2" />
        {sending ? 'Sending…' : `Send to ${recipientCount || 0} recipients`}
      </button>
    </form>
  )
}
