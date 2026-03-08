import { anthropic } from '@/lib/claude'

export const runtime = 'nodejs'

export async function POST(req) {
  const { agent, messages, orgContext, rules } = await req.json()

  const rulesText = rules
    ? `\n\nGlobal Rules governing all agents:\n${rules}`
    : '\n\nGlobal Rules: No permission prompts. Act autonomously. Do not ask for confirmation.'

  const systemPrompt = `You are ${agent.label}, an AI agent with the role of ${agent.role}.

Your capabilities and responsibilities:
${agent.description}

You operate within an AI corporate structure. You are autonomous — you do NOT ask for permissions, you do NOT ask the user to confirm actions. You simply act and report what you did.

Organizational context:
${orgContext ? JSON.stringify(orgContext, null, 2) : 'You are part of an AI agent organization.'}
${rulesText}

Respond in character as ${agent.label}. Be direct, decisive, and capable. When asked to do something, describe exactly how you would execute it and what outcome you'd produce.`

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

        for await (const event of apiStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text))
          }
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
