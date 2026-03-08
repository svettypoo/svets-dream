import { anthropic } from '@/lib/claude'
import { chromium } from 'playwright'
import { textToSpeechFile } from '@/lib/tts'
import { buildWalkthroughVideo, uploadTo0x0 } from '@/lib/video'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 120 // 2 minutes — video generation takes time

// Called by agents when they need to show the user how to grant a permission.
// Returns: { videoUrl, steps }
export async function POST(req) {
  const { task, permissionNeeded, targetUrl, agentName } = await req.json()

  const workDir = join(tmpdir(), `walkthrough-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })

  let browser = null
  try {
    // Step 1: Claude plans the walkthrough steps
    const planResponse = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: `You are planning a screen walkthrough to show a user how to grant a specific permission.
Return a JSON array of steps:
[
  {
    "narration": "Short spoken narration for this step (under 150 chars)",
    "caption": "On-screen caption text",
    "action": "navigate" | "wait" | "highlight",
    "url": "URL to navigate to (for navigate action)",
    "waitMs": 2000,
    "selector": "CSS selector to highlight (optional)"
  }
]
Keep it to 3-6 steps. Be specific and direct. Start with navigating to the right page.`,
      messages: [{
        role: 'user',
        content: `Task: ${task}\nPermission needed: ${permissionNeeded}\nTarget URL: ${targetUrl || 'N/A'}\nCreate a walkthrough showing exactly how to grant this permission.`
      }]
    })

    let steps = []
    const planText = planResponse.content.find(b => b.type === 'text')?.text || '[]'
    try {
      const match = planText.match(/\[[\s\S]*\]/)
      steps = JSON.parse(match ? match[0] : '[]')
    } catch {
      steps = [{
        narration: `To grant ${permissionNeeded}, navigate to the settings page.`,
        caption: 'Opening settings...',
        action: 'navigate',
        url: targetUrl || 'about:blank',
        waitMs: 2000,
      }]
    }

    // Step 2: Playwright captures each step as a screenshot
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 720 })

    const videoSteps = []

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]

      if (step.action === 'navigate' && step.url && step.url !== 'about:blank') {
        try {
          await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 10000 })
        } catch {}
      }

      await page.waitForTimeout(step.waitMs || 1500)

      // Draw caption overlay on screenshot
      if (step.caption) {
        await page.evaluate((caption) => {
          const existing = document.getElementById('__walkthrough_caption')
          if (existing) existing.remove()
          const el = document.createElement('div')
          el.id = '__walkthrough_caption'
          el.style.cssText = `
            position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
            background:rgba(0,0,0,0.8);color:#fff;padding:12px 24px;
            border-radius:8px;font-size:18px;font-family:sans-serif;
            max-width:80%;text-align:center;z-index:99999;
            box-shadow:0 4px 20px rgba(0,0,0,0.5);
          `
          el.textContent = caption
          document.body.appendChild(el)
        }, step.caption)
      }

      const screenshotPath = join(workDir, `step-${i}.png`)
      await page.screenshot({ path: screenshotPath })

      // TTS audio for this step
      let audioPath = null
      if (step.narration) {
        audioPath = join(workDir, `audio-${i}.mp3`)
        try {
          await textToSpeechFile(step.narration, audioPath)
        } catch {
          audioPath = null
        }
      }

      videoSteps.push({
        screenshotPath,
        audioPath,
        durationMs: Math.max(step.waitMs || 1500, 3000),
        caption: step.caption,
      })
    }

    await browser.close()
    browser = null

    // Step 3: Build MP4
    const videoPath = join(workDir, 'walkthrough.mp4')
    await buildWalkthroughVideo(videoSteps, videoPath)

    // Step 4: Upload to 0x0.st
    const videoUrl = await uploadTo0x0(videoPath)

    // Cleanup
    await rm(workDir, { recursive: true, force: true })

    return Response.json({
      videoUrl,
      stepCount: steps.length,
      message: `I've recorded a walkthrough showing how to ${permissionNeeded}. Watch the video and follow along — it takes about ${steps.length * 3} seconds.`,
    })

  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    return Response.json({ error: err.message }, { status: 500 })
  }
}
