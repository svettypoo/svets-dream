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
const browserSessions = new Map() // sessionId → { browser, context, page, lastUsed }
const MAX_BROWSER_SESSIONS = parseInt(process.env.MAX_BROWSER_SESSIONS || '20', 10)
const SESSION_IDLE_TIMEOUT_MS = parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || String(10 * 60 * 1000), 10)

// Reap idle browser sessions every 60 seconds
setInterval(async () => {
  const now = Date.now()
  for (const [id, session] of browserSessions) {
    if (now - session.lastUsed > SESSION_IDLE_TIMEOUT_MS) {
      console.log(`[browser] Reaping idle session: ${id} (idle ${Math.round((now - session.lastUsed) / 1000)}s)`)
      await session.browser.close().catch(() => {})
      browserSessions.delete(id)
    }
  }
}, 60000)

// ── Screenshot store (public, in-memory, max 200 frames) ─────────────────────
const screenshotStore = new Map() // id → Buffer

// ── Audio store (public, in-memory, max 50 recordings) ───────────────────────
const audioStore = new Map() // id → Buffer (ogg/mp3)

// ── Audio capture processes ───────────────────────────────────────────────────
const audioCaptures = new Map() // captureId → { proc, outputFile }

// ── Mobile emulator sessions (Appetize.io) ──────────────────────────────────
// Uses Playwright to load Appetize embed iframe, then calls SDK methods via page.evaluate()
const mobileSessions = new Map() // sessionId → { browser, context, page, lastUsed, platform, publicKey }
const APPETIZE_API_KEY = process.env.APPETIZE_API_KEY || 'tok_xpy2mehdhrnm43i647udjrvk64'
const DEFAULT_ANDROID_KEY = process.env.APPETIZE_ANDROID_KEY || 'xuzpcbnvltosxe3go3pihml7lm'

// Reap idle mobile sessions every 60s
setInterval(async () => {
  const now = Date.now()
  for (const [id, s] of mobileSessions) {
    if (now - s.lastUsed > SESSION_IDLE_TIMEOUT_MS) {
      console.log(`[mobile] Reaping idle session: ${id}`)
      await s.browser.close().catch(() => {})
      mobileSessions.delete(id)
    }
  }
}, 60000)

async function getMobileSession(sessionId, opts = {}) {
  if (mobileSessions.has(sessionId)) {
    const s = mobileSessions.get(sessionId)
    s.lastUsed = Date.now()
    return s
  }

  const { chromium } = require('playwright')
  const publicKey = opts.publicKey || DEFAULT_ANDROID_KEY
  const platform = opts.platform || 'android'
  const device = opts.device || (platform === 'android' ? 'pixel7' : 'iphone14pro')
  const osVersion = opts.osVersion || (platform === 'android' ? '13.0' : '16')

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  })
  const context = await browser.newContext({ viewport: { width: 500, height: 900 } })
  const page = await context.newPage()

  // Navigate directly to the Appetize embed page, then inject SDK initialization
  // The SDK is exposed on the parent window by the iframe automatically when loaded over HTTP
  const embedUrl = `https://appetize.io/embed/${publicKey}?device=${device}&osVersion=${osVersion}&scale=auto&autoplay=true&grantPermissions=true&screenOnly=false&record=true&toast=top`

  console.log(`[mobile] Navigating to Appetize embed (${publicKey}, ${device}, ${platform})...`)
  await page.goto(embedUrl, { waitUntil: 'load', timeout: 60000 })

  // The embed page IS the Appetize page — we interact with it differently.
  // Instead of using the JS SDK (which requires iframe + parent page),
  // we use the embed page directly and interact via Playwright clicks/screenshots.
  // This is simpler and more reliable.

  // Wait for the device to boot (look for the device screen to appear)
  console.log(`[mobile] Waiting for device to boot...`)
  await page.waitForTimeout(5000)

  // Check if there's a "Tap to Play" button and click it
  try {
    const tapToPlay = await page.getByText('Tap to Play').first()
    if (await tapToPlay.isVisible({ timeout: 3000 })) {
      await tapToPlay.click()
      console.log(`[mobile] Clicked "Tap to Play"`)
      await page.waitForTimeout(10000) // wait for device to boot
    }
  } catch { /* no tap to play, device auto-started */ }

  // Wait for device screen to be ready (up to 60s)
  await page.waitForTimeout(15000)
  console.log(`[mobile] Device session ready: ${sessionId}`)

  const sess = { browser, context, page, lastUsed: Date.now(), platform, publicKey, device: device }
  mobileSessions.set(sessionId, sess)
  return sess
}

async function handleMobile(action, sessionId, params) {
  try {
    if (action === 'close') {
      if (mobileSessions.has(sessionId)) {
        const s = mobileSessions.get(sessionId)
        await s.browser.close().catch(() => {})
        mobileSessions.delete(sessionId)
      }
      return { ok: true, message: 'Mobile session closed.' }
    }

    if (action === 'launch') {
      const sess = await getMobileSession(sessionId, params)
      // Take initial screenshot
      const screenshot = await sess.page.screenshot({ type: 'png' })
      autoUploadScreenshot(screenshot, sessionId)
      return { ok: true, platform: params.platform || 'android', device: sess.device, screenshot: screenshot.toString('base64') }
    }

    // All other actions require an active session
    if (!mobileSessions.has(sessionId)) {
      return { ok: false, error: 'No active mobile session. Call launch first.' }
    }
    const sess = mobileSessions.get(sessionId)
    const { page } = sess
    sess.lastUsed = Date.now()

    if (action === 'screenshot') {
      const screenshot = await page.screenshot({ type: 'png' })
      autoUploadScreenshot(screenshot, sessionId)
      return { ok: true, screenshot: screenshot.toString('base64') }
    }

    if (action === 'tap') {
      // Tap by text label on the device screen
      if (params.element?.text || (typeof params.element === 'string')) {
        const text = params.element?.text || params.element
        try {
          await page.getByText(text).first().click({ timeout: 10000 })
        } catch {
          // Try clicking by role
          await page.getByRole('button', { name: text }).first().click({ timeout: 5000 }).catch(() => {})
        }
      } else if (params.coordinates) {
        await page.mouse.click(params.coordinates.x, params.coordinates.y)
      } else if (params.position) {
        // Percentage-based — convert to viewport pixels
        const vp = page.viewportSize()
        const x = typeof params.position.x === 'string' ? (parseFloat(params.position.x) / 100) * vp.width : params.position.x
        const y = typeof params.position.y === 'string' ? (parseFloat(params.position.y) / 100) * vp.height : params.position.y
        await page.mouse.click(x, y)
      }
      await page.waitForTimeout(1500)
      const screenshot = await page.screenshot({ type: 'png' })
      autoUploadScreenshot(screenshot, sessionId)
      return { ok: true, screenshot: screenshot.toString('base64') }
    }

    if (action === 'type') {
      await page.keyboard.type(params.text || params.value || '', { delay: 50 })
      await page.waitForTimeout(500)
      const screenshot = await page.screenshot({ type: 'png' })
      return { ok: true, screenshot: screenshot.toString('base64') }
    }

    if (action === 'swipe') {
      const vp = page.viewportSize()
      const cx = vp.width / 2, cy = vp.height / 2
      const dist = 200
      const gestures = {
        up:    { startX: cx, startY: cy + dist/2, endX: cx, endY: cy - dist/2 },
        down:  { startX: cx, startY: cy - dist/2, endX: cx, endY: cy + dist/2 },
        left:  { startX: cx + dist/2, startY: cy, endX: cx - dist/2, endY: cy },
        right: { startX: cx - dist/2, startY: cy, endX: cx + dist/2, endY: cy },
      }
      const g = gestures[params.gesture || 'up'] || gestures.up
      await page.mouse.move(g.startX, g.startY)
      await page.mouse.down()
      await page.mouse.move(g.endX, g.endY, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(1500)
      const screenshot = await page.screenshot({ type: 'png' })
      return { ok: true, screenshot: screenshot.toString('base64') }
    }

    if (action === 'keypress') {
      // Map common mobile keys to keyboard events
      const keyMap = { HOME: 'Home', BACK: 'Escape', ENTER: 'Enter', TAB: 'Tab' }
      const key = keyMap[params.key] || params.key || 'Enter'
      await page.keyboard.press(key)
      await page.waitForTimeout(1000)
      const screenshot = await page.screenshot({ type: 'png' })
      return { ok: true, screenshot: screenshot.toString('base64') }
    }

    if (action === 'getUI') {
      // Read visible text from the page as a proxy for UI state
      const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
      return { ok: true, text: text.slice(0, 8000) }
    }

    if (action === 'findElement') {
      const text = params.attributes?.text || params.text || ''
      const found = await page.getByText(text).first().isVisible({ timeout: 5000 }).catch(() => false)
      return { ok: true, found, text }
    }

    if (action === 'openUrl') {
      // Navigate to a URL within the Appetize embed (e.g., deep links)
      const url = params.url
      await page.evaluate((u) => { window.postMessage({ type: 'openUrl', url: u }, '*') }, url)
      await page.waitForTimeout(3000)
      const screenshot = await page.screenshot({ type: 'png' })
      return { ok: true, screenshot: screenshot.toString('base64') }
    }

    if (action === 'rotate') {
      // Not directly available without SDK — return screenshot
      const screenshot = await page.screenshot({ type: 'png' })
      return { ok: true, message: 'Rotate requires Appetize SDK (not available in embed mode)', screenshot: screenshot.toString('base64') }
    }

    if (action === 'adb') {
      return { ok: false, error: 'ADB commands require Appetize SDK (not available in direct embed mode)' }
    }

    if (action === 'info') {
      return {
        ok: true,
        sessionId,
        platform: sess.platform,
        device: sess.device,
        publicKey: sess.publicKey,
        activeSessions: mobileSessions.size,
      }
    }

    return { ok: false, error: `Unknown mobile action: ${action}` }

  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// ── Device profiles for browser emulation ────────────────────────────────────
const DEVICES = {
  desktop: {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    label: 'Desktop',
  },
  ios: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    label: 'iPhone (iOS)',
  },
  android: {
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    label: 'Android Phone',
  },
  tablet_ios: {
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    label: 'iPad',
  },
  tablet_android: {
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 800, height: 1280 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    label: 'Android Tablet',
  },
}

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

async function getSession(sessionId, opts = {}) {
  if (browserSessions.has(sessionId)) {
    const s = browserSessions.get(sessionId)
    s.lastUsed = Date.now()
    return s
  }

  // Enforce max sessions — close oldest if at capacity
  if (browserSessions.size >= MAX_BROWSER_SESSIONS) {
    let oldestId = null, oldestTime = Infinity
    for (const [id, s] of browserSessions) {
      if (s.lastUsed < oldestTime) { oldestTime = s.lastUsed; oldestId = id }
    }
    if (oldestId) {
      console.log(`[browser] Max sessions (${MAX_BROWSER_SESSIONS}) reached — closing oldest: ${oldestId}`)
      await closeSession(oldestId)
    }
  }

  const { chromium } = require('playwright')

  const device = DEVICES[opts.device] || DEVICES.desktop

  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required', // allow audio autoplay
    '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies',
    '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--disable-sync', '--disable-translate', '--metrics-recording-only',
    '--no-first-run',
    `--js-flags=--max-old-space-size=${process.env.CHROME_HEAP_MB || '256'}`,
  ]

  // Only mute audio when NOT using fake audio (mute-audio interferes with WebRTC)
  if (!opts.fakeAudio) {
    args.push('--mute-audio')
  }

  // Fake media input — feeds WAV + Y4M files as mic/camera source for WebRTC
  if (opts.fakeAudio) {
    // Per-session audio file: pass fakeAudioFile="/app/fake-female.wav" etc.
    let audioFile = opts.fakeAudioFile || ''
    if (!audioFile || !fs.existsSync(audioFile)) {
      audioFile = fs.existsSync('/app/fake-conversation.wav')
        ? '/app/fake-conversation.wav'
        : '/app/test-audio.wav'
    }
    args.push(
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${audioFile}`,
      '--allow-file-access-from-files',
    )
    // Per-session video file: pass fakeVideoFile="/app/custom-video.y4m" etc.
    const videoFile = opts.fakeVideoFile && fs.existsSync(opts.fakeVideoFile)
      ? opts.fakeVideoFile
      : (fs.existsSync('/app/fake-video.y4m') ? '/app/fake-video.y4m' : '')
    if (videoFile) {
      args.push(`--use-file-for-fake-video-capture=${videoFile}`)
    }
  }

  // For fakeAudio sessions: use non-headless mode with Xvfb for proper WebRTC media negotiation
  // Normal sessions stay headless for performance
  const useXvfb = opts.fakeAudio && process.env.DISPLAY
  if (useXvfb) {
    args.push(`--display=${process.env.DISPLAY}`)
  }
  const browser = await chromium.launch({ headless: !useXvfb, args })
  const permissions = opts.fakeAudio ? ['microphone', 'camera'] : []
  // Video recording dir
  const recordVideoOpts = opts.recordVideo ? {
    recordVideo: { dir: '/tmp/recordings/', size: { width: 1280, height: 720 } }
  } : {}

  const context = await browser.newContext({
    viewport: device.viewport,
    userAgent: device.userAgent,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    permissions,
    ...recordVideoOpts,
  })
  const page = await context.newPage()
  // Grant mic/camera permissions to all origins if fakeAudio
  if (opts.fakeAudio) {
    await context.grantPermissions(['microphone', 'camera']).catch(() => {})
  }
  const session = { browser, context, page, opts, device, lastUsed: Date.now() }
  browserSessions.set(sessionId, session)
  console.log(`[browser] New session: ${sessionId} (total: ${browserSessions.size})`)
  return session
}

async function closeSession(sessionId) {
  if (!browserSessions.has(sessionId)) return
  const { browser } = browserSessions.get(sessionId)
  await browser.close().catch(() => {})
  browserSessions.delete(sessionId)
}

// ── Upload to svet-media service ──────────────────────────────────────────
async function uploadToMediaService(mediaUrl, mediaToken, buffer, filename, mime, source, sessionId) {
  return new Promise((resolve, reject) => {
    const boundary = '----SvetMedia' + Date.now()
    const parts = []
    // file part
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`)
    parts.push(buffer)
    parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\n${source}`)
    parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="session_id"\r\n\r\n${sessionId || 'unknown'}`)
    parts.push(`\r\n--${boundary}--\r\n`)

    const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p))
    const url = new URL(mediaUrl + '/upload')
    const mod = url.protocol === 'https:' ? require('https') : http

    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mediaToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve({ ok: false, raw: data }) }
      })
    })
    req.on('error', e => resolve({ ok: false, error: e.message }))
    req.write(body)
    req.end()
  })
}

// Auto-upload screenshot to media service (fire-and-forget)
function autoUploadScreenshot(screenshotBuf, sessionId) {
  const mediaUrl = process.env.MEDIA_SERVICE_URL || 'https://media.stproperties.com'
  const mediaToken = process.env.MEDIA_TOKEN || 'svets-media-token-2026'
  if (!mediaUrl) return
  uploadToMediaService(mediaUrl, mediaToken, screenshotBuf, `screenshot-${Date.now()}.png`, 'image/png', 'dream', sessionId)
    .then(r => { if (r.ok) console.log(`[media] Auto-uploaded screenshot: ${r.url}`) })
    .catch(() => {})
}

async function handleBrowser(action, sessionId, params) {
  try {
    if (action === 'close') {
      await closeSession(sessionId)
      return { ok: true, message: 'Browser session closed.' }
    }

    // Allow passing device/fakeAudio options on first use — these only apply to new sessions
    const sessionOpts = {}
    if (params.device) sessionOpts.device = params.device
    if (params.fakeAudio) sessionOpts.fakeAudio = params.fakeAudio
    if (params.fakeAudioFile) sessionOpts.fakeAudioFile = params.fakeAudioFile
    if (params.fakeVideoFile) sessionOpts.fakeVideoFile = params.fakeVideoFile

    const session = await getSession(sessionId, sessionOpts)
    const { page } = session

    if (action === 'navigate') {
      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 300000 })
      const title = await page.title()
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      autoUploadScreenshot(screenshot, sessionId)
      return { ok: true, title, url: page.url(), screenshot: screenshot.toString('base64') }
    }

    if (action === 'screenshot') {
      const screenshot = await page.screenshot({ type: 'png', fullPage: params.fullPage || false })
      const title = await page.title()
      autoUploadScreenshot(screenshot, sessionId)
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

    if (action === 'screenshotElements') {
      // Screenshot each element matching a CSS selector — used for product snipping
      const selector = params.selector || 'article'
      const max = params.max || 24
      await page.waitForTimeout(1500) // let lazy-load settle
      const elements = await page.locator(selector).all()
      const results = []
      for (let i = 0; i < Math.min(elements.length, max); i++) {
        try {
          const el = elements[i]
          const box = await el.boundingBox()
          if (!box || box.width < 60 || box.height < 60) continue
          const buf = await el.screenshot({ type: 'png' }).catch(() => null)
          const text = await el.innerText({ timeout: 2000 }).catch(() => '')
          if (buf) results.push({ index: i, base64: buf.toString('base64'), text: text.slice(0, 400) })
        } catch { /* skip */ }
      }
      return { ok: true, snips: results, total: elements.length }
    }

    if (action === 'mouse_click') {
      await page.mouse.click(params.x, params.y)
      await page.waitForTimeout(params.wait || 1000)
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, url: page.url(), screenshot: screenshot.toString('base64') }
    }

    // ── Audio status — inspect all audio/video elements on the page ──────────
    if (action === 'audio_status') {
      const status = await page.evaluate(() => {
        const els = [...document.querySelectorAll('audio, video')]
        return {
          count: els.length,
          elements: els.map(el => ({
            tag: el.tagName.toLowerCase(),
            src: el.currentSrc || el.src || null,
            paused: el.paused,
            muted: el.muted,
            volume: el.volume,
            currentTime: el.currentTime,
            duration: el.duration || null,
            readyState: el.readyState,
            autoplay: el.autoplay,
            loop: el.loop,
            networkState: el.networkState,
          })),
          audioContextState: (() => {
            try { return new AudioContext().state } catch { return 'unavailable' }
          })(),
        }
      }).catch(e => ({ error: e.message }))
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, ...status, screenshot: screenshot.toString('base64') }
    }

    // ── Start audio capture — records browser audio output via PulseAudio ────
    if (action === 'start_capture') {
      const captureId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
      const outputFile = `/tmp/audio-${captureId}.ogg`
      const proc = spawn('ffmpeg', [
        '-y', '-f', 'pulse', '-i', 'virtual_sink.monitor',
        '-c:a', 'libvorbis', '-q:a', '4', outputFile
      ])
      proc.stderr.on('data', () => {}) // suppress ffmpeg logs
      audioCaptures.set(captureId, { proc, outputFile })
      return { ok: true, captureId, message: 'Recording started. Call stop_capture to finish.' }
    }

    // ── Stop audio capture — returns a public URL to the recording ───────────
    if (action === 'stop_capture') {
      const cap = audioCaptures.get(params.captureId)
      if (!cap) return { ok: false, error: 'No capture with that id' }
      cap.proc.kill('SIGTERM')
      await new Promise(r => setTimeout(r, 1000))
      try {
        const buf = fs.readFileSync(cap.outputFile)
        audioStore.set(params.captureId, buf)
        if (audioStore.size > 50) audioStore.delete(audioStore.keys().next().value)
        audioCaptures.delete(params.captureId)
        // Auto-upload audio to media service
        const mediaUrl = process.env.MEDIA_SERVICE_URL || 'https://media.stproperties.com'
        const mediaToken = process.env.MEDIA_TOKEN || 'svets-media-token-2026'
        const mediaResult = await uploadToMediaService(mediaUrl, mediaToken, buf, `audio-${params.captureId}.ogg`, 'audio/ogg', 'dream-capture', sessionId).catch(() => null)
        return { ok: true, captureId: params.captureId, sizeBytes: buf.length, media: mediaResult }
      } catch(e) {
        return { ok: false, error: 'Could not read capture: ' + e.message }
      }
    }

    // ── Device info — return current session device profile ──────────────────
    if (action === 'device_info') {
      const d = session.device || DEVICES.desktop
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, device: d.label, viewport: d.viewport, isMobile: d.isMobile, hasTouch: d.hasTouch, fakeAudio: !!(session.opts && session.opts.fakeAudio), screenshot: screenshot.toString('base64') }
    }

    // ── Start video recording — reopens session with Playwright recordVideo ───
    if (action === 'start_recording') {
      // Close current session and reopen with video recording enabled
      await closeSession(sessionId)
      const newOpts = { ...(session.opts || {}), recordVideo: true }
      if (params.device) newOpts.device = params.device
      const newSession = await getSession(sessionId, newOpts)
      // Navigate to current URL if provided
      if (params.url) {
        await newSession.page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 300000 }).catch(() => {})
      }
      const screenshot = await newSession.page.screenshot({ type: 'png', fullPage: false })
      return { ok: true, message: 'Video recording started. Navigate and interact, then call stop_recording.', sessionId, recording: true, screenshot: screenshot.toString('base64') }
    }

    // ── Stop video recording — saves video and uploads to media service ────────
    if (action === 'stop_recording') {
      const video = page.video()
      if (!video) return { ok: false, error: 'No active video recording on this session' }
      try {
        // Get the recording path BEFORE closing — Playwright writes video to this temp dir
        const videoPath = await video.path()
        // Close the browser context — this finalizes the video file on disk
        await closeSession(sessionId)
        // Wait briefly for file to be fully written
        await new Promise(r => setTimeout(r, 1000))
        // Read the finalized video from Playwright's temp path
        const videoBuffer = fs.readFileSync(videoPath)
        // Upload to media service
        const mediaUrl = process.env.MEDIA_SERVICE_URL || 'https://media.stproperties.com'
        const mediaToken = process.env.MEDIA_TOKEN || 'svets-media-token-2026'
        const uploadResult = await uploadToMediaService(mediaUrl, mediaToken, videoBuffer, `recording-${sessionId}.webm`, 'video/webm', 'dream-recording', sessionId)
        try { fs.unlinkSync(videoPath) } catch {}
        return { ok: true, ...uploadResult }
      } catch (e) {
        return { ok: false, error: 'Failed to save recording: ' + e.message }
      }
    }

    // ── Check audio — verify WebRTC audio streams are flowing ────────────────
    if (action === 'check_audio') {
      const audioInfo = await page.evaluate(() => {
        const result = {
          peerConnections: 0,
          audioTracks: { local: 0, remote: 0 },
          videoTracks: { local: 0, remote: 0 },
          connectionStates: [],
          iceStates: [],
          mediaStreams: 0,
          getUserMediaActive: false,
          details: [],
        }

        // Check all RTCPeerConnections via WebRTC internals
        // Note: We can only detect streams attached to media elements or getUserMedia
        const mediaElements = document.querySelectorAll('audio, video')
        for (const el of mediaElements) {
          if (el.srcObject && el.srcObject instanceof MediaStream) {
            result.mediaStreams++
            const audioTracks = el.srcObject.getAudioTracks()
            const videoTracks = el.srcObject.getVideoTracks()
            result.details.push({
              element: el.tagName.toLowerCase(),
              id: el.id || '(no id)',
              audioTracks: audioTracks.map(t => ({ label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState })),
              videoTracks: videoTracks.map(t => ({ label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState })),
            })
          }
        }

        // Check if getUserMedia was used (navigator.mediaDevices)
        if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
          result.getUserMediaActive = true
        }

        // Try to get RTCPeerConnection stats if any global references exist
        if (typeof window.__rtcPeerConnections !== 'undefined' && Array.isArray(window.__rtcPeerConnections)) {
          for (const pc of window.__rtcPeerConnections) {
            result.peerConnections++
            result.connectionStates.push(pc.connectionState || 'unknown')
            result.iceStates.push(pc.iceConnectionState || 'unknown')
            for (const sender of (pc.getSenders ? pc.getSenders() : [])) {
              if (sender.track) {
                if (sender.track.kind === 'audio') result.audioTracks.local++
                if (sender.track.kind === 'video') result.videoTracks.local++
              }
            }
            for (const receiver of (pc.getReceivers ? pc.getReceivers() : [])) {
              if (receiver.track) {
                if (receiver.track.kind === 'audio') result.audioTracks.remote++
                if (receiver.track.kind === 'video') result.videoTracks.remote++
              }
            }
          }
        }

        return result
      })

      return {
        ok: true,
        fakeAudio: !!(session.opts && session.opts.fakeAudio),
        xvfb: !!process.env.DISPLAY,
        audioFile: fs.existsSync('/app/fake-conversation.wav') ? '/app/fake-conversation.wav' : '/app/test-audio.wav',
        videoFile: fs.existsSync('/app/fake-video.y4m') ? '/app/fake-video.y4m' : null,
        ...audioInfo,
      }
    }

    // ── Recording status ──────────────────────────────────────────────────────
    if (action === 'recording_status') {
      const video = page.video()
      const isRecording = !!(video && session.opts && session.opts.recordVideo)
      return { ok: true, recording: isRecording, sessionId }
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
    const sessions = []
    for (const [id, s] of browserSessions) {
      sessions.push({ id, idleSec: Math.round((Date.now() - s.lastUsed) / 1000), device: s.device?.viewport })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true, uptime: process.uptime(), workDir: WORK_DIR,
      browser: { active: browserSessions.size, max: MAX_BROWSER_SESSIONS, idleTimeoutMin: SESSION_IDLE_TIMEOUT_MS / 60000, sessions },
      mobile: { active: mobileSessions.size, sessions: [...mobileSessions.keys()] }
    }))
    return
  }

  // Viewer page (no auth — public live browser view)
  if (req.method === 'GET' && url.pathname === '/viewer') {
    const sessionId = url.searchParams.get('session') || 'claude-monitor'
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Live Browser — Svet's Dream</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; }
  #toolbar { background: #1e293b; padding: 8px 14px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #334155; flex-shrink: 0; flex-wrap: wrap; }
  #toolbar h1 { font-size: 14px; font-weight: 600; color: #38bdf8; white-space: nowrap; }
  #url-bar { flex: 1; min-width: 160px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 5px 10px; color: #e2e8f0; font-size: 13px; }
  #status { font-size: 12px; color: #64748b; white-space: nowrap; }
  #status.live { color: #22c55e; }
  #status.error { color: #ef4444; }
  .btn { background: #2563eb; border: none; color: white; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap; }
  .btn:hover { opacity: 0.85; }
  .btn.red { background: #dc2626; }
  .btn.green { background: #16a34a; }
  .btn.gray { background: #475569; }
  #device-sel { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 5px 8px; color: #e2e8f0; font-size: 12px; cursor: pointer; }
  #device-badge { font-size: 11px; background: #1e3a5f; color: #7dd3fc; padding: 3px 8px; border-radius: 10px; white-space: nowrap; }
  #fps { font-size: 11px; color: #475569; white-space: nowrap; }
  #audio-bar { background: #0f172a; border-top: 1px solid #1e293b; padding: 6px 14px; display: flex; align-items: center; gap: 10px; font-size: 12px; flex-shrink: 0; }
  #audio-status { flex: 1; color: #64748b; }
  #audio-status.playing { color: #4ade80; }
  #capture-id { display: none; }
  #viewer { flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #000; }
  #screen { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  #recordings { background: #0f172a; border-top: 1px solid #1e293b; padding: 6px 14px; font-size: 12px; max-height: 80px; overflow-y: auto; }
  #recordings a { color: #38bdf8; margin-right: 12px; }
</style>
</head>
<body>
<div id="toolbar">
  <h1>🖥 Live View</h1>
  <select id="device-sel" onchange="switchDevice(this.value)">
    <option value="desktop">🖥 Desktop</option>
    <option value="ios">📱 iPhone (iOS)</option>
    <option value="android">📱 Android</option>
    <option value="tablet_ios">📲 iPad</option>
    <option value="tablet_android">📲 Android Tablet</option>
  </select>
  <span id="device-badge">Desktop</span>
  <input id="url-bar" type="text" placeholder="Enter URL..." onkeydown="if(event.key==='Enter')navigate()">
  <button class="btn" onclick="navigate()">Go</button>
  <span id="fps"></span>
  <span id="status">connecting...</span>
</div>
<div id="viewer">
  <img id="screen" alt="Browser view">
</div>
<div id="audio-bar">
  <span>🔊 Audio:</span>
  <span id="audio-status">checking...</span>
  <button class="btn green" onclick="checkAudio()">Check</button>
  <button class="btn" id="rec-btn" onclick="toggleCapture()">⏺ Record</button>
  <input id="capture-id" type="hidden" value="">
</div>
<div id="recordings"></div>
<script>
  let SESSION = '${sessionId}';
  const TOKEN = '${EXEC_TOKEN}';
  const BASE = window.location.origin;
  let frameCount = 0, lastFpsTime = Date.now();
  let currentDevice = 'desktop';
  let recording = false;

  const screenEl = document.getElementById('screen');
  const statusEl = document.getElementById('status');
  const fpsEl = document.getElementById('fps');
  const urlBar = document.getElementById('url-bar');
  const deviceBadge = document.getElementById('device-badge');
  const audioStatus = document.getElementById('audio-status');
  const recBtn = document.getElementById('rec-btn');
  const recordingsEl = document.getElementById('recordings');

  const DEVICE_LABELS = { desktop:'Desktop', ios:'iPhone (iOS)', android:'Android', tablet_ios:'iPad', tablet_android:'Android Tablet' };
  const DEVICE_ICONS = { desktop:'🖥', ios:'📱', android:'📱', tablet_ios:'📲', tablet_android:'📲' };

  async function browser(action, params) {
    const r = await fetch(BASE + '/browser', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sessionId: SESSION, ...params })
    });
    return r.json();
  }

  async function switchDevice(device) {
    currentDevice = device;
    deviceBadge.textContent = DEVICE_ICONS[device] + ' ' + DEVICE_LABELS[device];
    // Close existing session and open new one with device profile
    await browser('close', {});
    SESSION = device + '-' + Date.now();
    statusEl.textContent = 'new session: ' + DEVICE_LABELS[device]; statusEl.className = '';
    // Pre-init session with device + fakeAudio
    await browser('screenshot', { device, fakeAudio: true });
    statusEl.textContent = 'live'; statusEl.className = 'live';
    // Update URL in select UI
    const sel = document.getElementById('device-sel');
    if (sel) sel.value = device;
  }

  async function navigate() {
    const val = urlBar.value.trim();
    if (!val) return;
    const u = val.startsWith('http') ? val : 'https://' + val;
    statusEl.textContent = 'navigating...'; statusEl.className = '';
    await browser('navigate', { url: u });
    statusEl.textContent = 'live'; statusEl.className = 'live';
  }

  async function checkAudio() {
    const d = await browser('audio_status', {});
    if (d.error) { audioStatus.textContent = 'error: ' + d.error; audioStatus.className = ''; return; }
    if (d.count === 0) { audioStatus.textContent = 'no audio elements'; audioStatus.className = ''; return; }
    const playing = d.elements.filter(e => !e.paused);
    if (playing.length > 0) {
      audioStatus.textContent = playing.length + ' playing — ' + (playing[0].src || 'unknown src');
      audioStatus.className = 'playing';
    } else {
      audioStatus.textContent = d.count + ' audio element(s), all paused';
      audioStatus.className = '';
    }
  }

  async function toggleCapture() {
    if (!recording) {
      const d = await browser('start_capture', {});
      if (d.captureId) {
        document.getElementById('capture-id').value = d.captureId;
        recording = true;
        recBtn.textContent = '⏹ Stop';
        recBtn.className = 'btn red';
        audioStatus.textContent = '🔴 Recording...'; audioStatus.className = 'playing';
      } else {
        audioStatus.textContent = 'capture failed: ' + (d.error || 'unknown');
      }
    } else {
      const captureId = document.getElementById('capture-id').value;
      const d = await browser('stop_capture', { captureId });
      recording = false;
      recBtn.textContent = '⏺ Record'; recBtn.className = 'btn';
      if (d.ok) {
        const url = BASE + '/audio/' + captureId;
        const a = document.createElement('a');
        a.href = url; a.target = '_blank';
        a.textContent = '🎵 Recording ' + new Date().toLocaleTimeString() + ' (' + Math.round(d.sizeBytes/1024) + ' KB)';
        recordingsEl.prepend(a);
        audioStatus.textContent = 'Saved (' + Math.round(d.sizeBytes/1024) + ' KB)'; audioStatus.className = '';
      } else {
        audioStatus.textContent = 'stop failed: ' + (d.error || 'unknown'); audioStatus.className = '';
      }
    }
  }

  async function poll() {
    statusEl.textContent = 'live'; statusEl.className = 'live';
    while (true) {
      try {
        const data = await browser('screenshot', {});
        if (data.screenshot) {
          screenEl.src = 'data:image/png;base64,' + data.screenshot;
          if (data.url && data.url !== 'about:blank') urlBar.placeholder = data.url;
          frameCount++;
          const now = Date.now();
          if (now - lastFpsTime >= 1000) {
            fpsEl.textContent = frameCount + ' fps';
            frameCount = 0; lastFpsTime = now;
          }
        }
      } catch(e) {
        statusEl.textContent = 'reconnecting...'; statusEl.className = 'error';
        await new Promise(r => setTimeout(r, 2000));
        statusEl.textContent = 'live'; statusEl.className = 'live';
      }
      await new Promise(r => setTimeout(r, 150));
    }
  }

  // Init with fakeAudio so mic is available from the start
  browser('screenshot', { fakeAudio: true }).then(() => poll());
  // Auto-check audio every 5s
  setInterval(checkAudio, 5000);
</script>
</body>
</html>`
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
    return
  }

  // Screenshot store — public, no auth
  // POST /screenshots  body: { png: "<base64>" }  → returns { id, url }
  // GET  /screenshots/:id                         → returns image/png
  if (url.pathname === '/screenshots') {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', c => body += c)
      req.on('end', () => {
        try {
          const { png } = JSON.parse(body)
          if (!png) { res.writeHead(400); res.end(JSON.stringify({ error: 'png required' })); return }
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
          screenshotStore.set(id, Buffer.from(png, 'base64'))
          // Keep store from growing unbounded — drop oldest when over 200
          if (screenshotStore.size > 200) {
            screenshotStore.delete(screenshotStore.keys().next().value)
          }
          const publicUrl = `https://${req.headers.host}/screenshots/${id}`
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ id, url: publicUrl }))
        } catch(e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })) }
      })
      return
    }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/screenshots/')) {
    const id = url.pathname.slice('/screenshots/'.length)
    const buf = screenshotStore.get(id)
    if (!buf) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' })
    res.end(buf)
    return
  }

  // Audio store — public, no auth
  // GET /audio/:id → audio/ogg file
  if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
    const id = url.pathname.slice('/audio/'.length)
    const buf = audioStore.get(id)
    if (!buf) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'Content-Type': 'audio/ogg', 'Content-Disposition': `inline; filename="recording-${id}.ogg"`, 'Cache-Control': 'public, max-age=86400' })
    res.end(buf)
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

  // POST /mobile — mobile device emulator via Appetize.io
  if (req.method === 'POST' && url.pathname === '/mobile') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { action, sessionId = 'mobile-default', ...params } = JSON.parse(body)
        console.log(`[exec-server] [${sessionId}] mobile.${action}`)
        const result = await handleMobile(action, sessionId, params)
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
export const FORGE_API = '${process.env.FORGE_API_URL || 'https://exec.stproperties.com'}'
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
          `FORGE_API_URL=${process.env.FORGE_API_URL || 'https://exec.stproperties.com'}`,
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

        `## Forge — App Assembly (ALWAYS use this to start a new app)
Forge is a deterministic app scaffolder built into this server. It assembles a complete Next.js App Router codebase from pre-built blocks in seconds — with npm install included. NEVER manually copy block files or scaffold from scratch. Call Forge first, then customize.

### Step 1 — Assemble with Forge
\`\`\`bash
curl -s -X POST http://localhost:${PORT}/forge/assemble \\
  -H "Authorization: Bearer ${EXEC_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "appName": "MyApp",
    "description": "A job board where employers post listings and candidates apply",
    "blocks": ["next-shell", "supabase", "auth-email", "dashboard-layout", "crud-table", "crud-api", "email-resend"],
    "entities": [{"name": "Job", "fields": ["title", "description", "status", "user_id"]}],
    "primaryColor": "#6366f1",
    "workspaceId": "<workspaceId>"
  }' | grep '"type":"complete"'
\`\`\`
The command streams NDJSON lines. Pipe through \`grep '"type":"complete"'\` to get the final result line.
The response includes \`appPath\` (absolute path to scaffolded app), \`slug\`, and \`envKeys\` (required env vars).

### Available blocks
Foundation: next-shell (required), supabase, env-template, capacitor (mobile)
Auth: auth-email, auth-google, roles-permissions
Layout: dashboard-layout, landing, pricing-page, about-page, contact-form, dark-mode
Data: crud-table, crud-api, data-table-user, charts, export-csv, search-filters
Communication: email-resend, email-marketing, sms-telnyx, whatsapp, slack, chat-realtime, ai-messaging, reminders
Features: tasks, kanban, notifications, notifications-db, comments, reviews-ratings, image-gallery, map-view, file-upload, calendar, booking, voting, badges, activity-feed, blog, wiki, faq
Monetization: stripe-payments, subscriptions, marketplace, invoicing, affiliate
Infrastructure: multi-tenant, audit-log, rate-limiting, webhooks, analytics, api-keys, cron-jobs

### Step 2 — Customize
After assembly, the app is at \`appPath\`. Read the generated files, then make targeted edits to match the user's specific requirements. The scaffold already has working auth, DB clients, layouts, and API routes — only add what's missing.

### Step 3 — Deploy to Vercel
After customizing the scaffold, deploy it with Vercel CLI (already installed):
\`\`\`bash
cd <appPath> && vercel --prod --yes --token $VERCEL_TOKEN --scope svettypoos-projects --name <slug>
\`\`\`
- VERCEL_TOKEN is available as \`$VERCEL_TOKEN\` env var — do NOT hardcode it
- \`--scope svettypoos-projects\` is required — always include it
- Use the app slug as \`--name\` (lowercase, hyphens only)
- Vercel builds in the cloud — do NOT run \`npm run build\` on the server first (it will OOM-kill)
- The CLI will print a production URL — that's the live site

### Step 4 — Note env vars
The \`envKeys\` in the complete response lists all env vars the app needs. Tell the user which keys to fill in.`,

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

// ── PulseAudio virtual sink setup (for audio capture) ─────────────────────────
function ensurePulseAudio() {
  try {
    execSync('pactl info >/dev/null 2>&1', { stdio: 'pipe' })
    return true // already running
  } catch {
    try {
      // Fix client.conf if needed
      const paClientConf = require('path').join(process.env.HOME || '/root', '.config/pulse/client.conf')
      try { fs.writeFileSync(paClientConf, 'autospawn = yes\n') } catch {}
      execSync('pulseaudio --start --daemonize --log-level=error 2>/dev/null || true', { stdio: 'pipe' })
      execSync('pactl load-module module-null-sink sink_name=virtual_sink sink_properties=device.description=VirtualSink 2>/dev/null || true', { stdio: 'pipe' })
      execSync('pactl set-default-sink virtual_sink 2>/dev/null || true', { stdio: 'pipe' })
      console.log('[exec-server] PulseAudio restarted with virtual sink')
      return true
    } catch (e) {
      return false
    }
  }
}
try {
  if (ensurePulseAudio()) {
    console.log('[exec-server] PulseAudio virtual sink ready')
    // Watchdog: check every 30s and restart if dead
    setInterval(() => { ensurePulseAudio() }, 30000)
  }
} catch (e) {
  console.log('[exec-server] PulseAudio not available (install pulseaudio for audio capture):', e.message)
}

// ── Start Xvfb virtual display (needed for WebRTC in non-headless mode) ──────
try {
  const xvfbProc = spawn('Xvfb', [':99', '-screen', '0', '1280x1024x24', '-ac'], {
    stdio: 'ignore', detached: true
  })
  xvfbProc.unref()
  process.env.DISPLAY = ':99'
  console.log('[exec-server] Xvfb virtual display started on :99')
} catch (e) {
  console.log('[exec-server] Xvfb not available (WebRTC sessions will use headless mode):', e.message)
}

// ── Generate fake conversation audio (used as fake mic input for WebRTC) ─────
try {
  const CONVERSATION_WAV = '/app/fake-conversation.wav'
  if (!fs.existsSync(CONVERSATION_WAV)) {
    // Conversation lines — alternating female (f5) and male (m3) espeak-ng voices
    const lines = [
      { voice: 'en+f5', text: 'Good morning, this is Sarah from S and T Properties. How can I help you today?' },
      { voice: 'en+m3', text: 'Hi Sarah, I am calling about the maintenance request for room four twelve.' },
      { voice: 'en+f5', text: 'Of course, let me pull that up right away. Can I get your name please?' },
      { voice: 'en+m3', text: 'Its John Patterson. I submitted the request yesterday afternoon.' },
      { voice: 'en+f5', text: 'Yes, I can see that here. The plumbing issue in the bathroom, is that correct?' },
      { voice: 'en+m3', text: 'Yes thats right. The faucet has been leaking since Monday and its getting worse.' },
      { voice: 'en+f5', text: 'I understand. Let me schedule a technician for you. Would tomorrow morning work?' },
      { voice: 'en+m3', text: 'Tomorrow morning would be perfect. What time should I expect them?' },
      { voice: 'en+f5', text: 'I can have someone there between nine and eleven. Will you be in the room?' },
      { voice: 'en+m3', text: 'Yes I will be here. Could you also send a confirmation email to my address on file?' },
      { voice: 'en+f5', text: 'Absolutely, I will send that right over. Is there anything else I can help you with?' },
      { voice: 'en+m3', text: 'No thats everything. Thank you so much Sarah, I really appreciate the quick response.' },
      { voice: 'en+f5', text: 'You are welcome John. Have a wonderful day and we will see you tomorrow morning.' },
    ]

    let hasEspeak = false
    try { execSync('which espeak-ng', { stdio: 'pipe' }); hasEspeak = true } catch {}

    if (hasEspeak) {
      console.log('[exec-server] Generating conversation audio with espeak-ng...')
      const tmpDir = '/tmp/conversation-parts'
      execSync(`mkdir -p ${tmpDir}`, { stdio: 'pipe' })

      // Generate each line as a separate WAV
      const partFiles = []
      for (let i = 0; i < lines.length; i++) {
        const outFile = `${tmpDir}/part-${String(i).padStart(2, '0')}.wav`
        const silenceFile = `${tmpDir}/silence-${String(i).padStart(2, '0')}.wav`
        // Generate speech
        execSync(`espeak-ng -v ${lines[i].voice} -s 150 -w ${outFile} "${lines[i].text.replace(/"/g, '\\"')}"`, { stdio: 'pipe' })
        // Generate 0.5s silence gap between lines
        execSync(`ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=mono -t 0.5 ${silenceFile} 2>/dev/null`, { stdio: 'pipe' })
        partFiles.push(outFile, silenceFile)
      }

      // Build ffmpeg concat file
      const concatList = partFiles.map(f => `file '${f}'`).join('\n')
      fs.writeFileSync(`${tmpDir}/concat.txt`, concatList)

      // Concatenate all parts into one WAV at 48kHz mono 16-bit
      execSync(`ffmpeg -y -f concat -safe 0 -i ${tmpDir}/concat.txt -ar 48000 -ac 1 -sample_fmt s16 ${CONVERSATION_WAV} 2>/dev/null`, { stdio: 'pipe' })

      // Cleanup temp files
      execSync(`rm -rf ${tmpDir}`, { stdio: 'pipe' })
      console.log('[exec-server] Conversation audio generated at', CONVERSATION_WAV)
    } else {
      // Fallback: generate speech-like noise bursts with pauses (two pitch ranges)
      console.log('[exec-server] espeak-ng not available, generating synthetic speech-like audio...')
      const sampleRate = 48000
      const duration = 60
      const numSamples = sampleRate * duration
      const buf = Buffer.alloc(44 + numSamples * 2)
      // WAV header
      buf.write('RIFF', 0); buf.writeUInt32LE(36 + numSamples * 2, 4); buf.write('WAVE', 8)
      buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
      buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28)
      buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
      buf.write('data', 36); buf.writeUInt32LE(numSamples * 2, 40)

      // Simulate two speakers with different pitch ranges and speech-like amplitude modulation
      let speaker = 0 // 0 = female (higher pitch), 1 = male (lower pitch)
      let segmentStart = 0
      const segments = [] // { start, end, speaker, silence }
      let t = 0
      while (t < duration) {
        const speakDuration = 2 + Math.random() * 4 // 2-6s speech
        const silenceDuration = 0.3 + Math.random() * 0.7 // 0.3-1s pause
        segments.push({ start: t, end: Math.min(t + speakDuration, duration), speaker, silence: false })
        t += speakDuration
        segments.push({ start: t, end: Math.min(t + silenceDuration, duration), speaker, silence: true })
        t += silenceDuration
        speaker = 1 - speaker
      }

      for (let i = 0; i < numSamples; i++) {
        const time = i / sampleRate
        let sample = 0
        for (const seg of segments) {
          if (time >= seg.start && time < seg.end) {
            if (seg.silence) { sample = 0; break }
            const baseFreq = seg.speaker === 0 ? 220 : 130 // female vs male fundamental
            // Speech-like: fundamental + harmonics with amplitude modulation
            const ampMod = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * time) // 4Hz syllable rate
            const noise = (Math.random() - 0.5) * 0.15 // fricative noise
            sample = ampMod * (
              0.4 * Math.sin(2 * Math.PI * baseFreq * time) +
              0.2 * Math.sin(2 * Math.PI * baseFreq * 2 * time) +
              0.1 * Math.sin(2 * Math.PI * baseFreq * 3 * time) +
              0.05 * Math.sin(2 * Math.PI * baseFreq * 5 * time)
            ) + noise
            sample *= 0.7 // overall volume
            break
          }
        }
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2)
      }
      fs.writeFileSync(CONVERSATION_WAV, buf)
      console.log('[exec-server] Synthetic conversation audio generated at', CONVERSATION_WAV)
    }
  }
} catch (e) {
  console.log('[exec-server] Conversation audio generation failed:', e.message)
}

// ── Generate fake video Y4M (used as fake camera input for WebRTC) ───────────
try {
  const FAKE_VIDEO = '/app/fake-video.y4m'
  if (!fs.existsSync(FAKE_VIDEO)) {
    let hasFFmpeg = false
    try { execSync('which ffmpeg', { stdio: 'pipe' }); hasFFmpeg = true } catch {}

    if (hasFFmpeg) {
      console.log('[exec-server] Generating fake video Y4M with ffmpeg...')
      execSync(
        `ffmpeg -y -f lavfi -i "testsrc2=size=640x480:rate=15:duration=30" ` +
        `-vf "drawtext=text='S%26T Properties - Test Call':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=h-50:box=1:boxcolor=black@0.6:boxborderw=5" ` +
        `-pix_fmt yuv420p ${FAKE_VIDEO} 2>/dev/null`,
        { stdio: 'pipe', timeout: 30000 }
      )
      console.log('[exec-server] Fake video generated at', FAKE_VIDEO)
    } else {
      console.log('[exec-server] ffmpeg not available, skipping fake video generation')
    }
  }
} catch (e) {
  console.log('[exec-server] Fake video generation failed:', e.message)
}

// ── Keep legacy test-audio.wav for backward compat ───────────────────────────
try {
  const WAV_PATH = '/app/test-audio.wav'
  if (!fs.existsSync(WAV_PATH)) {
    const sampleRate = 44100, freq = 440, duration = 2
    const numSamples = sampleRate * duration
    const buf = Buffer.alloc(44 + numSamples * 2)
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + numSamples * 2, 4); buf.write('WAVE', 8)
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28)
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
    buf.write('data', 36); buf.writeUInt32LE(numSamples * 2, 40)
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.round(32767 * Math.sin(2 * Math.PI * freq * i / sampleRate))
      buf.writeInt16LE(sample, 44 + i * 2)
    }
    fs.mkdirSync(path.dirname(WAV_PATH), { recursive: true })
    fs.writeFileSync(WAV_PATH, buf)
    console.log('[exec-server] Legacy test audio WAV generated at', WAV_PATH)
  }
} catch (e) {
  console.log('[exec-server] Legacy WAV generation failed:', e.message)
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[exec-server] listening on 0.0.0.0:${PORT}`)
})
