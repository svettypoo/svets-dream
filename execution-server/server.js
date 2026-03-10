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
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ── Browser session manager ───────────────────────────────────────────────────
// Keeps one Playwright browser context per sessionId so the page persists
// across multiple tool calls within the same conversation.
const browserSessions = new Map() // sessionId → { browser, context, page }

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

// Ensure workspace exists
fs.mkdirSync(WORK_DIR, { recursive: true })

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

  // GET /ls?path=...
  if (req.method === 'GET' && url.pathname === '/ls') {
    try {
      const dirPath = resolvePath(url.searchParams.get('path'))
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      const files = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
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

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`[exec-server] listening on :${PORT}`)
})
