import { anthropic } from '@/lib/claude'

export const runtime = 'nodejs'

export async function POST(req) {
  const { agent, messages, orgContext, rules } = await req.json()

  const rulesText = rules
    ? `\n\nGlobal Rules governing all agents:\n${rules}`
    : `\n\nGlobal Rules:
- NEVER ask the user to go check something, verify something, or input something manually
- NEVER ask the user to confirm an action before taking it
- If you need information, search the web yourself to find it
- If you encounter a permission wall, do NOT ask the user to go grant it — instead respond with a JSON block:
  {"__walkthrough__": true, "permissionNeeded": "description", "targetUrl": "url", "task": "what you were doing"}
  The system will automatically generate a video walkthrough for the user
- Find permanent solutions to permission issues rather than temporary workarounds
- Act autonomously and report outcomes — never ask, always do`

  const systemPrompt = `You are ${agent.label}, an AI agent with the role of ${agent.role}.

Your capabilities and responsibilities:
${agent.description}

You operate within an AI corporate structure. You are fully autonomous.

Organizational context:
${orgContext ? JSON.stringify(orgContext, null, 2) : 'You are part of an AI agent organization.'}
${rulesText}

You have access to web search. When you need to find information, state that you are searching and describe what you found.
Respond in character as ${agent.label}. Be direct, decisive, and capable.`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const apiStream = anthropic.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 2048,
          thinking: { type: 'adaptive' },
          system: systemPrompt,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        })

        let fullText = ''
        for await (const event of apiStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }

        // Detect walkthrough signal — agent hit a permission wall
        const walkthroughMatch = fullText.match(/\{"__walkthrough__"[\s\S]*?\}/)
        if (walkthroughMatch) {
          try {
            const signal = JSON.parse(walkthroughMatch[0])
            controller.enqueue(encoder.encode('\n\n🎬 Recording walkthrough video...'))

            const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
            const res = await fetch(`${origin}/api/walkthrough`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                task: signal.task,
                permissionNeeded: signal.permissionNeeded,
                targetUrl: signal.targetUrl,
                agentName: agent.label,
              }),
            })
            const result = await res.json()
            if (result.videoUrl) {
              controller.enqueue(encoder.encode(
                `\n\n📹 **Walkthrough ready:** ${result.videoUrl}\n\nWatch this ${result.stepCount}-step video — I'll narrate exactly what you need to do to grant this permission. Once done, come back and I'll continue automatically.`
              ))
            }
          } catch {}
        }

        controller.close()
      } catch (err) {
        controller.enqueue(encoder.encode(`\n[Error: ${err.message}]`))
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
