import { createServerSupabaseClient } from '@/lib/supabase-server'
import { readFile } from 'fs/promises'
import { join } from 'path'

export const runtime = 'nodejs'

// Runs the full supabase-schema.sql via the Supabase Management API.
// Requires SUPABASE_ACCESS_TOKEN in env (from app.supabase.com/account/tokens).
// Falls back to returning the SQL for manual paste if no token.
export async function POST() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Read schema file
  let sql
  try {
    sql = await readFile(join(process.cwd(), 'supabase-schema.sql'), 'utf8')
  } catch {
    return Response.json({ error: 'Schema file not found' }, { status: 500 })
  }

  // Extract project ref from URL: https://PROJECTREF.supabase.co
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const projectRef = supabaseUrl.replace('https://', '').split('.')[0]
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN

  if (!accessToken) {
    // No token — return SQL for manual paste
    return Response.json({ manual: true, sql, projectRef })
  }

  // Run via Management API — split on semicolons and run each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 5 && !s.startsWith('--'))

  const results = []
  for (const statement of statements) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: statement }),
      })
      const data = await res.json()
      results.push({ ok: res.ok, statement: statement.slice(0, 60), error: data.error || null })
    } catch (e) {
      results.push({ ok: false, statement: statement.slice(0, 60), error: e.message })
    }
  }

  const failed = results.filter(r => !r.ok)
  return Response.json({
    ok: failed.length === 0,
    results,
    failed: failed.length,
    total: results.length,
  })
}
