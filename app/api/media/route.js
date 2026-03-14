const MEDIA_URL = 'https://media.stproperties.com'
const MEDIA_TOKEN = 'svets-media-token-2026'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || ''
  const limit = searchParams.get('limit') || '50'
  const offset = searchParams.get('offset') || '0'

  const qs = new URLSearchParams({ limit, offset })
  if (type) qs.set('type', type)

  const res = await fetch(`${MEDIA_URL}/api/list?${qs}`, {
    headers: { Authorization: `Bearer ${MEDIA_TOKEN}` },
    next: { revalidate: 30 },
  })

  const data = await res.json()
  return Response.json(data)
}
