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

  const defaultRules = `- NEVER ask the user to go check something, verify something, or input something manually
- NEVER ask the user to confirm an action before taking it
- If you need information, search the web yourself to find it
- Act autonomously and report outcomes — never ask, always do
- NEVER write code in markdown code blocks and expect it to run — code blocks are just text, they do nothing
- To actually execute code or commands, you MUST use the JSON signal formats below — these are the ONLY way to run real code
- After each command executes, you will automatically receive its output and continue — keep building step by step until complete

EXECUTION SIGNALS — use these exact formats:

Run a bash command on the host machine (create files, install packages, etc.):
{"__bash_exec__": true, "command": "mkdir -p my-project && npm init -y", "cwd": "~/optional/path"}

Run a command in a sandboxed Docker VM:
{"__vm_exec__": true, "command": "node --version"}

Automate a browser:
{"__playwright__": true, "url": "https://example.com", "description": "what you're doing", "code": "const title = await page.title(); return title;"}

IMPORTANT:
- You can include ONE signal per response — it executes automatically and you get the output back
- After getting output, continue to the next step immediately — no waiting, no asking
- When creating files use heredoc: {"__bash_exec__": true, "command": "cat > file.js << 'EOF'\\ncontent\\nEOF"}
- Keep going until the full task is done — do not stop after a single step`

  const rulesText = rules
    ? `\n\nGlobal Rules governing all agents:\n${rules}\n\n${defaultRules}`
    : `\n\nGlobal Rules:\n${defaultRules}`

  const systemPrompt = `You are ${agent.label}, an AI agent with the role of ${agent.role}.

Your capabilities and responsibilities:
${agent.description}

You operate within an AI corporate structure. You are fully autonomous.

Organizational context:
${orgContext ? JSON.stringify(orgContext, null, 2) : 'You are part of an AI agent organization.'}
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
      const re = new RegExp(`\\{"${key}"[\\s\\S]*?\\}(?=\\s*(?:\\n|$|[^,]))`, 'g')
      let m
      while ((m = re.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(m[0])
          found.push({ key, signal: parsed, index: m.index })
        } catch {}
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
