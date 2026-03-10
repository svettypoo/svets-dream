// Email marketing campaign sender via Resend
// Usage: sendCampaign({ subject, htmlBody, recipients, fromName, fromEmail })

export async function sendCampaign({ subject, htmlBody, recipients, fromName, fromEmail }) {
  const from = `${fromName || 'Team'} <${fromEmail || process.env.RESEND_FROM}>`
  const results = []

  // Resend has batch send — send up to 100 at a time
  const chunks = []
  for (let i = 0; i < recipients.length; i += 100) {
    chunks.push(recipients.slice(i, i + 100))
  }

  for (const chunk of chunks) {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify(chunk.map(email => ({
        from,
        to: [email],
        subject,
        html: htmlBody,
      }))),
    })
    const data = await res.json()
    results.push(...(data.data || []))
  }

  return { sent: results.length, results }
}

export async function sendTransactional({ to, subject, html, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: [to], subject, html, reply_to: replyTo }),
  })
  return res.json()
}
