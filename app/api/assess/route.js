import { anthropic } from '@/lib/claude'
import { chromium } from 'playwright'

export const runtime = 'nodejs'

// Takes a screenshot of a URL and assesses it using Claude Vision.
// Agents call this to self-test before surfacing results to the user.
export async function POST(req) {
  const { url, question, context } = await req.json()

  let browser = null
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })

    const screenshotBuffer = await page.screenshot({ fullPage: false })
    const base64Image = screenshotBuffer.toString('base64')

    await browser.close()
    browser = null

    // Send to Claude Vision for assessment
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: base64Image },
            },
            {
              type: 'text',
              text: `You are assessing a UI screenshot for an AI agent building system.

Context: ${context || 'No additional context.'}

Question: ${question || 'Does this UI look correct and complete? Are there any visible errors, broken layouts, or issues?'}

Respond with:
1. PASS or FAIL
2. What you see in the screenshot (2-3 sentences)
3. Any issues found, or "None" if passing
4. Recommended fix if FAIL, or "None" if passing`,
            },
          ],
        },
      ],
    })

    const assessment = response.content.find(b => b.type === 'text')?.text || ''
    const passed = assessment.toUpperCase().startsWith('PASS')

    return Response.json({ passed, assessment, screenshot: base64Image })
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    return Response.json({ passed: false, assessment: `Error: ${err.message}`, screenshot: null }, { status: 500 })
  }
}
