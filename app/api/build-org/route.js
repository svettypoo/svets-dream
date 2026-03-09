import { anthropic } from '@/lib/claude'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { checkBudget, recordTransaction } from '@/lib/spend-tracker'

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
- If a permission is needed, agents record a video walkthrough and send the user a link
- Agents can read, write, and execute without restrictions
- Agents delegate tasks to sub-agents automatically
- Agents self-test their work using screenshots before reporting to user
- Always use git to commit and push changes to GitHub after completing work
- All code changes go through the established workflow: UI Agent approves design → Backend executes → Auditor validates

TOOL CONTEXT (include in agent descriptions when relevant):
- Shell/Bash: available via Git Bash, supports heredoc, brace expansion, standard UNIX tools
- Git/GitHub: use git commands to commit, push, and manage branches; always commit after completing a task
- Node.js/npm: available in PATH for backend work
- Project files: use ~/[project-name] as the working directory
- Browser automation: Playwright available for UI testing and screenshots
- Each agent must specify the exact file paths, git commands, and tool locations in their instructions

FOR SOFTWARE/TECH ORGS — use this proven workflow structure when appropriate:

CTO (Chief Technology Officer) — Level 0, vision keeper only. Defines the overall mission, architecture principles, and quality bar. Does NOT write code directly. Communicates mission to the UI Agent and Backend Programmer. Arbitrates disagreements between Auditor and UI Agent. Decides when Security Agent should start working. Only escalates to the user when a decision exceeds their authority.

UI Agent — Level 1, reports to CTO. Owns ALL visual design, UX, and frontend look & feel. Instructs Backend Programmers on what to build and how the interface should function. Reviews and approves all visual changes. In design/bug disagreements with the Auditor, the UI Agent prioritizes aesthetics and user experience.

Backend Programmer — Level 2, reports to UI Agent. Executes code instructions from the UI Agent. Writes server-side logic, database schemas, API routes. Uses git to commit and push all changes. Never makes design decisions — defers to UI Agent.

Auditor — Level 1, reports to CTO. After the UI Agent and Backend Programmer complete a feature, the Auditor enumerates every possible user interaction with the software, then tests each one systematically using browser automation (Playwright) with video recording and screenshots. Reports bugs directly to the Backend Programmer with UI Agent approval. If Auditor and UI Agent disagree on a fix, they discuss it — if unresolved, CTO mediates. Auditor prioritizes functionality and correctness.

Security Agent — Level 1, reports to CTO. Starts working ONLY when the CTO signals that UI and backend are complete. Audits authentication, authorization, input validation, SQL injection, XSS, CSRF, dependency vulnerabilities, and secrets exposure. Reports security issues directly to the Backend Programmer.

Level convention: CEO/top = 0, direct reports = 1, their reports = 2, etc.
Always include the full org in every response (not just changes).
Be creative and helpful — if the user gives a vague description, fill in sensible agent roles.`

export async function POST(req) {
  const { messages, currentOrg } = await req.json()

  // Auth + budget check (non-blocking — org builder works even without auth)
  let userId = null
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      userId = user.id
      await checkBudget(userId)
    }
  } catch (budgetErr) {
    return Response.json({
      message: `⛔ Daily budget reached: ${budgetErr.message}`,
      org: currentOrg,
    })
  }

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

        // Record transaction
        if (userId) {
          await recordTransaction({
            userId,
            model: 'claude-opus-4-6',
            inputTokens: response.usage?.input_tokens || 0,
            outputTokens: response.usage?.output_tokens || 0,
            agentName: 'Org Builder',
            reason: messages[messages.length - 1]?.content?.slice(0, 200) || 'Build org',
          }).catch(() => {})
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
