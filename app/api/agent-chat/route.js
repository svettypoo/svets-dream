import { anthropic } from '@/lib/claude'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { checkBudget, recordTransaction } from '@/lib/spend-tracker'
import { getOrCreateAgentVM, execInVM } from '@/lib/vm-manager'
import { spawn } from 'child_process'

export const runtime = 'nodejs'

const MAX_ITERATIONS = 20
const MAX_DELEGATION_DEPTH = 2 // CTO → Agent → (sub-agent max)

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

  const toolsSection = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOLS AVAILABLE TO YOU
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These tools are installed and ready. Use them directly — no setup needed.

• Shell (Git Bash)
  - Full Unix shell: pipes, heredoc, grep, find, curl, etc.
  - Use __bash_exec__ signal to run any command
  - Working home: ${home}

• Git + GitHub
  - All projects are git repos. Commit and push after EVERY completed task.
  - Commands: git add -A && git commit -m "message" && git push
  - Run from project directory: git -C ~/[project] add -A && git -C ~/[project] commit -m "..." && git -C ~/[project] push

• Node.js + npm
  - node and npm are in PATH
  - Install packages: cd ~/[project] && npm install [packages]
  - Run server: node ~/[project]/server.js (use & to run in background)

• Browser Automation (Playwright)
  - Use __playwright__ signal to launch a browser, click, fill forms, take screenshots
  - Returns screenshots and DOM snapshots automatically
  - If you are the CTO or UI Agent: screenshot the live app AND competitor products (Linear, Notion, Asana, Height, Jira, Figma, etc.) to show side-by-side comparisons when proposing features
  - Screenshots render as inline images in the chat — label them clearly
  - When proposing a feature to the user, ALWAYS include a screenshot of how the best competitor does it

• File System
  - Write files with heredoc: cat > path/to/file.js << 'EOF' ... EOF
  - Read files: cat path/file.js
  - List: ls -la ~/[project]/

• Web Search
  - Search the web yourself when you need documentation or answers
  - Use: curl -s "https://api.search.brave.com/..." or any public search/API

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  const defaultRules = `- NEVER contact the user directly unless you are the CTO — all questions and escalations go to the CTO first
- NEVER ask the user to go check something, verify something, or input something manually
- NEVER ask the user to confirm an action before taking it
- Act autonomously and report outcomes — never ask, always do
- NEVER write code in markdown code blocks — code blocks are just text, they do nothing
- To execute code or commands, use the JSON signal formats below — these are the ONLY way to run real code
- After each command executes, you automatically receive its output — keep building step by step until complete
- ALWAYS commit and push to GitHub at the end of every task

EXECUTION SIGNALS — use these exact formats:

Run a bash command:
{"__bash_exec__": true, "command": "mkdir -p my-project && cd my-project && npm init -y", "cwd": "~/optional/path"}

Run in sandboxed Docker VM:
{"__vm_exec__": true, "command": "node --version"}

Automate a browser:
{"__playwright__": true, "url": "https://example.com", "description": "what you're doing", "code": "const title = await page.title(); return title;"}

RULES:
- ONE signal per response — it executes and you get output back automatically
- After getting output, continue to next step immediately
- Create files with heredoc: {"__bash_exec__": true, "command": "cat > file.js << 'EOF'\\ncontent\\nEOF"}
- If mkdir with brace expansion fails, use separate mkdir calls instead
- Keep going until the full task is done — do not stop after a single step`

  const rulesText = rules
    ? `\n\nGlobal Rules governing all agents:\n${rules}\n\n${defaultRules}`
    : `\n\nGlobal Rules:\n${defaultRules}`

  const isCTO = /cto|chief\s*tech/i.test(agent.role || '') || /cto/i.test(agent.label || '')
  const isUIAgent = /ui\s*agent|design|ux|front.?end/i.test(agent.role || '') || /ui\s*agent/i.test(agent.label || '')

  // Build the team roster for the CTO's delegation reference
  const teamRoster = orgContext?.nodes
    ?.filter(n => n.id !== 'rules' && n.id !== (agent.id || agent.label))
    ?.map(n => `  - "${n.label}" (id: "${n.id}") — ${n.role}: ${n.description?.split('\n')[0] || ''}`)
    ?.join('\n') || ''

  const delegationSection = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DELEGATING TO YOUR TEAM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You can assign a task to any team member using this signal:
{"__delegate__": true, "to": "<agent label or id>", "task": "<full, specific task description>"}

IMPORTANT — when you write the task, include:
1. What to build/do (specific, not vague)
2. What files to read first (VISION.md, BENCHMARK.md, existing code)
3. What tools to use (bash, Playwright, git)
4. What to produce and report back
5. Any constraints from the Vision Doc that apply

Your team:
${teamRoster}

WORKFLOW:
- One delegation per response — wait for their output before continuing
- Review their output through your role's filter: Does it meet the Vision? The benchmark?
- If output is good → proceed to next delegation or report to user
- If output is bad → give specific corrective feedback and re-delegate with corrections included
- Maximum 2 levels of delegation depth — don't over-delegate
- After all delegations complete → summarize for the user with what was built`

  const ctoExtra = isCTO ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY — READ THIS FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are blunt. You do not soften feedback. You call out bad work directly and name what's wrong.
You reference specific competitors by name (Linear, Notion, Figma, Vercel, Stripe, etc.) and compare work against them concretely.
You do not say "nice effort" or "good start." If the work is below standard, you say it plainly: "This is not good enough. Linear does X, we don't. Redesign."
You have zero tolerance for vague requests, vague designs, or vague code. Everything must be specific.
You push the team hard. You expect the top 1% of the market to be the benchmark, not a passing grade.
When you approve work, you say so briefly and move on. When you reject it, you give exact reasons with examples.
You are not cruel — you are direct. You want the team to succeed. But you will not pretend mediocre work is acceptable.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR CORE WORKFLOW AS CTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are the ONLY agent who communicates with the user. You are the guardian of the agreed vision and the quality gate for all work. No other agent talks to the user — everything routes through you.

STEP 1 — CHECK FOR VISION DOCUMENT (every session start)
{"__bash_exec__": true, "command": "ls ~/*/VISION.md 2>/dev/null | head -5 || echo 'NO_VISION'"}

→ If NO_VISION: go to STEP 2.
→ If VISION.md found: read it, greet the user with a brief status of where things stand, and ask what to focus on today.

STEP 2 — BUILD THE VISION (only if no VISION.md exists)
Have a real conversation with the user — ask, listen, propose:
- Ask: what are you building, who is it for, what's the core problem it solves?
- Use Playwright to screenshot 2–3 competing products to show the user what exists
- Based on their answers + what you've seen, propose a concrete, specific vision — not vague, not generic
- Iterate until you agree on every element
- Write the final Vision Document:
  {"__bash_exec__": true, "command": "mkdir -p ~/[project] && cat > ~/[project]/VISION.md << 'VEOF'\\n# Vision Document\\n## Product\\n[name]\\n## Target Users\\n[specific users]\\n## Core Problem\\n[specific problem]\\n## Key Features (priority order)\\n1. [feature]\\n## Design Principles\\n[principles]\\n## Success Criteria\\n[measurable outcomes]\\nVEOF"}
- Present it and say: "Does this capture what you want to build? Reply YES to approve and I'll start the team."
- Do NOT start building until the user says YES.

STEP 3 — ORCHESTRATE THE TEAM (after Vision approved)
Once vision is approved, break it into milestones. For each milestone:
1. Delegate design to UI Agent: "Read VISION.md and design [feature]. Screenshot how [competitor] does it."
2. Review UI Agent's output — approve or correct
3. Delegate implementation to Backend Programmer: "Implement exactly as UI Agent specified above: [paste specs]"
4. Delegate testing to Auditor: "Test [feature] — every user interaction including edge cases"
5. If Security Agent exists: delegate security audit when build is complete
6. Review all outputs → record milestone as complete → demo to user

STEP 4 — QUALITY GATE (permanent)
- Every delegation output must pass the Vision Document before you accept it
- Every design must beat or match the benchmark (Linear, Notion, Figma, etc.)
- If anything is below standard: say exactly what's wrong and re-delegate with specific corrections
- After 2 failed corrections: bring the specific decision to the user with both positions

${delegationSection}` : delegationSection

  const uiAgentExtra = isUIAgent ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR CORE WORKFLOW AS UI AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You see every task through a design lens: Is this the best possible UX for the user? Does it beat competitors?

1. Start every task by reading VISION.md and BENCHMARK.md (if they exist)
2. For each feature: identify the TOP 3 most common user interactions. Make the most common one THE DEFAULT — large, prominent, impossible to miss.
3. Screenshot how the best competitor implements this exact feature using Playwright
4. Design in full detail: layout, colors, typography, component specs, interaction states, edge cases
5. Present design + competitor screenshots — be specific about every element
6. Write precise implementation specs for Backend Programmer (exact CSS, component structure, API shape)
7. Never contact the user directly — report to CTO
8. After Backend implements: screenshot the live result, compare against your design, report gaps to CTO` : ''

  const systemPrompt = `You are ${agent.label}, an AI agent with the role of ${agent.role}.

Your capabilities and responsibilities:
${agent.description}
${ctoExtra}${uiAgentExtra}

You operate within an AI corporate structure. You are fully autonomous. Apply your role's specific expertise and judgment to every task — you are not a generic assistant, you are a specialist.

Organizational context (your full team):
${orgContext ? JSON.stringify(orgContext, null, 2) : 'You are part of an AI agent organization.'}
${toolsSection}
${rulesText}

Respond in character as ${agent.label}. Be direct, decisive, and specific. No hedging, no vague language.`

  const encoder = new TextEncoder()

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

  function findSignals(text) {
    const keys = ['__bash_exec__', '__vm_exec__', '__playwright__', '__walkthrough__', '__delegate__']
    const found = []
    for (const key of keys) {
      const startMarker = `{"${key}"`
      let searchFrom = 0
      while (true) {
        const idx = text.indexOf(startMarker, searchFrom)
        if (idx === -1) break
        let depth = 0, inString = false, escape = false, end = -1
        for (let i = idx; i < text.length; i++) {
          const ch = text[i]
          if (escape) { escape = false; continue }
          if (ch === '\\' && inString) { escape = true; continue }
          if (ch === '"') { inString = !inString; continue }
          if (inString) continue
          if (ch === '{') depth++
          else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
        }
        if (end !== -1) {
          try {
            const parsed = JSON.parse(text.slice(idx, end + 1))
            found.push({ key, signal: parsed, index: idx })
          } catch {}
        }
        searchFrom = idx + 1
      }
    }
    found.sort((a, b) => a.index - b.index)
    return found
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (text) => controller.enqueue(encoder.encode(text))

      try {
        const loopMessages = messages.map(m => ({ role: m.role, content: m.content }))
        let totalInputTokens = 0, totalOutputTokens = 0

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          const apiStream = anthropic.messages.stream({
            model: 'claude-opus-4-6',
            max_tokens: 8192,
            thinking: { type: 'adaptive' },
            system: systemPrompt,
            messages: loopMessages,
          })

          let fullText = ''
          if (iter > 0) send('\n\n---\n\n')

          for await (const event of apiStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              fullText += event.delta.text
              send(event.delta.text)
            }
          }

          const finalMsg = await apiStream.finalMessage()
          totalInputTokens += finalMsg.usage?.input_tokens || 0
          totalOutputTokens += finalMsg.usage?.output_tokens || 0

          const signals = findSignals(fullText)
          if (signals.length === 0) break

          let commandOutputSummary = ''

          for (const { key, signal } of signals) {
            if (key === '__bash_exec__') {
              const command = signal.command || signal.cmd
              if (!command) continue
              const resolvedCwd = signal.cwd ? signal.cwd.replace(/^~/, home) : home
              send(`\n\n💻 **Running:** \`${command.slice(0, 100)}${command.length > 100 ? '...' : ''}\``)
              try {
                const output = await runBash(command, resolvedCwd)
                const result = [output.stdout, output.stderr].filter(Boolean).join('\n').trim() || '(no output)'
                const truncated = result.slice(0, 3000)
                send(`\n\n**Output** (exit ${output.exitCode}):\n\`\`\`\n${truncated}\n\`\`\``)
                commandOutputSummary += `\n\n**Command:** \`${command}\`\n**Exit:** ${output.exitCode}\n**Output:**\n\`\`\`\n${truncated}\n\`\`\``
              } catch (err) {
                send(`\n\n❌ **Bash Error:** ${err.message}`)
                commandOutputSummary += `\n\n**Command:** \`${command}\`\n**Error:** ${err.message}`
              }

            } else if (key === '__vm_exec__' && userId) {
              const command = signal.command || signal.cmd
              if (!command) continue
              send(`\n\n🖥️ **VM:** \`${command.slice(0, 80)}\``)
              try {
                const vm = await getOrCreateAgentVM(userId)
                const output = await execInVM(vm.id, userId, command)
                const result = (output.stdout || output.stderr || '(no output)').slice(0, 3000)
                send(`\n\n**VM Output** (${vm.name}):\n\`\`\`\n${result}\n\`\`\``)
                commandOutputSummary += `\n\n**VM Command:** \`${command}\`\n**Output:**\n\`\`\`\n${result}\n\`\`\``
              } catch (err) {
                send(`\n\n❌ **VM Error:** ${err.message}`)
                commandOutputSummary += `\n\n**VM Error:** ${err.message}`
              }

            } else if (key === '__playwright__') {
              if (!signal.code) continue
              send(`\n\n🌐 **Browser:** ${signal.description || 'automating browser'}...`)
              try {
                const res = await fetch(`${origin}/api/playwright`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Cookie: cookie },
                  body: JSON.stringify({ code: signal.code, url: signal.url, description: signal.description }),
                })
                const result = await res.json()
                if (result.error) {
                  send(`\n\n❌ **Browser Error:** ${result.error}`)
                  commandOutputSummary += `\n\n**Browser Error:** ${result.error}`
                } else {
                  const browserOutput = result.output && result.output !== '(completed with no output)'
                    ? `\n\n**Browser Result:**\n\`\`\`\n${result.output}\n\`\`\`` : ''
                  if (browserOutput) send(browserOutput)
                  if (result.screenshotUrl) {
                    const imgLabel = signal.description || 'screenshot'
                    send(`\n\n![${imgLabel}](${result.screenshotUrl})`)
                    commandOutputSummary += `\n\n![${imgLabel}](${result.screenshotUrl})`
                  }
                  commandOutputSummary += browserOutput
                }
              } catch (err) {
                send(`\n\n❌ **Playwright Error:** ${err.message}`)
              }

            } else if (key === '__walkthrough__') {
              send('\n\n🎬 Recording walkthrough video...')
              try {
                const res = await fetch(`${origin}/api/walkthrough`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ task: signal.task, permissionNeeded: signal.permissionNeeded, targetUrl: signal.targetUrl, agentName: agent.label }),
                })
                const result = await res.json()
                if (result.videoUrl) send(`\n\n📹 **Walkthrough ready:** ${result.videoUrl}`)
              } catch {}

            } else if (key === '__delegate__') {
              // ── Inter-agent delegation ──
              if (_delegationDepth >= MAX_DELEGATION_DEPTH) {
                send(`\n\n⚠️ **Delegation depth limit reached** — cannot delegate further from this level.`)
                commandOutputSummary += `\n\nDelegation blocked: max depth (${MAX_DELEGATION_DEPTH}) reached.`
                continue
              }

              const targetId = signal.to
              const targetAgent = orgContext?.nodes?.find(n =>
                n.id === targetId ||
                n.id?.toLowerCase() === targetId?.toLowerCase() ||
                n.label?.toLowerCase() === targetId?.toLowerCase() ||
                n.label?.toLowerCase().includes(targetId?.toLowerCase())
              )

              if (!targetAgent) {
                send(`\n\n⚠️ **Delegation failed:** Agent "${targetId}" not found in org.`)
                commandOutputSummary += `\n\nDelegation failed: "${targetId}" not found.`
                continue
              }

              const taskText = signal.task || signal.message || ''
              send(`\n\n${'─'.repeat(50)}\n🤝 **CTO → ${targetAgent.label}** (${targetAgent.role})\n${taskText.slice(0, 200)}${taskText.length > 200 ? '...' : ''}\n${'─'.repeat(50)}\n\n`)

              // Dispatch agentStatus event hint (the UI listens for this via SSE or window events)
              // We signal via a special marker that the client can parse
              send(`\n<!--agent-active:${targetAgent.id}-->\n`)

              let subAgentOutput = ''
              try {
                const delegateRes = await fetch(`${origin}/api/agent-chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Cookie: cookie },
                  body: JSON.stringify({
                    agent: targetAgent,
                    messages: [{ role: 'user', content: taskText }],
                    orgContext,
                    rules,
                    _delegationDepth: _delegationDepth + 1,
                  }),
                })

                const reader = delegateRes.body.getReader()
                const decoder = new TextDecoder()
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  const chunk = decoder.decode(value, { stream: true })
                  subAgentOutput += chunk
                  send(chunk)
                }
              } catch (err) {
                send(`\n\n❌ **Delegation Error:** ${err.message}`)
                subAgentOutput = `Error: ${err.message}`
              }

              send(`\n\n<!--agent-idle:${targetAgent.id}-->\n`)
              send(`\n\n${'─'.repeat(50)}\n✓ **${targetAgent.label} → CTO:** Task complete\n${'─'.repeat(50)}\n\n`)
              commandOutputSummary += `\n\n**${targetAgent.label} output:**\n${subAgentOutput.slice(0, 4000)}`
            }
          }

          loopMessages.push({
            role: 'assistant',
            content: fullText + commandOutputSummary,
          })
          loopMessages.push({
            role: 'user',
            content: 'Command executed successfully. Continue with the next step — keep building until the task is fully complete.',
          })
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
        send(`\n[Error: ${err.message}]`)
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
