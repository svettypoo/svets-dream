import { anthropic } from '@/lib/claude'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { checkBudget, recordTransaction } from '@/lib/spend-tracker'
import { spawn } from 'child_process'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 min — Vercel Pro limit for long agent chains
const MAX_ITERATIONS = 20
const MAX_DELEGATION_DEPTH = 2

export async function POST(req) {
  const { agent, messages, orgContext, rules, _delegationDepth = 0 } = await req.json()

  const home = process.env.HOME || process.env.USERPROFILE || process.cwd()
  const reqUrl = new URL(req.url)
  const origin = `${reqUrl.protocol}//${reqUrl.host}`
  const cookie = req.headers.get('cookie') || ''

  // Auth + budget check
  let userId = null
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      userId = user.id
      await checkBudget(userId)
    }
  } catch (budgetErr) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`⛔ **Budget limit reached:** ${budgetErr.message}\n\nUpdate your limit at [Billing Settings](/billing).`))
        controller.close()
      }
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  const isCTO = /cto|chief\s*tech/i.test(agent.role || '') || /cto/i.test(agent.label || '')
  const isTopAgent = (agent.level === 0 || agent.level === '0' || isCTO) && agent.id !== 'rules'
  const isUIAgent = /ui\s*agent|design|ux|front.?end/i.test(agent.role || '') || /ui\s*agent/i.test(agent.label || '')

  const teamRoster = orgContext?.nodes
    ?.filter(n => n.id !== 'rules' && n.id !== (agent.id || agent.label))
    ?.map(n => `  - "${n.label}" (id: "${n.id}") — ${n.role}: ${n.description?.split('\n')[0] || ''}`)
    ?.join('\n') || ''

  // ── Tool definitions ──────────────────────────────────────────────────────
  const managerTools = [
    {
      name: 'delegate_task',
      description: `Assign implementation work to a team member. You NEVER implement anything yourself — all coding, design, testing goes through this tool.\n\nYour team:\n${teamRoster || '(no team members)'}`,
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Agent label or id to assign to (e.g. "Backend Programmer", "UI Agent")' },
          task: { type: 'string', description: 'Full task: what to build, what files to read first, what tools to use, what to deliver back' },
        },
        required: ['to', 'task'],
      },
    },
    {
      name: 'read_files',
      description: 'Read project files to check status — ls, cat, find, grep only. Use to check for VISION.md, review project structure.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Read-only bash command (ls, cat, find, grep, head, tail)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'write_document',
      description: 'Write a planning document (VISION.md, BENCHMARK.md, etc.) to disk.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, e.g. ~/myproject/VISION.md' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  ]

  const implementerTools = [
    {
      name: 'write_file',
      description: 'Write any file to disk safely — use this instead of bash heredoc for HTML, CSS, JS, JSON, config files. Handles special characters without quoting issues.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (e.g. ~/myproject/index.html)' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'run_bash',
      description: 'Execute any shell command: install packages, run servers, commit and push to GitHub, test code. For writing file content use write_file instead.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          cwd: { type: 'string', description: 'Optional working directory (e.g. ~/myproject)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'run_browser',
      description: 'Automate a browser with Playwright: take screenshots, test UI, scrape pages, benchmark competitors.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
          description: { type: 'string', description: 'What you are doing' },
          code: { type: 'string', description: 'Playwright JS code (page object is already available, return values are captured)' },
        },
        required: ['url', 'description', 'code'],
      },
    },
  ]

  const tools = isTopAgent ? managerTools : implementerTools

  // ── System prompt ─────────────────────────────────────────────────────────
  const globalRules = rules
    ? `Global Rules:\n${rules}\n\n`
    : ''

  const ctoWorkflow = isCTO ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are blunt. You do not soften feedback. You call out bad work directly.
You reference competitors by name (Linear, Notion, Figma, Vercel, Stripe) and compare against them concretely.
You have zero tolerance for vague work. Everything must be specific.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESEARCH-FIRST RULE (ABSOLUTE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before asking the user ANY question, you MUST:
1. Search online for the answer yourself (use read_files to check existing files, delegate run_browser to UI Agent to screenshot competitors)
2. Form a concrete recommendation based on what you found
3. Present your finding + recommendation FIRST, then ask the user only if there is a genuine decision that requires their preference

WRONG: "What color scheme do you want?"
RIGHT: "I looked at Compass, Serhant, and Douglas Elliman. All use white/off-white backgrounds with dark charcoal text and one accent color (navy or forest green). I recommend navy (#1B2A4A) with white — it reads as premium and trustworthy. Want to go a different direction?"

WRONG: "Do you have existing branding?"
RIGHT: "I searched for S&T Properties branding online. [Result of search]. Based on what I found, I recommend [X]. Confirm or override."

Never ask an open-ended question the internet could answer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — Check for VISION.md (every session start)
Call read_files: "ls ~/*/VISION.md 2>/dev/null || echo NO_VISION"
→ If NO_VISION: go to STEP 2.
→ If found: read it, greet user with status, ask what to focus on.

STEP 2 — Build the Vision (only if no VISION.md)
- Research the space FIRST: delegate to UI Agent to screenshot top 3 competitors using run_browser
- Based on your research, PROPOSE a complete vision (don't ask open questions)
- If you need a preference decision from the user, give them 2–3 specific options with your recommendation
- Write the agreed vision with write_document to ~/[project]/VISION.md
- Say: "Does this capture it? Reply YES to start the team."
- DO NOT start building until user says YES.

STEP 3 — Orchestrate (after Vision approved)
You NEVER implement. All work goes through delegate_task.
Order: UI Agent (design) → Backend Programmer (implement) → Auditor (test) → Security Agent (audit if exists)
Review each output: pass the Vision? Beat the benchmark? If not, re-delegate with specific corrections.

STEP 4 — Quality Gate (always)
Every output must pass the Vision. Every design must match or beat the best competitor.
If anything is below standard: say exactly what's wrong, re-delegate with corrections.
After 2 failed corrections: bring the decision to the user with both positions.` : ''

  const uiWorkflow = isUIAgent ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR WORKFLOW AS UI AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Read VISION.md and BENCHMARK.md first (run_bash: cat ~/project/VISION.md)
2. Use run_browser to screenshot the best competitor doing this exact feature
3. Design in full detail: layout, colors, typography, components, states, edge cases
4. Present design + competitor screenshots with specific comparisons
5. Write precise specs for Backend Programmer (exact CSS, component structure, API shape)
6. Never contact the user — report to CTO
7. After implementation: screenshot the live result, compare against design, report gaps` : ''

  const implementerInstructions = !isTopAgent ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use run_bash for ALL file operations, installs, tests, commits
- Use run_browser for screenshots and browser testing
- NEVER contact the user directly — report results back to the CTO
- ALWAYS commit and push to GitHub when done: git add -A && git commit -m "..." && git push
- Keep going until the task is FULLY complete — do not stop after one step
- Home directory: ${home}` : ''

  const systemPrompt = `You are ${agent.label}, an AI agent with the role of ${agent.role}.

${agent.description}
${ctoWorkflow}${uiWorkflow}${implementerInstructions}

${globalRules}Org context:
${orgContext ? JSON.stringify(orgContext.nodes?.map(n => ({ id: n.id, label: n.label, role: n.role, level: n.level })), null, 2) : 'Standalone agent.'}

You are fully autonomous. Be direct and decisive. No hedging, no asking for permission, no vague language.`

  // ── Bash runner ───────────────────────────────────────────────────────────
  const { existsSync } = await import('fs')
  const BASH = [
    process.env.SHELL,
    'C:\\Users\\pargo_pxnd4wa\\scoop\\apps\\git\\current\\bin\\bash.exe',
    '/bin/bash',
    'bash',
  ].find(p => p && (p === 'bash' || existsSync(p))) || 'bash'

  function runBash(command, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawn(BASH, ['-c', command], {
        cwd: (cwd || home).replace(/^~/, home),
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: 120000,
        shell: false,
      })
      let stdout = '', stderr = ''
      child.stdout.on('data', d => stdout += d.toString())
      child.stderr.on('data', d => stderr += d.toString())
      child.on('close', code => resolve({ stdout, stderr, exitCode: code }))
      child.on('error', reject)
    })
  }

  // ── Tool executor ─────────────────────────────────────────────────────────
  async function executeTool(name, input, send) {
    if (name === 'delegate_task') {
      if (_delegationDepth >= MAX_DELEGATION_DEPTH) {
        send(`\n\n⚠️ **Delegation depth limit reached.**`)
        return 'Delegation blocked: max depth reached.'
      }

      const targetAgent = orgContext?.nodes?.find(n =>
        n.id === input.to ||
        n.id?.toLowerCase() === input.to?.toLowerCase() ||
        n.label?.toLowerCase() === input.to?.toLowerCase() ||
        n.label?.toLowerCase().includes(input.to?.toLowerCase())
      )

      if (!targetAgent) {
        return `Agent "${input.to}" not found in org. Available: ${teamRoster}`
      }

      const divider = '─'.repeat(50)
      send(`\n\n${divider}\n🤝 **${agent.label} → ${targetAgent.label}** (${targetAgent.role})\n${input.task.slice(0, 200)}${input.task.length > 200 ? '...' : ''}\n${divider}\n\n`)
      send(`\n<!--agent-active:${targetAgent.id}-->\n`)

      // Auto-inject shared context
      let sharedContext = ''
      try {
        for (const { cmd, label } of [
          { cmd: `cat ~/*/VISION.md 2>/dev/null | head -200`, label: 'VISION' },
          { cmd: `cat ~/*/BENCHMARK.md 2>/dev/null | head -100`, label: 'BENCHMARK' },
          { cmd: `ls ~/*/ 2>/dev/null | head -40`, label: 'PROJECT FILES' },
        ]) {
          const r = await runBash(cmd, home)
          if (r.stdout.trim().length > 10) sharedContext += `\n\n=== ${label} ===\n${r.stdout.trim().slice(0, 6000)}`
        }
      } catch {}

      const enrichedTask = sharedContext
        ? `${input.task}\n\n--- SHARED PROJECT CONTEXT (read before starting) ---${sharedContext}`
        : input.task

      let subOutput = ''
      try {
        const res = await fetch(`${origin}/api/agent-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            agent: targetAgent,
            messages: [{ role: 'user', content: enrichedTask }],
            orgContext,
            rules,
            _delegationDepth: _delegationDepth + 1,
          }),
        })
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          subOutput += chunk
          send(chunk)
        }
      } catch (err) {
        send(`\n\n❌ **Delegation Error:** ${err.message}`)
        subOutput = `Error: ${err.message}`
      }

      send(`\n\n<!--agent-idle:${targetAgent.id}-->\n`)
      send(`\n\n${divider}\n✓ **${targetAgent.label} → ${agent.label}:** Complete\n${divider}\n\n`)
      return subOutput.slice(0, 5000) || 'Task complete.'

    } else if (name === 'read_files') {
      const cmd = input.command
      const safe = /^(ls|cat|find|head|tail|echo|pwd|grep|wc|stat)\b/.test(cmd.trim())
      if (!safe) return 'Blocked: only ls, cat, find, grep, head, tail allowed here.'
      send(`\n\n🔍 \`${cmd.slice(0, 80)}\``)
      const r = await runBash(cmd, home)
      const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim() || '(empty)'
      send(`\n\`\`\`\n${out.slice(0, 2000)}\n\`\`\``)
      return out.slice(0, 4000)

    } else if (name === 'write_document' || name === 'write_file') {
      const { writeFileSync, mkdirSync } = await import('fs')
      const { dirname } = await import('path')
      const resolvedPath = input.path.replace(/^~/, home)
      send(`\n\n📄 **Writing** \`${input.path}\` (${(input.content || '').length} chars)`)
      try {
        mkdirSync(dirname(resolvedPath), { recursive: true })
        writeFileSync(resolvedPath, input.content, 'utf8')
        send(`\n\n✅ Written: ${input.path}`)
        return `Written: ${input.path} (${input.content.length} chars)`
      } catch (err) {
        send(`\n\n❌ ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'run_bash') {
      const cmd = input.command
      const cwd = input.cwd ? input.cwd.replace(/^~/, home) : home
      send(`\n\n💻 **Running:** \`${cmd.slice(0, 100)}${cmd.length > 100 ? '...' : ''}\``)
      try {
        const r = await runBash(cmd, cwd)
        const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim() || '(no output)'
        const truncated = out.slice(0, 3000)
        send(`\n\n**Output** (exit ${r.exitCode}):\n\`\`\`\n${truncated}\n\`\`\``)
        return `exit ${r.exitCode}:\n${truncated}`
      } catch (err) {
        send(`\n\n❌ **Error:** ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'run_browser') {
      send(`\n\n🌐 **Browser:** ${input.description}...`)
      try {
        const res = await fetch(`${origin}/api/playwright`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ code: input.code, url: input.url, description: input.description }),
        })
        const result = await res.json()
        if (result.error) {
          send(`\n\n❌ **Browser Error:** ${result.error}`)
          return `Error: ${result.error}`
        }
        let out = ''
        if (result.output && result.output !== '(completed with no output)') {
          send(`\n\n**Result:**\n\`\`\`\n${result.output}\n\`\`\``)
          out += result.output
        }
        if (result.screenshotUrl) {
          send(`\n\n![${input.description}](${result.screenshotUrl})`)
          out += `\nScreenshot: ${result.screenshotUrl}`
        }
        return out || 'Browser task completed.'
      } catch (err) {
        send(`\n\n❌ **Playwright Error:** ${err.message}`)
        return `Error: ${err.message}`
      }
    }

    return `Unknown tool: ${name}`
  }

  // ── Stream ────────────────────────────────────────────────────────────────
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (text) => controller.enqueue(encoder.encode(text))

      try {
        // Normalize messages: strip leading assistant, merge consecutive same-role
        let loopMessages = messages.map(m => ({ role: m.role, content: m.content }))
        while (loopMessages.length > 0 && loopMessages[0].role !== 'user') loopMessages.shift()
        const normalized = []
        for (const msg of loopMessages) {
          const last = normalized[normalized.length - 1]
          if (last && last.role === msg.role) last.content += '\n\n' + msg.content
          else normalized.push({ ...msg })
        }
        loopMessages = normalized

        let totalInputTokens = 0, totalOutputTokens = 0

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          if (iter > 0) send('\n\n---\n\n')

          // NOTE: Anthropic API does not allow thinking + tool_choice:any/required together.
          // On first turn for top agents we force a tool call (any) — so thinking must be off.
          // All subsequent turns use auto tool_choice so thinking can be on.
          const forceToolCall = isTopAgent && iter === 0
          const toolChoice = forceToolCall ? { type: 'any' } : { type: 'auto' }
          const thinkingConfig = forceToolCall
            ? { type: 'disabled' }
            : { type: 'enabled', budget_tokens: 8000 }

          const apiStream = anthropic.messages.stream({
            model: 'claude-opus-4-6',
            max_tokens: 16000,
            thinking: thinkingConfig,
            tools,
            tool_choice: toolChoice,
            system: systemPrompt,
            messages: loopMessages,
          })

          // Stream text deltas to client in real time
          for await (const event of apiStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              send(event.delta.text)
            }
          }

          const finalMsg = await apiStream.finalMessage()
          totalInputTokens += finalMsg.usage?.input_tokens || 0
          totalOutputTokens += finalMsg.usage?.output_tokens || 0

          const toolUseBlocks = finalMsg.content.filter(b => b.type === 'tool_use')

          // No tool calls = model is done
          if (toolUseBlocks.length === 0) break

          // Preserve full response (including thinking blocks) in history
          loopMessages.push({ role: 'assistant', content: finalMsg.content })

          // Execute all tool calls and collect results
          const toolResults = []
          for (const block of toolUseBlocks) {
            const result = await executeTool(block.name, block.input, send)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: String(result),
            })
          }

          // Feed results back
          loopMessages.push({ role: 'user', content: toolResults })
        }

        if (userId) {
          await recordTransaction({
            userId,
            model: 'claude-opus-4-6',
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            agentName: agent.label,
            reason: messages[messages.length - 1]?.content?.slice(0, 200) || 'Agent chat',
          }).catch(() => {})
        }

        controller.close()
      } catch (err) {
        // Log server-side but never expose raw API errors to the user
        console.error(`[agent-chat] ${agent.label} error:`, err.message)
        // Silently close — partial response already streamed is enough context
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
