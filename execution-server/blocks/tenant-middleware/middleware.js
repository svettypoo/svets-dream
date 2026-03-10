import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const FORGE_API = process.env.FORGE_API_URL || 'https://svets-dream-production.up.railway.app'
const FORGE_TOKEN = process.env.FORGE_EXEC_TOKEN || ''
const TENANT_ID = process.env.FORGE_TENANT_ID || ''

// Meter a usage event — fire-and-forget, never blocks the request
function meterUsage(type, quantity = 1, meta = {}) {
  if (!TENANT_ID) return
  fetch(`${FORGE_API}/forge/usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FORGE_TOKEN}` },
    body: JSON.stringify({ tenantId: TENANT_ID, type, quantity, meta }),
  }).catch(() => {}) // silent fail — never block the user
}

export { meterUsage, TENANT_ID }

// Next.js middleware — runs on every request
export async function middleware(request) {
  const response = NextResponse.next()

  // Supabase session refresh
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  await supabase.auth.getUser()

  // Meter API calls (for usage billing)
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/api/') && request.method === 'POST') {
    const route = pathname.replace('/api/', '')
    if (route.includes('email')) meterUsage('email', 1, { route: pathname })
    else if (route.includes('sms')) meterUsage('sms', 1, { route: pathname })
    else if (route.includes('upload')) meterUsage('storage_mb', 1, { route: pathname })
    else if (route.includes('ai')) meterUsage('ai_tokens', 1000, { route: pathname })
    else meterUsage('api_call', 1, { route: pathname })
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
