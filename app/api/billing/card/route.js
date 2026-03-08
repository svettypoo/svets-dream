import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-server'
import { encryptCard } from '@/lib/spend-tracker'

export const runtime = 'nodejs'

export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { number, expiry, cvc, name } = await req.json()
  if (!number || !expiry || !cvc) {
    return Response.json({ error: 'Missing card fields' }, { status: 400 })
  }

  // Strip spaces from card number
  const cleanNumber = number.replace(/\s/g, '')
  if (!/^\d{13,19}$/.test(cleanNumber)) {
    return Response.json({ error: 'Invalid card number' }, { status: 400 })
  }

  const last4 = cleanNumber.slice(-4)
  const brand = detectBrand(cleanNumber)
  const secret = process.env.CARD_ENCRYPTION_SECRET || process.env.ANTHROPIC_API_KEY

  // Encrypt full card data
  const encrypted = encryptCard({ number: cleanNumber, expiry, cvc, name }, secret)

  const service = createServiceClient()
  await service.from('user_billing').upsert({
    user_id: user.id,
    card_last4: last4,
    card_brand: brand,
    card_exp: expiry,
    card_encrypted: encrypted,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  return Response.json({ last4, brand, exp: expiry })
}

function detectBrand(number) {
  if (/^4/.test(number)) return 'Visa'
  if (/^5[1-5]/.test(number)) return 'Mastercard'
  if (/^3[47]/.test(number)) return 'Amex'
  if (/^6(?:011|5)/.test(number)) return 'Discover'
  return 'Card'
}
