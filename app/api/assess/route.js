import { anthropic } from '@/lib/claude'
import { chromium } from 'playwright'

export const runtime = 'nodejs'

// Accepts either { url } for server-side screenshot or { image } for a pre-captured base64 PNG
export async function POST(req) {
  const { url, image, question, context } = await req.json()

  let base64Image = image

  // If a URL was provided instead of an image, use Playwright to screenshot it
  if (!base64Image && url) {
    let browser = null
    try {
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage()
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
      const buf = await page.screenshot({ fullPage: false })
      base64Image = buf.toString('base64')
    } finally {
      if (browser) await browser.close().catch(() => {})
    }
  }

  if (!base64Image) {
    return Response.json({ passed: false, assessment: 'No image or URL provided.', screenshot: null }, { status: 400 })
  }

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
            text: `You are reviewing a screenshot of an AI agent corporate structure chart.

Context: ${context || 'No additional context.'}
Question: ${question || 'Does this org chart look correct, complete, and well-structured? Are there any visible errors, layout issues, or missing elements?'}

Respond with:
PASS or FAIL
Then 2-3 sentences describing what you see.
Then any issues found (or "None").
Then a recommended fix if FAIL, or "None" if passing.`,
          },
        ],
      },
    ],
  })

  const assessment = response.content.find(b => b.type === 'text')?.text || ''
  const passed = assessment.toUpperCase().startsWith('PASS')

  return Response.json({ passed, assessment, screenshot: base64Image })
}
