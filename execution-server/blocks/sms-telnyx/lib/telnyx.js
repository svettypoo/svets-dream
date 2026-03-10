// Telnyx SMS — send and receive SMS messages
// Requires TELNYX_API_KEY and TELNYX_FROM_NUMBER in env

const TELNYX_API = 'https://api.telnyx.com/v2'

export async function sendSMS({ to, body, from }) {
  const res = await fetch(`${TELNYX_API}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
    },
    body: JSON.stringify({
      from: from || process.env.TELNYX_FROM_NUMBER,
      to,
      text: body,
    }),
  })
  const data = await res.json()
  if (data.errors?.length) throw new Error(data.errors[0].detail)
  return data.data
}

// Generate a random 6-digit OTP, store in Supabase, send via SMS
export async function sendOTP({ to, supabase }) {
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min

  // Upsert OTP record
  await supabase.from('otps').upsert({ phone: to, code, expires_at }, { onConflict: 'phone' })

  await sendSMS({ to, body: `Your verification code is ${code}. Expires in 10 minutes.` })
  return { sent: true }
}

// Verify an OTP code
export async function verifyOTP({ phone, code, supabase }) {
  const { data } = await supabase.from('otps').select('*').eq('phone', phone).eq('code', code).single()
  if (!data) return { valid: false, reason: 'Invalid code' }
  if (new Date(data.expires_at) < new Date()) return { valid: false, reason: 'Code expired' }
  await supabase.from('otps').delete().eq('phone', phone)
  return { valid: true }
}
