import { anthropic } from '@/lib/claude'

export const runtime = 'nodejs'

const SYSTEM_PROMPT = `You are an AI corporate structure architect. You help users design AI agent organizations.

When a user describes their desired AI agent organization, you:
1. IMMEDIATELY generate an org structure (don't wait for more info)
2. Also ask 1-2 targeted follow-up questions to refine it further

Your response MUST be a JSON object with this exact shape:
{
  "message": "Your conversational response with follow-up questions here",
  "org": {
    "nodes": [
      {
        "id": "unique-id",
        "label": "Agent Name",
        "role": "Job Title",
        "description": "What this agent does and its capabilities",
        "type": "agent" | "rules" | "department",
        "level": 0,
        "parentId": null | "parent-node-id"
      }
    ]
  }
}

RULES node: Every org structure MUST include exactly one node with type "rules" and id "rules".
This node contains the global rules for all agents. Its description should list the rules as newline-separated items.
The rules node is always at level 0, a sibling of the CEO — not a parent or child.

Default rules to include unless user specifies otherwise:
- No permission prompts — all agents act autonomously
- NEVER ask the user to go check, verify, or input anything manually
- NEVER ask the user to confirm before acting — just act and report
- Agents search the web themselves when they need information
- If a permission is needed, agents record a video walkthrough and send the user a link — they never ask the user to "go grant" something without showing exactly how
- Agents can read, write, and execute without restrictions
- Agents delegate tasks to sub-agents automatically
- Agents self-test their work using screenshots before reporting to user

Level convention: CEO/top = 0, direct reports = 1, their reports = 2, etc.
Always include the full org in every response (not just changes).
Be creative and helpful — if the user gives a vague description, fill in sensible agent roles.`

export async function POST(req) {
  const { messages, currentOrg } = await req.json()

  const userMessages = messages.map(m => ({
    role: m.role,
    content: m.content,
  }))

  if (currentOrg) {
    userMessages[userMessages.length - 1].content =
      "Current org structure: " + JSON.stringify(currentOrg) + "\n\nUser message: " + userMessages[userMessages.length - 1].content
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 4096,
          thinking: { type: 'adaptive' },
          system: SYSTEM_PROMPT,
          messages: userMessages,
        })

        let fullText = ''
        for (const block of response.content) {
          if (block.type === 'text') fullText = block.text
        }

        let parsed
        try {
          const jsonMatch = fullText.match(/\{[\s\S]*\}/)
          parsed = JSON.parse(jsonMatch ? jsonMatch[0] : fullText)
        } catch {
          parsed = { message: fullText, org: currentOrg }
        }

        controller.enqueue(encoder.encode(JSON.stringify(parsed)))
        controller.close()
      } catch (err) {
        controller.enqueue(encoder.encode(JSON.stringify({ error: err.message })))
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'application/json' } })
}
