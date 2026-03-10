// TEMPLATE: Replace TABLE_NAME, ALLOWED_COLUMNS, required_fields with your values
// Copy to app/api/[your-resource]/route.js

import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

const TABLE_NAME = 'your_table'          // ← change this
const ALLOWED_COLUMNS = ['name', 'description', 'status']  // ← change this
const REQUIRED_FIELDS = ['name']         // ← change this

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const supabase = createAdminClient()

  let query = supabase.from(TABLE_NAME).select('*').order('created_at', { ascending: false })

  const limit = parseInt(searchParams.get('limit')) || 100
  const offset = parseInt(searchParams.get('offset')) || 0
  query = query.range(offset, offset + limit - 1)

  // Optional filter: ?status=active
  const status = searchParams.get('status')
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req) {
  const body = await req.json()
  const supabase = createAdminClient()

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!body[field]) return NextResponse.json({ error: `${field} is required` }, { status: 400 })
  }

  // Only pick allowed columns
  const row = Object.fromEntries(ALLOWED_COLUMNS.filter(k => body[k] !== undefined).map(k => [k, body[k]]))

  const { data, error } = await supabase.from(TABLE_NAME).insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req) {
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const supabase = createAdminClient()

  const row = Object.fromEntries(ALLOWED_COLUMNS.filter(k => updates[k] !== undefined).map(k => [k, updates[k]]))

  const { data, error } = await supabase.from(TABLE_NAME).update(row).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const supabase = createAdminClient()

  const { error } = await supabase.from(TABLE_NAME).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
