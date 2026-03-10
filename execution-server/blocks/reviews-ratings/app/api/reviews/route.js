import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET(req) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(req.url)
  const listingId = searchParams.get('listingId')
  const userId = searchParams.get('userId')
  let query = supabase.from('reviews').select('*, profiles(full_name, avatar_url)').order('created_at', { ascending: false })
  if (listingId) query = query.eq('listing_id', listingId)
  if (userId) query = query.eq('reviewer_id', userId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const avg = data.length ? data.reduce((sum, r) => sum + r.rating, 0) / data.length : null
  return NextResponse.json({ reviews: data, average: avg, total: data.length })
}

export async function POST(req) {
  const supabase = createAdminClient()
  const { listing_id, reviewer_id, rating, body } = await req.json()
  if (!listing_id || !rating) return NextResponse.json({ error: 'listing_id and rating required' }, { status: 400 })

  const { data, error } = await supabase.from('reviews').insert({ listing_id, reviewer_id, rating, body }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update listing average rating
  const { data: reviews } = await supabase.from('reviews').select('rating').eq('listing_id', listing_id)
  if (reviews) {
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    await supabase.from('listings').update({ rating: parseFloat(avg.toFixed(2)), review_count: reviews.length }).eq('id', listing_id)
  }

  return NextResponse.json(data, { status: 201 })
}
