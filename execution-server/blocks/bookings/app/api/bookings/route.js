import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET(req) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const listingId = searchParams.get('listingId')
  let query = supabase.from('bookings').select('*, listings(title, images), profiles(full_name, avatar_url)').order('check_in', { ascending: false })
  if (userId) query = query.eq('guest_id', userId)
  if (listingId) query = query.eq('listing_id', listingId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req) {
  const supabase = createAdminClient()
  const body = await req.json()
  const { listing_id, check_in, check_out, guests, total_price } = body

  // Check for conflicts
  const { data: conflicts } = await supabase.from('bookings')
    .select('id')
    .eq('listing_id', listing_id)
    .neq('status', 'cancelled')
    .lt('check_in', check_out)
    .gt('check_out', check_in)

  if (conflicts?.length) return NextResponse.json({ error: 'Those dates are already booked' }, { status: 409 })

  const { data, error } = await supabase.from('bookings').insert({
    listing_id, check_in, check_out, guests, total_price,
    guest_id: body.guest_id || null,
    status: 'pending',
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req) {
  const supabase = createAdminClient()
  const { id, status } = await req.json()
  const { data, error } = await supabase.from('bookings').update({ status }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
