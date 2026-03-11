/**
 * Svet's Dream — Execution Server
 *
 * A persistent Node.js server that runs bash commands on behalf of AI agents.
 * Deployed on a real server (not serverless) so npm, git, vercel CLI, etc. are available.
 *
 * API:
 *   POST /run
 *     Body: { command: string, cwd?: string, sessionId?: string }
 *     Auth: Authorization: Bearer <EXEC_TOKEN>
 *     Returns: text/plain streaming — stdout + stderr lines
 *
 *   GET /health
 *     Returns: { ok: true, uptime: N }
 *
 *   POST /write
 *     Body: { path: string, content: string }
 *     Auth: Bearer <EXEC_TOKEN>
 *     Returns: { ok: true }
 *
 *   GET /read?path=...
 *     Auth: Bearer <EXEC_TOKEN>
 *     Returns: file content as text/plain
 */

const http = require('http')
const { spawn, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ── Forge preview tracker ──────────────────────────────────────────────────────
// Maps workspaceId → { process, port, appDir, startedAt }
const forgePreviews = new Map()
let nextPreviewPort = 4100
function getFreePreviewPort() {
  const p = nextPreviewPort++
  if (nextPreviewPort > 4199) nextPreviewPort = 4100
  return p
}

// ── Browser session manager ───────────────────────────────────────────────────
// Keeps one Playwright browser context per sessionId so the page persists
// across multiple tool calls within the same conversation.
const browserSessions = new Map() // sessionId → { browser, context, page }

// ── Agent session cache ────────────────────────────────────────────────────────
// Maps workspaceId → Claude Code SDK session_id for session resumption.
// Resuming a session re-uses the KV cache for the prior conversation (~80% token
// savings on repeated context) and gives the agent true multi-turn memory.
const agentSessions = new Map() // workspaceId → session_id string
const SESSIONS_FILE = '/root/workspace/.sessions.json'

// Load persisted sessions on startup (survive server restarts)
;(function loadSessions() {
  try {
    const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))
    for (const [k, v] of Object.entries(saved)) agentSessions.set(k, v)
    console.log(`[agent-sessions] loaded ${agentSessions.size} saved sessions`)
  } catch {}
})()

function persistSessions() {
  try {
    fs.mkdirSync('/root/workspace', { recursive: true })
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(agentSessions)), 'utf8')
  } catch {}
}

async function getSession(sessionId) {
  if (browserSessions.has(sessionId)) return browserSessions.get(sessionId)
  const { chromium } = require('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  })
  const page = await context.newPage()
  const session = { browser, context, page }
  browserSessions.set(sessionId, session)
  return session
}

async function closeSession(sessionId) {
  if (!browserSessions.has(sessionId)) return
  const { browser } = browserSessions.get(sessionId)
  await browser.close().catch(() => {})
  browserSessions.delete(sessionId)
}

async function handleBrowser(action, sessionId, params) {
  try {
    if (action === 'close') {
      await closeSession(sessionId)
      return { ok: true, message: 'Browser session closed.' }
    }

    const session = await getSession(sessionId)
    const { page } = session

    if (action === 'navigate') {
      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      const title = await page.title()
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, title, url: page.url(), screenshot: screenshot.toString('base64') }
    }

    if (action === 'screenshot') {
      const screenshot = await page.screenshot({ type: 'png', fullPage: params.fullPage || false })
      const title = await page.title()
      return { ok: true, title, url: page.url(), screenshot: screenshot.toString('base64') }
    }

    if (action === 'click') {
      // Try selector first, then text match
      try {
        await page.click(params.selector, { timeout: 10000 })
      } catch {
        await page.getByText(params.selector).first().click({ timeout: 10000 })
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, url: page.url(), screenshot: screenshot.toString('base64') }
    }

    if (action === 'fill') {
      await page.fill(params.selector, params.value, { timeout: 10000 })
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, screenshot: screenshot.toString('base64') }
    }

    if (action === 'read') {
      const selector = params.selector || 'body'
      const text = await page.locator(selector).innerText({ timeout: 10000 }).catch(() => '')
      const url = page.url()
      const title = await page.title()
      return { ok: true, text: text.slice(0, 8000), url, title }
    }

    if (action === 'key_press') {
      await page.keyboard.press(params.key || 'Enter')
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, url: page.url(), screenshot: screenshot.toString('base64') }
    }

    if (action === 'eval') {
      // Execute arbitrary JS expression in page context, then return screenshot
      // Wrap in IIFE if it looks like a function expression
      const expr = params.code.trim()
      const wrapped = (expr.startsWith('(') || expr.startsWith('function') || expr.startsWith('async')) ? `(${expr})()` : expr
      const result = await page.evaluate(wrapped).catch(e => 'eval error: ' + e.message)
      await page.waitForTimeout(params.wait || 500)
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, result, url: page.url(), screenshot: screenshot.toString('base64') }
    }

    if (action === 'mouse_click') {
      await page.mouse.click(params.x, params.y)
      await page.waitForTimeout(params.wait || 1000)
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, url: page.url(), screenshot: screenshot.toString('base64') }
    }

    return { ok: false, error: `Unknown action: ${action}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

const PORT = process.env.PORT || 3333
const EXEC_TOKEN = process.env.EXEC_TOKEN || 'dev-token-change-in-prod'
const HOME = process.env.HOME || os.homedir()
const WORK_DIR = process.env.WORK_DIR || path.join(HOME, 'workspace')

// Detect bash binary (handles Windows with Git Bash)
const BASH = (() => {
  const candidates = [
    process.env.SHELL,
    process.env.BASH,
    'C:\\Users\\pargo_pxnd4wa\\scoop\\apps\\git\\current\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    '/bin/bash',
    '/usr/bin/bash',
    'bash',
  ]
  for (const p of candidates) {
    if (!p) continue
    if (p === 'bash') return p
    try { fs.accessSync(p); return p } catch {}
  }
  return 'bash'
})()

// Ensure workspace exists and is writable
fs.mkdirSync(WORK_DIR, { recursive: true })
try { fs.chmodSync(WORK_DIR, 0o777) } catch {}

// ── Block library sync ────────────────────────────────────────────────────────
// Copies execution-server/blocks/ → /root/workspace/__BLOCKS__/ on every startup.
// Agents read from __BLOCKS__/ to scaffold new apps.
const BLOCKS_SRC = path.join(__dirname, 'blocks')
const BLOCKS_DST = path.join(WORK_DIR, '__BLOCKS__')
;(function syncBlocks() {
  try {
    if (fs.existsSync(BLOCKS_SRC)) {
      execSync(`cp -r "${BLOCKS_SRC}/." "${BLOCKS_DST}"`, { timeout: 30000 })
      console.log(`[blocks] synced to ${BLOCKS_DST}`)
    }
  } catch (e) {
    console.error('[blocks] sync failed:', e.message)
  }
})()

// ── Backup system ─────────────────────────────────────────────────────────────
// Backups live in WORK_DIR/__BACKUPS__/<YYYY-MM-DD_HH-MM-SS>/
// Each backup is a timestamped snapshot of everything in WORK_DIR (excluding __BACKUPS__ itself).
// A __READONLY__DO_NOT_EDIT__ marker file is written inside every backup to make its purpose
// unmistakable — never treat these directories as active workspaces.
// Retention: 48 hours. Pruned automatically on every backup run.
// ─────────────────────────────────────────────────────────────────────────────
const BACKUP_DIR = path.join(WORK_DIR, '__BACKUPS__')
const BACKUP_RETENTION_MS = 48 * 60 * 60 * 1000 // 48 hours

fs.mkdirSync(BACKUP_DIR, { recursive: true })

function runBackup() {
  const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
  // e.g. "2026-03-10_14-30-00"
  const dest = path.join(BACKUP_DIR, ts)
  try {
    fs.mkdirSync(dest, { recursive: true })
    const entries = fs.readdirSync(WORK_DIR)
    for (const entry of entries) {
      if (entry === '__BACKUPS__') continue // never back up the backup folder itself
      const src = path.join(WORK_DIR, entry)
      const dst = path.join(dest, entry)
      execSync(`cp -r "${src}" "${dst}"`, { timeout: 120000 })
    }
    // Unmistakable read-only marker — prevents any agent or Claude instance from writing here
    fs.writeFileSync(
      path.join(dest, '__READONLY__DO_NOT_EDIT__'),
      [
        '════════════════════════════════════════════════════════════',
        '  READ-ONLY RECOVERY SNAPSHOT — DO NOT WRITE FILES HERE',
        '════════════════════════════════════════════════════════════',
        `  Created : ${new Date().toISOString()}`,
        `  Snapshot: ${ts}`,
        '',
        '  This directory is a timestamped backup of /root/workspace/.',
        '  It is NOT an active workspace. Never write to it.',
        '',
        '  To restore this snapshot:',
        `    POST /backup/restore   { "timestamp": "${ts}" }`,
        '',
        '  To list all available snapshots:',
        '    GET /backups',
        '════════════════════════════════════════════════════════════',
      ].join('\n')
    )
    console.log(`[backup] ✅ snapshot created: ${ts}`)
    pruneBackups()
  } catch (err) {
    console.error(`[backup] ❌ failed: ${err.message}`)
  }
}

function pruneBackups() {
  try {
    const now = Date.now()
    for (const entry of fs.readdirSync(BACKUP_DIR)) {
      const fullPath = path.join(BACKUP_DIR, entry)
      try {
        const stat = fs.statSync(fullPath)
        if (now - stat.ctimeMs > BACKUP_RETENTION_MS) {
          execSync(`rm -rf "${fullPath}"`, { timeout: 30000 })
          console.log(`[backup] 🗑  pruned: ${entry}`)
        }
      } catch {}
    }
  } catch {}
}

// Run once on startup (so there's always at least one snapshot), then every hour
runBackup()
setInterval(runBackup, 60 * 60 * 1000)

console.log(`[exec-server] starting on :${PORT}`)
console.log(`[exec-server] workspace: ${WORK_DIR}`)
console.log(`[exec-server] home: ${HOME}`)

function auth(req) {
  const header = req.headers['authorization'] || ''
  const token = header.replace(/^Bearer\s+/i, '')
  return token === EXEC_TOKEN
}

function resolvePath(p) {
  if (!p) return WORK_DIR
  // Replace ~ with HOME
  const expanded = p.replace(/^~\//, HOME + '/').replace(/^~$/, HOME)
  // If relative, resolve against WORK_DIR
  if (!path.isAbsolute(expanded)) return path.join(WORK_DIR, expanded)
  return expanded
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Health check (no auth)
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, uptime: process.uptime(), workDir: WORK_DIR }))
    return
  }

  // Auth check for all other routes
  if (!auth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  // POST /run — execute a bash command with streaming output
  if (req.method === 'POST' && url.pathname === '/run') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      let cmd, cwd, sessionId, timeout

      try {
        const parsed = JSON.parse(body)
        cmd = parsed.command
        cwd = resolvePath(parsed.cwd)
        sessionId = parsed.sessionId || 'default'
        timeout = parseInt(parsed.timeout) || 120000
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
      }

      if (!cmd) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing command' }))
        return
      }

      // Ensure cwd exists
      try { fs.mkdirSync(cwd, { recursive: true }) } catch {}

      console.log(`[exec-server] [${sessionId}] run: ${cmd.slice(0, 120)} (cwd: ${cwd})`)

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Session-Id': sessionId,
      })

      const child = spawn(BASH, ['-c', cmd], {
        cwd,
        env: {
          ...process.env,
          HOME,
          FORCE_COLOR: '0',
          TERM: 'dumb',
        },
        timeout,
      })

      let exited = false

      child.stdout.on('data', data => {
        if (!res.writableEnded) res.write(data)
      })

      child.stderr.on('data', data => {
        if (!res.writableEnded) res.write(data)
      })

      child.on('close', code => {
        exited = true
        if (!res.writableEnded) {
          res.write(`\n[exit: ${code}]`)
          res.end()
        }
        console.log(`[exec-server] [${sessionId}] exit: ${code}`)
      })

      child.on('error', err => {
        if (!exited && !res.writableEnded) {
          res.write(`\n[error: ${err.message}]`)
          res.end()
        }
      })

      // Note: intentionally not killing child on req close — command should run to completion
    })
    return
  }

  // POST /write — write a file
  if (req.method === 'POST' && url.pathname === '/write') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { path: filePath, content } = JSON.parse(body)
        const resolved = resolvePath(filePath)
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, content, 'utf8')
        console.log(`[exec-server] wrote: ${resolved} (${content.length} chars)`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: resolved, bytes: content.length }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // GET /read?path=...
  if (req.method === 'GET' && url.pathname === '/read') {
    try {
      const filePath = url.searchParams.get('path')
      const resolved = resolvePath(filePath)
      const content = fs.readFileSync(resolved, 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(content)
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // GET /ls?path=...&recursive=true
  if (req.method === 'GET' && url.pathname === '/ls') {
    try {
      const dirPath = resolvePath(url.searchParams.get('path'))
      const recursive = url.searchParams.get('recursive') === 'true'

      function readTree(dir, depth = 0) {
        if (depth > 6) return [] // safety limit
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        return entries
          .filter(e => e.name !== '__BACKUPS__') // never expose backups
          .map(e => {
            const fullPath = path.join(dir, e.name)
            const isDir = e.isDirectory()
            let size = null
            if (!isDir) {
              try { size = fs.statSync(fullPath).size } catch {}
            }
            const node = { name: e.name, type: isDir ? 'dir' : 'file', size }
            if (isDir && recursive) node.children = readTree(fullPath, depth + 1)
            return node
          })
      }

      const files = readTree(dirPath)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(files))
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // POST /browser — persistent browser session actions
  if (req.method === 'POST' && url.pathname === '/browser') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { action, sessionId = 'default', ...params } = JSON.parse(body)
        console.log(`[exec-server] [${sessionId}] browser.${action}`)
        const result = await handleBrowser(action, sessionId, params)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // GET /backups — list available recovery snapshots
  if (req.method === 'GET' && url.pathname === '/backups') {
    try {
      const snapshots = fs.readdirSync(BACKUP_DIR)
        .filter(e => fs.statSync(path.join(BACKUP_DIR, e)).isDirectory())
        .sort()
        .reverse() // newest first
        .map(name => {
          const stat = fs.statSync(path.join(BACKUP_DIR, name))
          const ageHours = ((Date.now() - stat.ctimeMs) / 3_600_000).toFixed(1)
          return { timestamp: name, createdAt: stat.ctime.toISOString(), ageHours: parseFloat(ageHours) }
        })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, snapshots }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // POST /backup — trigger a manual snapshot immediately
  if (req.method === 'POST' && url.pathname === '/backup') {
    runBackup()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, message: 'Backup triggered — check /backups for new snapshot' }))
    return
  }

  // POST /backup/restore — restore workspace to a specific snapshot
  // Body: { "timestamp": "2026-03-10_14-30-00" }
  // WARNING: overwrites current workspace contents with snapshot contents.
  if (req.method === 'POST' && url.pathname === '/backup/restore') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { timestamp } = JSON.parse(body)
        if (!timestamp) throw new Error('timestamp required')
        const src = path.join(BACKUP_DIR, timestamp)
        if (!fs.existsSync(src)) throw new Error(`Snapshot not found: ${timestamp}`)
        // Back up current state before restoring
        runBackup()
        // Restore: for each entry in snapshot (skip the readonly marker), copy to workspace
        const entries = fs.readdirSync(src).filter(e => e !== '__READONLY__DO_NOT_EDIT__')
        for (const entry of entries) {
          const s = path.join(src, entry)
          const d = path.join(WORK_DIR, entry)
          execSync(`rm -rf "${d}" && cp -r "${s}" "${d}"`, { timeout: 60000 })
        }
        console.log(`[backup] ♻️  restored snapshot: ${timestamp}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, restored: timestamp }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // POST /forge/assemble — smart deterministic app scaffold with live streaming
  // 1. Haiku extracts entities/nav/colors/copy from description (~1-2s)
  // 2. Each block generates its files using that config (deterministic, instant)
  // 3. Streams NDJSON events: block_start, file_write, install_line, complete
  // Body: { description, appName, blocks: string[], workspaceId }
  if (req.method === 'POST' && url.pathname === '/forge/assemble') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      let parsed
      try { parsed = JSON.parse(body) } catch {
        res.writeHead(400); res.end(JSON.stringify({ error: 'bad json' })); return
      }
      const { description, appName = 'my-app', blocks = [], workspaceId } = parsed
      const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const appDir = path.join(WORK_DIR, workspaceId || `forge-${Date.now()}`, slug)
      fs.mkdirSync(appDir, { recursive: true })

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
      })

      function emit(obj) {
        if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n')
      }

      try {
        // ── Step 1: Haiku analysis ──────────────────────────────────────────
        emit({ type: 'analyze_start', message: 'Reading your description…' })

        const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''
        let config = {}
        if (ANTHROPIC_KEY) {
          const haikusPrompt = `You are a senior web app architect. Analyze this app and return ONLY valid JSON, no markdown.

App name: "${appName}"
Description: "${description}"
Blocks being used: ${blocks.join(', ')}

Return this exact JSON structure (fill in all values for this specific app):
{
  "slug": "${slug}",
  "appName": "${appName}",
  "description": "${description}",
  "tagline": "one short sentence tagline",
  "headline": "compelling marketing headline (under 10 words)",
  "subheadline": "one sentence expanding on the headline (under 20 words)",
  "ctaText": "call-to-action button text",
  "primaryColor": "#0EA5E9",
  "primaryColorName": "sky",
  "entities": [
    {
      "name": "booking",
      "plural": "bookings",
      "label": "Bookings",
      "fields": ["id", "guest_name", "check_in", "check_out", "status", "amount"],
      "required": ["guest_name", "check_in"],
      "statusValues": ["pending", "confirmed", "cancelled"]
    }
  ],
  "navItems": [
    { "href": "/dashboard", "label": "Overview", "icon": "LayoutDashboard" },
    { "href": "/dashboard/bookings", "label": "Bookings", "icon": "Calendar" }
  ],
  "aiSystemPrompt": "You are a helpful assistant for ${appName}. Help users with questions about [relevant domain].",
  "aiChatPlaceholder": "Ask about your [entities]…"
}`

          const haikusPayload = JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{ role: 'user', content: haikusPrompt }],
          })

          config = await new Promise(resolve => {
            const https = require('https')
            const r = https.request({
              hostname: 'api.anthropic.com',
              path: '/v1/messages',
              method: 'POST',
              headers: {
                'x-api-key': ANTHROPIC_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(haikusPayload),
              },
            }, res2 => {
              let d = ''
              res2.on('data', c => d += c)
              res2.on('end', () => {
                try {
                  const body2 = JSON.parse(d)
                  const text = body2?.content?.[0]?.text || '{}'
                  const jsonMatch = text.match(/\{[\s\S]*\}/)
                  resolve(jsonMatch ? JSON.parse(jsonMatch[0]) : {})
                } catch { resolve({}) }
              })
            })
            r.on('error', () => resolve({}))
            r.write(haikusPayload)
            r.end()
          })
        }

        // Fallback config if Haiku unavailable
        config = {
          slug,
          appName,
          description,
          tagline: `${appName} — built with Forge`,
          headline: `The smarter way to manage ${appName}`,
          subheadline: `Everything you need, nothing you don\'t.`,
          ctaText: 'Get started free',
          primaryColor: '#6366f1',
          primaryColorName: 'indigo',
          entities: [{ name: 'item', plural: 'items', label: 'Items', fields: ['id', 'name', 'status', 'created_at'], required: ['name'], statusValues: ['active', 'inactive'] }],
          navItems: [
            { href: '/dashboard', label: 'Overview', icon: 'LayoutDashboard' },
            { href: '/dashboard/items', label: 'Items', icon: 'List' },
          ],
          aiSystemPrompt: `You are a helpful assistant for ${appName}.`,
          aiChatPlaceholder: 'Ask me anything…',
          ...config,
        }

        emit({ type: 'analyze_done', config })

        // ── Helper: write a file and emit event ────────────────────────────
        function writeFile(relPath, content) {
          const fullPath = path.join(appDir, relPath)
          fs.mkdirSync(path.dirname(fullPath), { recursive: true })
          fs.writeFileSync(fullPath, content, 'utf8')
          emit({ type: 'file_write', path: relPath, preview: content.slice(0, 200) })
        }

        // ── Helper: substitute all config tokens in a string ───────────────
        function sub(str) {
          return str
            .replace(/\{\{APP_NAME\}\}/g, config.appName)
            .replace(/\{\{APP_SLUG\}\}/g, config.slug)
            .replace(/\{\{APP_DESCRIPTION\}\}/g, config.description)
            .replace(/\{\{APP_TAGLINE\}\}/g, config.tagline)
            .replace(/\{\{HEADLINE\}\}/g, config.headline)
            .replace(/\{\{SUBHEADLINE\}\}/g, config.subheadline)
            .replace(/\{\{CTA_TEXT\}\}/g, config.ctaText || 'Get started')
            .replace(/\{\{PRIMARY_COLOR\}\}/g, config.primaryColor)
            .replace(/\{\{PRIMARY_COLOR_NAME\}\}/g, config.primaryColorName)
            .replace(/\{\{AI_SYSTEM_PROMPT\}\}/g, config.aiSystemPrompt)
            .replace(/\{\{AI_CHAT_PLACEHOLDER\}\}/g, config.aiChatPlaceholder)
        }

        // ── Helper: copy a block file with substitution ────────────────────
        function copyBlockFile(blockId, srcRel, destRel) {
          const srcPath = path.join(BLOCKS_SRC, blockId, srcRel)
          if (!fs.existsSync(srcPath)) return
          const content = sub(fs.readFileSync(srcPath, 'utf8'))
          writeFile(destRel || srcRel, content)
        }

        // ── Block assemblers ───────────────────────────────────────────────
        const ASSEMBLERS = {

          'next-shell': () => {
            emit({ type: 'block_start', id: 'next-shell', name: 'Next.js Shell', icon: '⚡' })
            const pkg = {
              name: config.slug,
              version: '0.1.0',
              private: true,
              scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
              dependencies: {
                next: '14.2.3', react: '^18', 'react-dom': '^18',
                '@supabase/supabase-js': '^2.39.0', '@supabase/ssr': '^0.3.0',
                '@anthropic-ai/sdk': '^0.20.0',
                'lucide-react': '^0.344.0', clsx: '^2.1.0',
              },
              devDependencies: { tailwindcss: '^3.4.1', postcss: '^8', autoprefixer: '^10.0.1' },
            }
            writeFile('package.json', JSON.stringify(pkg, null, 2))
            writeFile('next.config.js', `/** @type {import('next').NextConfig} */\nmodule.exports = { images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] } }\n`)
            writeFile('tailwind.config.js', `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],\n  theme: { extend: {} },\n  plugins: [],\n}\n`)
            writeFile('postcss.config.js', `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }\n`)
            writeFile('app/globals.css', sub(fs.readFileSync(path.join(BLOCKS_SRC, 'next-shell', 'app', 'globals.css'), 'utf8')))
            writeFile('app/layout.js', `import './globals.css'\nexport const metadata = { title: '${config.appName}', description: '${config.description}' }\nexport default function RootLayout({ children }) {\n  return <html lang="en"><body className="min-h-screen bg-gray-50 text-gray-900 antialiased">{children}</body></html>\n}\n`)
            emit({ type: 'block_done', id: 'next-shell' })
          },

          'supabase': () => {
            emit({ type: 'block_start', id: 'supabase', name: 'Supabase', icon: '🗄️' })
            copyBlockFile('supabase', 'lib/supabase-browser.js', 'lib/supabase-browser.js')
            copyBlockFile('supabase', 'lib/supabase-server.js', 'lib/supabase-server.js')
            copyBlockFile('supabase', 'middleware.js', 'middleware.js')
            emit({ type: 'block_done', id: 'supabase' })
          },

          'auth-email': () => {
            emit({ type: 'block_start', id: 'auth-email', name: 'Email Auth', icon: '🔐' })
            copyBlockFile('auth', 'app/login/page.js', 'app/login/page.js')
            copyBlockFile('auth', 'app/api/auth/route.js', 'app/api/auth/route.js')
            // signup page
            writeFile('app/signup/page.js', `'use client'\nimport { useState } from 'react'\nimport { useRouter } from 'next/navigation'\nimport { createClient } from '@/lib/supabase-browser'\n\nexport default function SignupPage() {\n  const router = useRouter()\n  const [email, setEmail] = useState('')\n  const [password, setPassword] = useState('')\n  const [loading, setLoading] = useState(false)\n  const [error, setError] = useState('')\n\n  async function handleSignup(e) {\n    e.preventDefault()\n    setLoading(true)\n    const supabase = createClient()\n    const { error } = await supabase.auth.signUp({ email, password })\n    if (error) { setError(error.message); setLoading(false) }\n    else router.push('/dashboard')\n  }\n\n  return (\n    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">\n      <div className="w-full max-w-md card">\n        <h1 className="text-2xl font-bold mb-2">Create account</h1>\n        <form onSubmit={handleSignup} className="space-y-4 mt-4">\n          <div><label className="label">Email</label><input type="email" className="input" required value={email} onChange={e=>setEmail(e.target.value)} /></div>\n          <div><label className="label">Password</label><input type="password" className="input" required value={password} onChange={e=>setPassword(e.target.value)} /></div>\n          {error && <p className="text-sm text-red-600">{error}</p>}\n          <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Creating…' : 'Create account'}</button>\n        </form>\n        <p className="mt-4 text-center text-sm text-gray-500">Already have an account? <a href="/login" className="text-brand-600 hover:underline">Sign in</a></p>\n      </div>\n    </div>\n  )\n}\n`)
            emit({ type: 'block_done', id: 'auth-email' })
          },

          'dashboard-layout': () => {
            emit({ type: 'block_start', id: 'dashboard-layout', name: 'Dashboard Layout', icon: '🧭' })
            // Smart: generate Sidebar with actual nav items from config
            const navLines = config.navItems.map(n =>
              `  { href: '${n.href}', label: '${n.label}', icon: '${n.icon || 'Circle'}' },`
            ).join('\n')
            writeFile('components/Sidebar.jsx', `'use client'\nimport { useState } from 'react'\nimport Link from 'next/link'\nimport { usePathname } from 'next/navigation'\nimport { ${[...new Set(config.navItems.map(n => n.icon || 'Circle')), 'LogOut', 'Menu', 'X'].join(', ')} } from 'lucide-react'\n\nconst NAV = [\n${navLines}\n]\n\nexport default function Sidebar({ user }) {\n  const pathname = usePathname()\n  const [open, setOpen] = useState(false)\n  return (\n    <>\n      <button className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-lg bg-white shadow border" onClick={() => setOpen(v=>!v)}>{open ? <X size={18}/> : <Menu size={18}/>}</button>\n      {open && <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={()=>setOpen(false)}/>}\n      <aside className={\`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-200 \${open?'translate-x-0':'-translate-x-full'} lg:relative lg:translate-x-0\`}>\n        <div className="h-16 flex items-center px-6 border-b border-gray-200">\n          <span className="text-lg font-bold text-brand-600">${config.appName}</span>\n        </div>\n        <nav className="flex-1 px-3 py-4 space-y-1">\n          {NAV.map(item => {\n            const active = pathname === item.href || pathname.startsWith(item.href + '/')\n            return <Link key={item.href} href={item.href} onClick={()=>setOpen(false)} className={\`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors \${active?'bg-brand-50 text-brand-700':'text-gray-600 hover:bg-gray-100'}\`}>{item.label}</Link>\n          })}\n        </nav>\n        {user && <div className="border-t p-4"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-semibold text-brand-700">{user.email?.[0]?.toUpperCase()}</div><p className="text-xs font-medium text-gray-900 truncate flex-1">{user.email}</p></div></div>}\n      </aside>\n    </>\n  )\n}\n`)
            writeFile('app/dashboard/layout.js', `import { createClient } from '@/lib/supabase-server'\nimport { redirect } from 'next/navigation'\nimport Sidebar from '@/components/Sidebar'\n\nexport default async function DashboardLayout({ children }) {\n  const supabase = createClient()\n  const { data: { user } } = await supabase.auth.getUser()\n  if (!user) redirect('/login')\n  return (\n    <div className="flex h-screen overflow-hidden bg-gray-50">\n      <Sidebar user={user} />\n      <main className="flex-1 overflow-y-auto"><div className="p-6 lg:p-8 max-w-7xl mx-auto">{children}</div></main>\n    </div>\n  )\n}\n`)
            writeFile('app/dashboard/page.js', `import { createClient } from '@/lib/supabase-server'\n\nexport default async function DashboardPage() {\n  const supabase = createClient()\n  const { data: { user } } = await supabase.auth.getUser()\n  return (\n    <div>\n      <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome back 👋</h1>\n      <p className="text-gray-500 text-sm mb-8">{user?.email}</p>\n      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">\n        ${config.entities.map(e => `<div className="card"><h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">${e.label}</h3><p className="text-3xl font-bold text-gray-900 mt-1">—</p></div>`).join('\n        ')}\n      </div>\n    </div>\n  )\n}\n`)
            emit({ type: 'block_done', id: 'dashboard-layout' })
          },

          'crud-table': () => {
            emit({ type: 'block_start', id: 'crud-table', name: 'CRUD Tables', icon: '📋' })
            // Smart: copy the DataTable component then generate one page per entity
            copyBlockFile('crud', 'components/DataTable.jsx', 'components/DataTable.jsx')
            for (const entity of config.entities) {
              const cols = entity.fields.filter(f => f !== 'id').map(f =>
                `  { key: '${f}', label: '${f.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}' },`
              ).join('\n')
              writeFile(`app/dashboard/${entity.plural}/page.js`, `'use client'\nimport { useState, useEffect } from 'react'\nimport DataTable from '@/components/DataTable'\n\nconst COLUMNS = [\n${cols}\n]\n\nexport default function ${entity.label}Page() {\n  const [rows, setRows] = useState([])\n  const [loading, setLoading] = useState(true)\n\n  async function load() {\n    const res = await fetch('/api/${entity.plural}')\n    const data = await res.json()\n    if (Array.isArray(data)) setRows(data)\n    setLoading(false)\n  }\n\n  useEffect(() => { load() }, [])\n\n  async function handleDelete(row) {\n    if (!confirm('Delete this ${entity.name}?')) return\n    await fetch(\`/api/${entity.plural}?id=\${row.id}\`, { method: 'DELETE' })\n    load()\n  }\n\n  return (\n    <div>\n      <h1 className="text-2xl font-bold text-gray-900 mb-6">${entity.label}</h1>\n      <DataTable\n        title="${entity.label}"\n        columns={COLUMNS}\n        rows={rows}\n        loading={loading}\n        onAdd={() => alert('Add modal coming soon')}\n        onDelete={handleDelete}\n      />\n    </div>\n  )\n}\n`)
            }
            emit({ type: 'block_done', id: 'crud-table' })
          },

          'crud-api': () => {
            emit({ type: 'block_start', id: 'crud-api', name: 'CRUD APIs', icon: '🔌' })
            // Smart: generate one API route per entity
            for (const entity of config.entities) {
              const allowedCols = JSON.stringify(entity.fields.filter(f => f !== 'id'))
              const requiredCols = JSON.stringify(entity.required || [entity.fields[1] || 'name'])
              writeFile(`app/api/${entity.plural}/route.js`, `import { createAdminClient } from '@/lib/supabase-server'\nimport { NextResponse } from 'next/server'\n\nconst TABLE = '${entity.plural}'\nconst COLS = ${allowedCols}\nconst REQUIRED = ${requiredCols}\n\nexport async function GET(req) {\n  const supabase = createAdminClient()\n  const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(200)\n  if (error) return NextResponse.json({ error: error.message }, { status: 500 })\n  return NextResponse.json(data)\n}\n\nexport async function POST(req) {\n  const body = await req.json()\n  for (const f of REQUIRED) { if (!body[f]) return NextResponse.json({ error: \`\${f} is required\` }, { status: 400 }) }\n  const row = Object.fromEntries(COLS.filter(k => body[k] !== undefined).map(k => [k, body[k]]))\n  const { data, error } = await createAdminClient().from(TABLE).insert(row).select().single()\n  if (error) return NextResponse.json({ error: error.message }, { status: 500 })\n  return NextResponse.json(data, { status: 201 })\n}\n\nexport async function PATCH(req) {\n  const { id, ...updates } = await req.json()\n  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })\n  const row = Object.fromEntries(COLS.filter(k => updates[k] !== undefined).map(k => [k, updates[k]]))\n  const { data, error } = await createAdminClient().from(TABLE).update(row).eq('id', id).select().single()\n  if (error) return NextResponse.json({ error: error.message }, { status: 500 })\n  return NextResponse.json(data)\n}\n\nexport async function DELETE(req) {\n  const id = new URL(req.url).searchParams.get('id')\n  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })\n  const { error } = await createAdminClient().from(TABLE).delete().eq('id', id)\n  if (error) return NextResponse.json({ error: error.message }, { status: 500 })\n  return NextResponse.json({ ok: true })\n}\n`)
            }
            emit({ type: 'block_done', id: 'crud-api' })
          },

          'ai-chat': () => {
            emit({ type: 'block_start', id: 'ai-chat', name: 'AI Chat', icon: '🤖' })
            // Smart: inject generated system prompt + placeholder
            const comp = fs.readFileSync(path.join(BLOCKS_SRC, 'ai-chat', 'components', 'AiChat.jsx'), 'utf8')
            writeFile('components/AiChat.jsx', comp)
            writeFile('app/api/ai/route.js', `import Anthropic from '@anthropic-ai/sdk'\nconst client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })\nexport async function POST(req) {\n  const { messages, systemPrompt = '${config.aiSystemPrompt}' } = await req.json()\n  const stream = await client.messages.stream({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: systemPrompt, messages })\n  const enc = new TextEncoder()\n  return new Response(new ReadableStream({ async start(c) { for await (const ch of stream) { if (ch.type==='content_block_delta'&&ch.delta.type==='text_delta') c.enqueue(enc.encode(ch.delta.text)) } c.close() } }), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })\n}\n`)
            writeFile('app/dashboard/assistant/page.js', `import AiChat from '@/components/AiChat'\nexport default function AssistantPage() {\n  return <div><h1 className="text-2xl font-bold text-gray-900 mb-6">AI Assistant</h1><div className="max-w-3xl"><AiChat systemPrompt="${config.aiSystemPrompt}" placeholder="${config.aiChatPlaceholder}" /></div></div>\n}\n`)
            emit({ type: 'block_done', id: 'ai-chat' })
          },

          'landing': () => {
            emit({ type: 'block_start', id: 'landing', name: 'Landing Page', icon: '🏠' })
            writeFile('app/page.js', `import Link from 'next/link'\nexport default function LandingPage() {\n  return (\n    <div className="min-h-screen bg-white">\n      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-100">\n        <span className="text-xl font-bold text-brand-600">${config.appName}</span>\n        <div className="flex items-center gap-4">\n          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Sign in</Link>\n          <Link href="/signup" className="btn-primary text-sm">Get started →</Link>\n        </div>\n      </nav>\n      <section className="text-center py-24 px-6 bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 text-white">\n        <p className="text-brand-300 text-sm font-semibold uppercase tracking-widest mb-4">${config.tagline}</p>\n        <h1 className="text-5xl font-extrabold mb-6 leading-tight">${config.headline}</h1>\n        <p className="text-xl text-brand-200 max-w-2xl mx-auto mb-10">${config.subheadline}</p>\n        <Link href="/signup" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-brand-700 font-semibold text-lg hover:bg-brand-50 transition shadow-lg">${config.ctaText} →</Link>\n      </section>\n    </div>\n  )\n}\n`)
            emit({ type: 'block_done', id: 'landing' })
          },

          'stripe': () => {
            emit({ type: 'block_start', id: 'stripe', name: 'Stripe', icon: '💳' })
            copyBlockFile('stripe', 'lib/stripe.js', 'lib/stripe.js')
            writeFile('app/api/stripe/route.js', `import { createPaymentIntent, constructWebhookEvent } from '@/lib/stripe'\nimport { NextResponse } from 'next/server'\n\nexport async function POST(req) {\n  const { amount, currency = 'usd', metadata = {} } = await req.json()\n  if (!amount) return NextResponse.json({ error: 'amount required' }, { status: 400 })\n  const pi = await createPaymentIntent(Math.round(amount * 100), currency, metadata)\n  return NextResponse.json({ clientSecret: pi.client_secret })\n}\n`)
            emit({ type: 'block_done', id: 'stripe' })
          },

          'email-resend': () => {
            emit({ type: 'block_start', id: 'email-resend', name: 'Email', icon: '✉️' })
            writeFile('lib/resend.js', `import { Resend } from 'resend'\nconst resend = new Resend(process.env.RESEND_API_KEY)\nexport async function sendEmail({ to, subject, html, from }) {\n  return resend.emails.send({ from: from || process.env.RESEND_FROM || 'noreply@yourdomain.com', to, subject, html })\n}\n`)
            writeFile('app/api/email/route.js', `import { sendEmail } from '@/lib/resend'\nimport { NextResponse } from 'next/server'\nexport async function POST(req) {\n  const { to, subject, html } = await req.json()\n  const result = await sendEmail({ to, subject, html })\n  return NextResponse.json(result)\n}\n`)
            emit({ type: 'block_done', id: 'email-resend' })
          },

          'file-upload': () => {
            emit({ type: 'block_start', id: 'file-upload', name: 'File Upload', icon: '📎' })
            writeFile('app/api/upload/route.js', `import { createAdminClient } from '@/lib/supabase-server'\nimport { NextResponse } from 'next/server'\nexport async function POST(req) {\n  const form = await req.formData()\n  const file = form.get('file')\n  if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 })\n  const bytes = await file.arrayBuffer()\n  const buffer = Buffer.from(bytes)\n  const ext = file.name.split('.').pop()\n  const fileName = \`\${Date.now()}-\${Math.random().toString(36).slice(2)}.\${ext}\`\n  const supabase = createAdminClient()\n  const { error } = await supabase.storage.from('uploads').upload(fileName, buffer, { contentType: file.type })\n  if (error) return NextResponse.json({ error: error.message }, { status: 500 })\n  const { data } = supabase.storage.from('uploads').getPublicUrl(fileName)\n  return NextResponse.json({ url: data.publicUrl })\n}\n`)
            emit({ type: 'block_done', id: 'file-upload' })
          },

          'cron': () => {
            emit({ type: 'block_start', id: 'cron', name: 'Cron Jobs', icon: '⏰' })
            copyBlockFile('cron', 'app/api/cron/route.js', 'app/api/cron/route.js')
            copyBlockFile('cron', 'scripts/railway-cron.js', 'scripts/railway-cron.js')
            emit({ type: 'block_done', id: 'cron' })
          },

          'auth-google': () => {
            emit({ type: 'block_start', id: 'auth-google', name: 'Google OAuth', icon: '🔑' })
            copyBlockFile('auth-google', 'components/GoogleAuthButton.jsx', 'components/GoogleAuthButton.jsx')
            copyBlockFile('auth-google', 'app/api/auth/callback/route.js', 'app/api/auth/callback/route.js')
            // Patch login page to include Google button if auth-email also selected
            const loginPath = path.join(appDir, 'app/login/page.js')
            if (fs.existsSync(loginPath)) {
              let login = fs.readFileSync(loginPath, 'utf8')
              if (!login.includes('GoogleAuthButton')) {
                login = login.replace(
                  `import { createClient } from '@/lib/supabase-browser'`,
                  `import { createClient } from '@/lib/supabase-browser'\nimport GoogleAuthButton from '@/components/GoogleAuthButton'`
                ).replace(
                  `</p>\n      </div>\n    </div>\n  )\n}`,
                  `</p>\n          <div className="relative my-4"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"/></div><div className="relative flex justify-center text-xs"><span className="px-2 bg-white text-gray-400">or</span></div></div>\n          <GoogleAuthButton />\n      </div>\n    </div>\n  )\n}`
                )
                fs.writeFileSync(loginPath, login, 'utf8')
                emit({ type: 'file_write', path: 'app/login/page.js', preview: '(patched: added Google OAuth button)' })
              }
            }
            emit({ type: 'block_done', id: 'auth-google' })
          },

          'charts': () => {
            emit({ type: 'block_start', id: 'charts', name: 'Charts & Stats', icon: '📊' })
            copyBlockFile('charts', 'components/StatsCard.jsx', 'components/StatsCard.jsx')
            copyBlockFile('charts', 'components/LineChart.jsx', 'components/LineChart.jsx')
            copyBlockFile('charts', 'components/BarChart.jsx', 'components/BarChart.jsx')
            // Smart: patch package.json to add chart.js
            const pkgPath = path.join(appDir, 'package.json')
            if (fs.existsSync(pkgPath)) {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
              pkg.dependencies['chart.js'] = '^4.4.0'
              fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8')
              emit({ type: 'file_write', path: 'package.json', preview: '(patched: added chart.js)' })
            }
            // Smart: patch dashboard overview page to show stats cards per entity
            const overviewPath = path.join(appDir, 'app/dashboard/page.js')
            if (fs.existsSync(overviewPath)) {
              const statsImport = `import StatsCard from '@/components/StatsCard'\n`
              const statsCards = config.entities.map((e, i) => {
                const colors = ['#6366f1','#0ea5e9','#22c55e','#f59e0b','#ef4444']
                return `        <StatsCard label="${e.label}" value="—" trend="0" trendLabel="vs last month" icon="${['📋','👥','💰','📦','🎯'][i % 5]}" color="${colors[i % colors.length]}" />`
              }).join('\n')
              let overview = fs.readFileSync(overviewPath, 'utf8')
              if (!overview.includes('StatsCard')) {
                overview = statsImport + overview.replace(
                  `<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">`,
                  `<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">\n${statsCards}`
                )
                fs.writeFileSync(overviewPath, overview, 'utf8')
                emit({ type: 'file_write', path: 'app/dashboard/page.js', preview: '(patched: added StatsCards)' })
              }
            }
            emit({ type: 'block_done', id: 'charts' })
          },

          'notifications': () => {
            emit({ type: 'block_start', id: 'notifications', name: 'Notifications', icon: '🔔' })
            copyBlockFile('notifications', 'components/Toast.jsx', 'components/Toast.jsx')
            copyBlockFile('notifications', 'components/NotificationBell.jsx', 'components/NotificationBell.jsx')
            // Patch root layout to wrap with ToastProvider
            const layoutPath = path.join(appDir, 'app/layout.js')
            if (fs.existsSync(layoutPath)) {
              let layout = fs.readFileSync(layoutPath, 'utf8')
              if (!layout.includes('ToastProvider')) {
                layout = `import ToastProvider from '@/components/Toast'\n` + layout
                  .replace('<body', `<body`)
                  .replace('>{children}</body>', `><ToastProvider>{children}</ToastProvider></body>`)
                fs.writeFileSync(layoutPath, layout, 'utf8')
                emit({ type: 'file_write', path: 'app/layout.js', preview: '(patched: wrapped with ToastProvider)' })
              }
            }
            emit({ type: 'block_done', id: 'notifications' })
          },

          'kanban': () => {
            emit({ type: 'block_start', id: 'kanban', name: 'Kanban Board', icon: '🗂️' })
            copyBlockFile('kanban', 'components/KanbanBoard.jsx', 'components/KanbanBoard.jsx')
            // Smart: generate a kanban page for the first entity that has statusValues
            const entityWithStatus = config.entities.find(e => e.statusValues?.length > 1)
            if (entityWithStatus) {
              const colors = ['#6366f1','#f59e0b','#22c55e','#ef4444','#8b5cf6']
              const cols = entityWithStatus.statusValues.map((s, i) => `  { id: '${s}', label: '${s.charAt(0).toUpperCase() + s.slice(1)}', color: '${colors[i % colors.length]}' }`).join(',\n')
              writeFile(`app/dashboard/${entityWithStatus.plural}/kanban/page.js`, `'use client'\nimport { useState, useEffect } from 'react'\nimport KanbanBoard from '@/components/KanbanBoard'\n\nconst COLUMNS = [\n${cols}\n]\n\nexport default function ${entityWithStatus.label}KanbanPage() {\n  const [cards, setCards] = useState([])\n\n  useEffect(() => {\n    fetch('/api/${entityWithStatus.plural}').then(r=>r.json()).then(data => {\n      if (Array.isArray(data)) setCards(data.map(d => ({ id: d.id, columnId: d.status || COLUMNS[0].id, title: d.${entityWithStatus.fields[1] || 'name'} || d.id, description: '' })))\n    })\n  }, [])\n\n  async function handleMove(cardId, newColumnId) {\n    setCards(prev => prev.map(c => c.id === cardId ? { ...c, columnId: newColumnId } : c))\n    await fetch('/api/${entityWithStatus.plural}', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cardId, status: newColumnId }) })\n  }\n\n  return (\n    <div>\n      <h1 className="text-2xl font-bold text-gray-900 mb-6">${entityWithStatus.label} — Kanban</h1>\n      <KanbanBoard columns={COLUMNS} cards={cards} onMove={handleMove} />\n    </div>\n  )\n}\n`)
            }
            emit({ type: 'block_done', id: 'kanban' })
          },

          'settings-page': () => {
            emit({ type: 'block_start', id: 'settings-page', name: 'Settings', icon: '⚙️' })
            copyBlockFile('settings-page', 'app/dashboard/settings/page.js', 'app/dashboard/settings/page.js')
            emit({ type: 'block_done', id: 'settings-page' })
          },

        } // end ASSEMBLERS

        // ── Step 2: Run selected block assemblers in order ─────────────────
        const ordered = ['next-shell', 'supabase', 'auth-email', 'auth-google', 'dashboard-layout', 'crud-table', 'crud-api', 'charts', 'notifications', 'kanban', 'settings-page', 'ai-chat', 'landing', 'stripe', 'email-resend', 'file-upload', 'cron']
        for (const blockId of ordered) {
          if (blocks.includes(blockId) && ASSEMBLERS[blockId]) {
            await ASSEMBLERS[blockId]()
            await new Promise(r => setTimeout(r, 80)) // tiny pause so client sees each block
          }
        }

        // ── Step 3: Write .env.local template ─────────────────────────────
        writeFile('.env.local', `# Generated by Forge — fill in your values\nNEXT_PUBLIC_SUPABASE_URL=https://xocfduqugghailalzlqy.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\nANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ''}\nGEMINI_API_KEY=${process.env.GEMINI_API_KEY || ''}\nRESEND_API_KEY=\nRESEND_FROM=noreply@yourdomain.com\nSTRIPE_SECRET_KEY=\nSTRIPE_PUBLISHABLE_KEY=\nSTRIPE_WEBHOOK_SECRET=\nADMIN_PASSWORD=Partycard123*\n`)

        // ── Step 4: Write Supabase schema SQL ─────────────────────────────
        if (config.entities.length > 0) {
          const sql = config.entities.map(e => {
            const cols = e.fields.filter(f => f !== 'id').map(f => {
              if (f === 'created_at' || f === 'updated_at') return `  ${f} timestamptz default now()`
              if (f.endsWith('_at')) return `  ${f} timestamptz`
              if (f === 'amount' || f === 'price') return `  ${f} numeric(10,2)`
              if (f === 'status') return `  status text default '${e.statusValues?.[0] || 'active'}'`
              return `  ${f} text`
            }).join(',\n')
            return `create table if not exists ${e.plural} (\n  id uuid primary key default gen_random_uuid(),\n${cols},\n  created_at timestamptz default now()\n);\nalter table ${e.plural} enable row level security;`
          }).join('\n\n')
          writeFile('supabase-schema.sql', `-- Generated by Forge\n-- Run this in your Supabase SQL editor\n\n${sql}\n`)
        }

        // ── Step 5: npm install ────────────────────────────────────────────
        emit({ type: 'install_start', message: 'Installing dependencies…' })
        await new Promise(resolve => {
          const child = spawn('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
            cwd: appDir,
            env: { ...process.env, HOME, FORCE_COLOR: '0' },
          })
          child.stdout.on('data', d => emit({ type: 'install_line', text: d.toString().trim() }))
          child.stderr.on('data', d => {
            const t = d.toString().trim()
            if (t && !t.startsWith('npm warn')) emit({ type: 'install_line', text: t })
          })
          child.on('close', resolve)
        })
        emit({ type: 'install_done' })

        // ── Done ───────────────────────────────────────────────────────────
        const relPath = path.relative(WORK_DIR, appDir)

        // Compute required env keys from selected blocks
        const FORGE_BLOCK_ENV = {
          'supabase': ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
          'auth-email': ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
          'auth-google': ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
          'roles-permissions': ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
          'email-resend': ['RESEND_API_KEY'],
          'email-marketing': ['RESEND_API_KEY'],
          'sms-telnyx': ['TELNYX_API_KEY', 'TELNYX_PHONE_NUMBER'],
          'whatsapp': ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
          'slack': ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
          'ai-messaging': ['ANTHROPIC_API_KEY'],
          'ai-chat': ['ANTHROPIC_API_KEY'],
          'stripe-payments': ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
          'subscriptions': ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
          'marketplace': ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
          'map-view': ['NEXT_PUBLIC_MAPBOX_TOKEN'],
          'analytics': ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'],
          'file-upload': ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
        }
        const envKeys = [...new Set(blocks.flatMap(b => FORGE_BLOCK_ENV[b] || []))]

        emit({ type: 'complete', appPath: appDir, relPath, appName: config.appName, slug: config.slug, envKeys })

        // ── Save to forge_tenants ──────────────────────────────────────────
        const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
        const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (SUPA_URL && SUPA_KEY) {
          const payload = JSON.stringify([{ app_name: config.appName, slug: config.slug, status: 'assembled', config: JSON.stringify({ blocks, envKeys }) }])
          const su = new URL(`${SUPA_URL}/rest/v1/forge_tenants`)
          const sopts = { hostname: su.hostname, path: su.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'return=minimal', 'Content-Length': Buffer.byteLength(payload) } }
          const sr = require('https').request(sopts, () => {})
          sr.on('error', () => {})
          sr.write(payload)
          sr.end()
        }

      } catch (err) {
        emit({ type: 'error', message: err.message })
      }

      if (!res.writableEnded) res.end()
    })
    return
  }

  // GET /forge/download/:slug — stream app as tar.gz
  if (req.method === 'GET' && url.pathname.startsWith('/forge/download/')) {
    const parts = url.pathname.split('/')
    // parts: ['', 'forge', 'download', workspaceOrSlug, slug?]
    const slugOrPath = decodeURIComponent(parts.slice(3).join('/'))
    if (!slugOrPath || slugOrPath.includes('..')) {
      res.writeHead(400); res.end('bad path'); return
    }
    // Try direct path first, then search under WORK_DIR
    let appDir = path.join(WORK_DIR, slugOrPath)
    if (!fs.existsSync(appDir)) {
      // Search for slug in immediate subdirectories
      const slug = parts[parts.length - 1]
      const found = fs.readdirSync(WORK_DIR).map(d => path.join(WORK_DIR, d, slug)).find(p => fs.existsSync(p))
      if (found) appDir = found
      else { res.writeHead(404); res.end('not found'); return }
    }
    const dirName = path.basename(appDir)
    const parentDir = path.dirname(appDir)
    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${dirName}.tar.gz"`,
    })
    const tar = spawn('tar', ['-czf', '-', '-C', parentDir, dirName])
    tar.stdout.pipe(res)
    tar.stderr.on('data', d => console.error('[forge-download] tar err:', d.toString()))
    tar.on('error', err => { console.error('[forge-download] spawn err:', err); if (!res.writableEnded) res.end() })
    return
  }

  // POST /forge/preview — start next dev for a scaffolded app, return port
  // Body: { workspaceId, appSlug }
  if (req.method === 'POST' && url.pathname === '/forge/preview') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { workspaceId, appSlug } = JSON.parse(body)
        const appDir = path.join(WORK_DIR, workspaceId, appSlug)
        if (!fs.existsSync(appDir)) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `App not found at ${appDir}` }))
          return
        }

        // Kill existing preview for this workspace
        if (forgePreviews.has(workspaceId)) {
          const old = forgePreviews.get(workspaceId)
          old.process?.kill()
          forgePreviews.delete(workspaceId)
        }

        const port = getFreePreviewPort()
        const child = spawn('npx', ['next', 'dev', '--port', String(port)], {
          cwd: appDir,
          env: { ...process.env, HOME, PORT: String(port), NODE_ENV: 'development' },
          detached: false,
        })

        forgePreviews.set(workspaceId, { process: child, port, appDir, startedAt: Date.now() })
        console.log(`[forge-preview] started ${appSlug} on :${port} (ws: ${workspaceId})`)

        // Wait up to 20s for "Ready" signal
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 20000)
          child.stdout.on('data', d => {
            if (d.toString().includes('Ready') || d.toString().includes('ready')) {
              clearTimeout(timer); resolve()
            }
          })
          child.stderr.on('data', d => {
            if (d.toString().includes('Ready') || d.toString().includes('ready')) {
              clearTimeout(timer); resolve()
            }
          })
          child.on('close', () => { clearTimeout(timer); resolve() })
        })

        const proxyUrl = `/forge/proxy/${workspaceId}`
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, port, proxyUrl }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // GET/POST /forge/proxy/:workspaceId/* — HTTP proxy to running preview
  if (url.pathname.startsWith('/forge/proxy/')) {
    const parts = url.pathname.split('/')
    const wsId = parts[3]
    const rest = '/' + parts.slice(4).join('/') + (url.search || '')
    const preview = forgePreviews.get(wsId)
    if (!preview) {
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end('<html><body style="font-family:sans-serif;padding:40px;background:#050d1a;color:#64748b"><h2>Preview not running</h2><p>Start the preview first from the Forge page.</p></body></html>')
      return
    }
    const proxyReq = http.request({
      hostname: 'localhost',
      port: preview.port,
      path: rest || '/',
      method: req.method,
      headers: { ...req.headers, host: `localhost:${preview.port}` },
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxyReq.on('error', () => {
      if (!res.writableEnded) { res.writeHead(502); res.end('Preview server error') }
    })
    req.pipe(proxyReq)
    return
  }

  // DELETE /forge/preview/:workspaceId — stop preview
  if (req.method === 'DELETE' && url.pathname.startsWith('/forge/preview/')) {
    const wsId = url.pathname.split('/')[3]
    if (forgePreviews.has(wsId)) {
      forgePreviews.get(wsId).process?.kill()
      forgePreviews.delete(wsId)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // ── POST /forge/deploy — assemble + push to GitHub + create Railway service ──
  // Body: { workspaceId, tenantId, appName, appPath, config }
  // Returns: { ok, repoUrl, railwayUrl, tenantId }
  if (req.method === 'POST' && url.pathname === '/forge/deploy') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      try {
        const { workspaceId, tenantId, appName, appPath, config } = JSON.parse(body)
        const tid = tenantId || `tenant-${Date.now()}`
        const slug = (appName || 'app').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30)
        const repoName = `forge-${slug}-${tid.slice(-6)}`
        const dir = appPath || `/root/workspace/${workspaceId || slug}`

        if (!fs.existsSync(dir)) {
          return res.end(JSON.stringify({ error: `App directory not found: ${dir}` }))
        }

        // ── 1. Write tenant middleware into the app ──
        const tenantMiddleware = `// Auto-injected by Forge — tenant isolation + usage metering
export const TENANT_ID = '${tid}'
export const FORGE_API = '${process.env.FORGE_API_URL || 'https://svets-dream-production.up.railway.app'}'
`
        fs.writeFileSync(path.join(dir, 'lib/tenant.js'), tenantMiddleware)

        // ── 2. Write .env.local with OUR shared credentials + tenant vars ──
        const envContent = [
          `# Forge-managed credentials — do not edit`,
          `NEXT_PUBLIC_SUPABASE_URL=${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}`,
          `NEXT_PUBLIC_SUPABASE_ANON_KEY=${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
          `SUPABASE_SERVICE_ROLE_KEY=${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
          `RESEND_API_KEY=${process.env.RESEND_API_KEY || ''}`,
          `RESEND_FROM=noreply@${slug}.svets-dream.app`,
          `TELNYX_API_KEY=${process.env.TELNYX_API_KEY || ''}`,
          `TELNYX_FROM_NUMBER=${process.env.TELNYX_FROM_NUMBER || ''}`,
          `STRIPE_SECRET_KEY=${process.env.STRIPE_SECRET_KEY || ''}`,
          `STRIPE_PUBLISHABLE_KEY=${process.env.STRIPE_PUBLISHABLE_KEY || ''}`,
          `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ''}`,
          `NEXT_PUBLIC_APP_URL=https://${slug}.svets-dream.app`,
          `FORGE_TENANT_ID=${tid}`,
          `FORGE_API_URL=${process.env.FORGE_API_URL || 'https://svets-dream-production.up.railway.app'}`,
          `CRON_SECRET=${Math.random().toString(36).slice(2)}`,
        ].join('\n')
        fs.writeFileSync(path.join(dir, '.env.local'), envContent)

        // ── 3. Git init + push to GitHub ──
        const GH_TOKEN = process.env.GITHUB_TOKEN
        const GH_ORG = process.env.GITHUB_ORG || 'svettypoo'
        let repoUrl = null

        if (GH_TOKEN) {
          // Create private repo via GitHub API
          const createRepo = await new Promise((resolve) => {
            const payload = JSON.stringify({ name: repoName, private: true, description: `Forge app: ${appName} (tenant ${tid})`, auto_init: false })
            const options = {
              hostname: 'api.github.com',
              path: `/user/repos`,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `token ${GH_TOKEN}`, 'User-Agent': 'Forge/1.0', 'Content-Length': Buffer.byteLength(payload) },
            }
            const r = require('https').request(options, resp => {
              let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve(JSON.parse(d)))
            })
            r.on('error', e => resolve({ error: e.message }))
            r.write(payload); r.end()
          })

          if (createRepo.html_url) {
            repoUrl = createRepo.html_url
            const remoteUrl = `https://${GH_TOKEN}@github.com/${GH_ORG}/${repoName}.git`
            try {
              execSync(`cd "${dir}" && git init && git add -A && git commit -m "Initial Forge scaffold: ${appName}" && git branch -M main && git remote add origin ${remoteUrl} && git push -u origin main`, { stdio: 'pipe' })
            } catch (e) {
              console.error('Git push failed:', e.message)
            }
          }
        } else {
          // No GitHub token — just git init locally
          try { execSync(`cd "${dir}" && git init && git add -A && git commit -m "Initial Forge scaffold: ${appName}"`, { stdio: 'pipe' }) } catch {}
        }

        // ── 4. Register tenant in Supabase ──
        const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
        const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
        let tenantRecord = null
        if (SUPA_URL && SUPA_KEY) {
          const r = await new Promise(resolve => {
            const payload = JSON.stringify([{ id: tid, app_name: appName, slug, repo_url: repoUrl, status: 'active', config: JSON.stringify(config || {}), workspace_id: workspaceId }])
            const u = new URL(`${SUPA_URL}/rest/v1/forge_tenants`)
            const opts = { hostname: u.hostname, path: u.pathname + '?on_conflict=id', method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'return=representation', 'Content-Length': Buffer.byteLength(payload) } }
            const req2 = require('https').request(opts, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } }) })
            req2.on('error', () => resolve(null))
            req2.write(payload); req2.end()
          })
          tenantRecord = r?.[0] || null
        }

        const deployedUrl = `https://${slug}.svets-dream.app`
        res.end(JSON.stringify({
          ok: true,
          tenantId: tid,
          slug,
          repoUrl,
          deployedUrl,
          note: 'App assembled and tenant registered. Point your Railway service to the repo to go live.',
          tenantRecord,
        }))
      } catch (err) {
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // GET /forge/tenants — list tenant apps
  if (req.method === 'GET' && url.pathname === '/forge/tenants') {
    const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPA_URL || !SUPA_KEY) { res.writeHead(200); res.end(JSON.stringify({ tenants: [] })); return }
    const u = new URL(`${SUPA_URL}/rest/v1/forge_tenants?select=*&order=created_at.desc`)
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` } }
    const req2 = require('https').request(opts, resp => {
      let d = ''
      resp.on('data', c => d += c)
      resp.on('end', () => {
        let tenants = []
        try { tenants = JSON.parse(d) } catch {}
        if (!Array.isArray(tenants)) tenants = []
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ tenants }))
      })
    })
    req2.on('error', () => { res.writeHead(200); res.end(JSON.stringify({ tenants: [] })) })
    req2.end()
    return
  }

  // POST /forge/usage — record a metered usage event (email, sms, storage)
  if (req.method === 'POST' && url.pathname === '/forge/usage') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      try {
        const { tenantId, type, quantity = 1, meta } = JSON.parse(body)
        const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
        const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (SUPA_URL && SUPA_KEY) {
          const payload = JSON.stringify([{ tenant_id: tenantId, type, quantity, meta: JSON.stringify(meta || {}), recorded_at: new Date().toISOString() }])
          const u = new URL(`${SUPA_URL}/rest/v1/forge_usage`)
          const opts = { hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'return=minimal', 'Content-Length': Buffer.byteLength(payload) } }
          await new Promise(resolve => { const r = require('https').request(opts, () => resolve()); r.on('error', resolve); r.write(payload); r.end() })
        }
        res.end(JSON.stringify({ ok: true }))
      } catch (err) { res.end(JSON.stringify({ error: err.message })) }
    })
    return
  }

  // POST /gemini — call Gemini API (text + vision)
  // Body: { prompt, imageBase64?, mimeType?, model?, maxTokens? }
  // Used for: UI analysis from screenshots, code generation, design suggestions
  if (req.method === 'POST' && url.pathname === '/gemini') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const {
          prompt,
          imageBase64,
          mimeType = 'image/png',
          model = 'gemini-2.0-flash',
          maxTokens = 8192,
          temperature = 0.4,
        } = JSON.parse(body)

        if (!prompt && !imageBase64) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'prompt or imageBase64 required' }))
          return
        }

        const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDTdTISEF9sx4p2eJWmMdQSY0fsIcfZ7SM'
        const parts = []
        if (imageBase64) parts.push({ inlineData: { mimeType, data: imageBase64 } })
        if (prompt) parts.push({ text: prompt })

        const payload = JSON.stringify({
          contents: [{ parts }],
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        })

        const apiPath = `/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`
        const geminiRes = await new Promise((resolve, reject) => {
          const https = require('https')
          const reqOut = https.request({
            hostname: 'generativelanguage.googleapis.com',
            path: apiPath,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          }, r => {
            let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({ error: d }) } })
          })
          reqOut.on('error', reject)
          reqOut.write(payload)
          reqOut.end()
        })

        const text = geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text || ''
        const finishReason = geminiRes?.candidates?.[0]?.finishReason || ''
        console.log(`[gemini] model=${model} tokens=${geminiRes?.usageMetadata?.totalTokenCount} finish=${finishReason}`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, text, finishReason, model }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // POST /gemini-ui — send a screenshot to Gemini, get UI improvement suggestions or redesigned HTML
  // Body: { screenshotBase64, task: 'analyze'|'redesign'|'code', context? }
  if (req.method === 'POST' && url.pathname === '/gemini-ui') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { screenshotBase64, task = 'analyze', context = '' } = JSON.parse(body)
        if (!screenshotBase64) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'screenshotBase64 required' }))
          return
        }

        const prompts = {
          analyze: `Analyze this UI screenshot. Provide specific, actionable feedback on: (1) layout and visual hierarchy, (2) color and typography, (3) usability and UX patterns, (4) what to improve. Be concrete. ${context}`,
          redesign: `You are a senior UI/UX designer. Look at this screenshot and write complete, production-ready HTML+CSS (Tailwind) that redesigns this interface to be significantly more modern, polished, and user-friendly. Output only the HTML file. ${context}`,
          code: `Convert this UI screenshot into a complete React component using Tailwind CSS classes. Match the layout as closely as possible. Output only the React component code. ${context}`,
        }

        const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDTdTISEF9sx4p2eJWmMdQSY0fsIcfZ7SM'
        const payload = JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType: 'image/png', data: screenshotBase64 } },
            { text: prompts[task] || prompts.analyze },
          ]}],
          generationConfig: { maxOutputTokens: 16384, temperature: 0.3 },
        })

        const geminiRes = await new Promise((resolve, reject) => {
          const https = require('https')
          const reqOut = https.request({
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          }, r => {
            let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({ error: d }) } })
          })
          reqOut.on('error', reject)
          reqOut.write(payload)
          reqOut.end()
        })

        const text = geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text || ''
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, text, task }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // POST /remember — save a fact to long-term memory (agent_memories Supabase table)
  // Body: { content: string, type?: string, importance?: number }
  // Called by the agent via curl localhost during a session
  if (req.method === 'POST' && url.pathname === '/remember') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { content, type = 'fact', importance = 3 } = JSON.parse(body)
        if (!content) throw new Error('content required')

        const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xocfduqugghailalzlqy.supabase.co'
        let serviceKey = ''
        try { serviceKey = fs.readFileSync('/root/workspace/.supabase-jwt', 'utf8').trim() } catch {}
        if (!serviceKey) serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

        await new Promise((resolve, reject) => {
          const https = require('https')
          const payload = JSON.stringify({ user_id: 'svet', content, type, importance })
          const opts = new URL(`${SUPABASE_URL}/rest/v1/agent_memories`)
          const reqOut = https.request({
            hostname: opts.hostname,
            path: opts.pathname,
            method: 'POST',
            headers: {
              'apikey': serviceKey,
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
              'Content-Length': Buffer.byteLength(payload),
            },
          }, r => { r.resume(); r.on('end', resolve) })
          reqOut.on('error', reject)
          reqOut.write(payload)
          reqOut.end()
        })

        console.log(`[remember] saved: [${type}] ${content.slice(0, 80)}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // POST /agent-stream — run Claude Code SDK agent, stream text back
  // Bypasses Vercel entirely: always-warm Railway server, no cold start
  // Body: { messages: [{role, content}][], workspaceId?: string }
  // Returns: text/plain streaming chunks (same protocol as Vercel /api/agent-chat)
  if (req.method === 'POST' && url.pathname === '/agent-stream') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      let messages, workspaceId
      try {
        const parsed = JSON.parse(body)
        messages = parsed.messages || []
        workspaceId = parsed.workspaceId || 'default'
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

      const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xocfduqugghailalzlqy.supabase.co'
      // Read JWT service role key from file (written once at setup)
      let serviceKey = ''
      try { serviceKey = fs.readFileSync('/root/workspace/.supabase-jwt', 'utf8').trim() } catch {}
      if (!serviceKey) serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

      // Load memories + projects from Supabase for system prompt context
      async function supabaseGet(table, params) {
        return new Promise(resolve => {
          const https = require('https')
          const qs = new URLSearchParams(params).toString()
          const reqUrl = `${SUPABASE_URL}/rest/v1/${table}?${qs}`
          const options = new URL(reqUrl)
          https.get({ hostname: options.hostname, path: options.pathname + options.search, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }, r => {
            let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve([]) } })
          }).on('error', () => resolve([]))
        })
      }

      const [memories, projects] = await Promise.all([
        supabaseGet('agent_memories', { user_id: 'eq.svet', order: 'importance.desc,created_at.desc', limit: 15, select: 'content,type' }),
        supabaseGet('projects', { order: 'created_at.desc', limit: 8, select: 'name,description,live_url,tech_stack,notes' }),
      ])

      const memText = Array.isArray(memories) && memories.length
        ? memories.map(m => `[${m.type}] ${m.content}`).join('\n')
        : ''
      const projText = Array.isArray(projects) && projects.length
        ? projects.map(p => `• ${p.name}${p.live_url ? ` (${p.live_url})` : ''}${p.tech_stack ? ` — ${p.tech_stack}` : ''}${p.notes ? `\n  ${p.notes}` : ''}`).join('\n')
        : ''

      const systemPrompt = [
        'You are an autonomous AI assistant for Svet. Be direct, decisive, and efficient.',
        memText ? `## Long-term Memory\n${memText}` : '',
        projText ? `## Projects\n${projText}` : '',
        `## Workspace
Your working directory is /root/workspace/${workspaceId}. You have full access to bash, file read/write, and web search.`,
        `## Streaming Thoughts — MANDATORY
Think out loud in short bursts. Output a short line BEFORE each action. After each result, write 1-2 sentences before moving on. Never go silent for more than 3 seconds.`,
        `## Task Tracking
For simple questions (under ~15 words asking for info), answer immediately — no task tracking needed.
For real work (build, deploy, research, write, fix), briefly acknowledge the task and start working.`,
        `## Long-term Memory Tool (remember)
Save important facts using Bash:
  curl -s -X POST http://localhost:${PORT}/remember -H "Authorization: Bearer ${EXEC_TOKEN}" -H "Content-Type: application/json" -d '{"content":"...","type":"fact","importance":2}'
Types: preference|fact|project|pattern|credential — Importance: 1=critical 2=high 3=normal 4=low
Use proactively: after completing work, learning preferences, finishing a build.`,

        `## Block Library — Reusable App Blocks
Pre-built Next.js App Router blocks are at /root/workspace/__BLOCKS__/. When scaffolding a new app:
1. Read /root/workspace/__BLOCKS__/manifest.json to see what's available
2. Copy the relevant block files with: cp -r /root/workspace/__BLOCKS__/<block>/* /root/workspace/<project>/
3. Replace {{APP_NAME}} and {{PLACEHOLDER}} tokens with actual values
4. Run npm install in the project directory

Available blocks: next-shell (foundation), supabase (DB client), auth-email (login/signup), dashboard-layout (sidebar nav), crud-table (DataTable component), crud-api (REST API route), ai-chat (streaming AI chat), landing (Hero+Features page), stripe (payments), file-upload (Supabase Storage), email-resend (Resend transactional email), env-template (.env.local)

ALWAYS start with next-shell + supabase when building a new Next.js app. Use blocks first, then customize.`,

        `## Gemini UI Tool
Analyze or redesign UI from screenshots using Gemini Vision:
  curl -s -X POST http://localhost:${PORT}/gemini-ui -H "Authorization: Bearer ${EXEC_TOKEN}" -H "Content-Type: application/json" -d '{"screenshotBase64":"<base64>","task":"analyze"}'
Tasks: analyze (UX feedback), redesign (returns full HTML/Tailwind redesign), code (returns React component)

General Gemini queries (text or vision):
  curl -s -X POST http://localhost:${PORT}/gemini -H "Authorization: Bearer ${EXEC_TOKEN}" -H "Content-Type: application/json" -d '{"prompt":"...","imageBase64":"<optional>","model":"gemini-2.0-flash"}'

To take a screenshot for Gemini UI analysis, use Playwright via Bash, save as PNG, read as base64.`,
      ].filter(Boolean).join('\n\n')

      // Build conversation history as context prefix in the prompt
      const history = messages.slice(0, -1)
      const lastMsg = messages[messages.length - 1]
      const prompt = history.length > 1
        ? `Previous conversation:\n${history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content : m.content?.[0]?.text || ''}`).join('\n\n')}\n\nCurrent request: ${typeof lastMsg?.content === 'string' ? lastMsg.content : lastMsg?.content?.[0]?.text || ''}`
        : typeof lastMsg?.content === 'string' ? lastMsg.content : lastMsg?.content?.[0]?.text || 'Hello'

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      })

      // Abort when client disconnects
      const controller = new AbortController()
      req.on('close', () => controller.abort())

      const cwd = path.join(WORK_DIR, workspaceId)
      fs.mkdirSync(cwd, { recursive: true })

      const CLI_PATH = path.join(__dirname, 'node_modules/@anthropic-ai/claude-code/cli.js')
      try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk')
        let lastText = ''
        let streamedAny = false

        // Resume prior session if we have one — enables prompt caching + true memory
        const savedSession = agentSessions.get(workspaceId)
        if (savedSession) {
          console.log(`[agent-stream] resuming session ${savedSession} for ${workspaceId}`)
        } else {
          console.log(`[agent-stream] new session for ${workspaceId}`)
        }

        const queryOptions = {
          pathToClaudeCodeExecutable: CLI_PATH,
          cwd,
          systemPrompt,
          allowedTools: ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
          permissionMode: 'dontAsk',
          maxTurns: 25,
          abortController: controller,
          includePartialMessages: true,
        }
        if (savedSession) queryOptions.resume = savedSession

        for await (const event of query({ prompt, options: queryOptions })) {
          if (event.type === 'stream_event') {
            const ev = event.event
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              const text = ev.delta.text
              if (text && !res.writableEnded) { res.write(text); streamedAny = true }
            }
          } else if (event.type === 'assistant' && !streamedAny) {
            // Fallback: send full text only if no stream_events arrived
            const content = event.message?.content
            if (Array.isArray(content)) {
              const newText = content.filter(b => b.type === 'text').map(b => b.text).join('')
              if (newText.length > lastText.length && !res.writableEnded) {
                res.write(newText.slice(lastText.length))
                lastText = newText
              }
            }
          } else if (event.type === 'result') {
            // Capture and persist session_id for next call
            const sid = event.session_id
            if (sid) {
              agentSessions.set(workspaceId, sid)
              persistSessions()
              console.log(`[agent-stream] saved session ${sid} for ${workspaceId}`)
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError' && !res.writableEnded) {
          res.write(`\n\nError: ${err.message}`)
        }
      }

      if (!res.writableEnded) res.end()
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

// Auto-install Playwright chromium on startup (survives Railway restarts)
try {
  execSync('npx playwright install --with-deps chromium', { stdio: 'inherit', timeout: 300000 })
  console.log('[exec-server] Playwright chromium ready')
} catch (e) {
  console.error('[exec-server] Playwright install failed:', e.message)
}

server.listen(PORT, () => {
  console.log(`[exec-server] listening on :${PORT}`)
})
