import { createServerSupabaseClient } from '@/lib/supabase-server'
import { chromium } from 'playwright'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 120

// Agents call this to run browser automation.
// Request: { code: "JS using page/browser/context", url?: "starting URL", description?: "what it's doing", screenshot?: bool }
// Response: { output, screenshotUrl?, error? }
export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, url, description, screenshot = true } = await req.json()
  if (!code) return Response.json({ error: 'No code provided' }, { status: 400 })

  const workDir = join(tmpdir(), `playwright-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })

  let browser = null
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()

    // Capture console output
    const logs = []
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`))

    // Navigate to starting URL if provided
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    }

    // Execute agent's code — receives { page, browser, context } and can return a value
    let returnValue
    try {
      const fn = new Function('page', 'browser', 'context', `
        return (async () => {
          ${code}
        })()
      `)
      returnValue = await fn(page, browser, context)
    } catch (codeErr) {
      // Still take screenshot on error so agent can see what happened
      const screenshotPath = join(workDir, 'error.png')
      try { await page.screenshot({ path: screenshotPath, fullPage: false }) } catch {}
      await browser.close()
      browser = null
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
      return Response.json({
        error: codeErr.message,
        logs,
        output: logs.join('\n'),
      })
    }

    // Take screenshot if requested
    let screenshotUrl = null
    if (screenshot) {
      const screenshotPath = join(workDir, 'result.png')
      await page.screenshot({ path: screenshotPath, fullPage: false })

      // Upload to 0x0.st
      try {
        const { uploadTo0x0 } = await import('@/lib/video')
        screenshotUrl = await uploadTo0x0(screenshotPath)
      } catch {}
    }

    await browser.close()
    browser = null
    await rm(workDir, { recursive: true, force: true }).catch(() => {})

    const output = [
      returnValue !== undefined ? JSON.stringify(returnValue) : null,
      logs.length > 0 ? logs.join('\n') : null,
    ].filter(Boolean).join('\n') || '(completed with no output)'

    return Response.json({ output, screenshotUrl, logs })

  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    return Response.json({ error: err.message }, { status: 500 })
  }
}
