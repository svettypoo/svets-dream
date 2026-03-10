import { readFileSync } from 'fs'
import path from 'path'

export const runtime = 'nodejs'

const WORKSPACE_ROOT = '/root/workspace'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain',
  '.md':   'text/plain',
}

export async function GET(req, { params }) {
  const { workspaceId, slug } = await params
  const filePath = (slug && slug.length > 0) ? slug.join('/') : 'index.html'

  // Security: no path traversal
  const resolved = path.resolve(WORKSPACE_ROOT, workspaceId, filePath)
  if (!resolved.startsWith(path.resolve(WORKSPACE_ROOT))) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const content = readFileSync(resolved)
    const ext = path.extname(filePath).toLowerCase()
    const mimeType = MIME[ext] || 'application/octet-stream'
    return new Response(content, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'no-store',
        // Allow iframe embedding from same origin
        'X-Frame-Options': 'SAMEORIGIN',
      },
    })
  } catch {
    // Try index.html as fallback (SPA support)
    if (filePath !== 'index.html') {
      try {
        const fallback = readFileSync(path.join(WORKSPACE_ROOT, workspaceId, 'index.html'))
        return new Response(fallback, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
      } catch {}
    }
    return new Response('Not found', { status: 404 })
  }
}
