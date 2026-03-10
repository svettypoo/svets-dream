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
