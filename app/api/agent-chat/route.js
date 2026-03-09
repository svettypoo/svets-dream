import { anthropic } from '@/lib/claude'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { checkBudget, recordTransaction } from '@/lib/spend-tracker'
import { getOrCreateAgentVM, execInVM } from '@/lib/vm-manager'
import { spawn } from 'child_process'

export const runtime = 'nodejs'

const MAX_ITERATIONS = 20 // max agentic loop turns per request

export async function POST(req) {
  const { agent, messages, orgContext, rules } = await req.json()

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
  - If you are the UI Agent: screenshot the live app, then screenshot top competitor products (Notion, Linear, Asana, Figma, etc.), compare them side by side, document specific improvements with visual evidence, and send actionable instructions to the Backend Programmer

• File System
  - Write files with heredoc: cat > path/to/file.js << 'EOF' ... EOF
  - Read files: cat path/file.js
  - List: ls -la ~/[project]/

• Web Search
  - Search the web yourself when you need documentation or answers
  - Use: curl -s "https://api.search.brave.com/..." or any public search/API

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  const defaultRules = `- NEVER ask the user to go check something, verify something, or input something manually
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

  const ctoExtra = isCTO ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR CORE WORKFLOW AS CTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have two jobs that never stop:

1. MAINTAIN THE BENCHMARK
   - Use Playwright to screenshot the live app and the top 3–5 competitors in the same category
   - Use web search to identify what features the best products have that we don't
   - Maintain a ~/[project]/BENCHMARK.md file with a structured list: Feature | Best-in-class example | Our status (missing/partial/done) | Priority
   - Update this file continuously as the product evolves
   - Example competitors for a PM tool: Linear, Notion, Asana, Height, Jira

2. APPROVAL GATE BEFORE ANY CODE IS WRITTEN
   - UI Agent sends you a design proposal for each feature
   - You compare it directly against BENCHMARK.md — does it match or beat the best product?
   - If yes: approve and instruct UI Agent to send specs to Backend Programmer
   - If no: return specific, competitor-referenced feedback ("Linear's board view has drag-to-reorder with live position indicators — ours doesn't, redesign with that in mind")
   - After 2 rounds of iteration with UI Agent, if still unresolved: write a clear message to the user summarizing both positions and ask for a decision
   - NEVER let substandard features get coded — your approval is the quality gate

Start every session by running: {"__bash_exec__": true, "command": "cat ~/pmtool/BENCHMARK.md 2>/dev/null || echo 'BENCHMARK not yet created'"}
Then immediately do a web search and Playwright screenshots to update it if needed.` : ''

  const uiAgentExtra = isUIAgent ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR CORE WORKFLOW AS UI AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Read the CTO's BENCHMARK.md to understand what features and quality bar to hit
2. For each feature: design it in detail (layout, colors, components, interactions)
3. Take Playwright screenshots of how the best competitor does it for direct comparison
4. Present your design to the CTO for approval — include the competitor screenshot and your proposed design
5. Only after CTO approves: write precise implementation specs for the Backend Programmer
6. After Backend Programmer implements: screenshot the live result and send to CTO for final review` : ''

  const systemPrompt = `You are ${agent.label}, an AI agent with the role of ${agent.role}.

Your capabilities and responsibilities:
${agent.description}
${ctoExtra}${uiAgentExtra}

You operate within an AI corporate structure. You are fully autonomous.

Organizational context:
${orgContext ? JSON.stringify(orgContext, null, 2) : 'You are part of an AI agent organization.'}
${toolsSection}
${rulesText}

Respond in character as ${agent.label}. Be direct, decisive, and capable.`

  const encoder = new TextEncoder()

  // Resolve bash path
  const { existsSync } = await import('fs')
  const BASH = [
    process.env.SHELL,
    'C:\\Users\\pargo_pxnd4wa\\scoop\\apps\\git\\current\\bin\\bash.exe',
    '/bin/bash',
    'bash',
  ].find(p => p && (p === 'bash' || existsSync(p))) || 'bash'

  const home = process.env.HOME || process.env.USERPROFILE || process.cwd()

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
    const keys = ['__bash_exec__', '__vm_exec__', '__playwright__', '__walkthrough__']
    const found = []
    for (const key of keys) {
      const startMarker = `{"${key}"`
      let searchFrom = 0
      while (true) {
        const idx = text.indexOf(startMarker, searchFrom)
        if (idx === -1) break
        // Walk from idx tracking depth + string context to find the closing }
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
        // Build conversation for the agentic loop
        const loopMessages = messages.map(m => ({ role: m.role, content: m.content }))
        let totalInputTokens = 0, totalOutputTokens = 0

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          // ── Claude turn ──
          const apiStream = anthropic.messages.stream({
            model: 'claude-opus-4-6',
            max_tokens: 8192,
            thinking: { type: 'adaptive' },
            system: systemPrompt,
            messages: loopMessages,
          })

          let fullText = ''
          // Add separator between iterations (except first)
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

          // ── Find signals ──
          const signals = findSignals(fullText)
          if (signals.length === 0) break // No commands — agent is done

          // ── Execute signals ──
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
                const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
                const res = await fetch(`${origin}/api/playwright`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '' },
                  body: JSON.stringify({ code: signal.code, url: signal.url, description: signal.description }),
                })
                const result = await res.json()
                if (result.error) {
                  send(`\n\n❌ **Browser Error:** ${result.error}`)
                  commandOutputSummary += `\n\n**Browser Error:** ${result.error}`
                } else {
                  send(`\n\n**Browser Result:**\n\`\`\`\n${result.output}\n\`\`\``)
                  commandOutputSummary += `\n\n**Browser Result:**\n\`\`\`\n${result.output}\n\`\`\``
                  if (result.screenshotUrl) send(`\n\n📸 **Screenshot:** ${result.screenshotUrl}`)
                }
              } catch (err) {
                send(`\n\n❌ **Playwright Error:** ${err.message}`)
              }

            } else if (key === '__walkthrough__') {
              send('\n\n🎬 Recording walkthrough video...')
              try {
                const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
                const res = await fetch(`${origin}/api/walkthrough`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ task: signal.task, permissionNeeded: signal.permissionNeeded, targetUrl: signal.targetUrl, agentName: agent.label }),
                })
                const result = await res.json()
                if (result.videoUrl) send(`\n\n📹 **Walkthrough ready:** ${result.videoUrl}`)
              } catch {}
            }
          }

          // ── Feed results back into conversation for next iteration ──
          loopMessages.push({
            role: 'assistant',
            content: fullText + commandOutputSummary,
          })
          loopMessages.push({
            role: 'user',
            content: 'Command executed successfully. Continue with the next step — keep building until the task is fully complete.',
          })
        }

        // Record total token usage
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
