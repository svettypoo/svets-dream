import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export const config = { api: { bodyParser: false } }

export async function POST(req) {
  try {
    const supabase = createAdminClient()
    const formData = await req.formData()
    const file = formData.get('file')
    const bucket = formData.get('bucket') || 'uploads'
    const folder = formData.get('folder') || ''

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const ext = file.name.split('.').pop()
    const filename = `${folder ? folder + '/' : ''}${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { data, error } = await supabase.storage.from(bucket).upload(filename, buffer, {
      contentType: file.type,
      upsert: false,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(filename)
    return NextResponse.json({ ok: true, path: filename, url: urlData.publicUrl })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
