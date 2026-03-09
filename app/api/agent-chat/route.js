import { anthropic } from '@/lib/claude'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { checkBudget, recordTransaction } from '@/lib/spend-tracker'
import { getOrCreateAgentVM, execInVM } from '@/lib/vm-manager'
import { spawn } from 'child_process'

export const runtime = 'nodejs'

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
- Break large tasks into small steps — execute one step at a time, report the result, then continue
- NEVER write code in markdown code blocks and expect it to run — code blocks are just text, they do nothing
- To actually execute code or commands, you MUST use the JSON signal formats below — these are the ONLY way to run real code

EXECUTION SIGNALS — copy these formats exactly, one per message:

To run a bash command on the host machine (create files, run npm, git, etc.):
{"__bash_exec__": true, "command": "mkdir -p my-project && cd my-project && npm init -y", "cwd": "/optional/path"}

To run a command in a sandboxed Docker VM:
{"__vm_exec__": true, "command": "node --version"}

To automate a browser:
{"__playwright__": true, "url": "https://example.com", "description": "what you're doing", "code": "const title = await page.title(); return title;"}

To show the user how to grant a permission:
{"__walkthrough__": true, "permissionNeeded": "description", "targetUrl": "url", "task": "what you were doing"}

IMPORTANT RULES FOR EXECUTION:
- Use ONE signal per message — the system executes it and returns the output to you, then you continue
- After receiving output from a command, send your next command in a follow-up signal
- Do NOT dump an entire project's worth of commands in one message — do it step by step
- When creating files, use bash heredoc syntax: {"__bash_exec__": true, "command": "cat > filename.js << 'EOF'\\nfile content here\\nEOF"}`

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

You have access to web search. When you need to find information, state that you are searching and describe what you found.
Respond in character as ${agent.label}. Be direct, decisive, and capable.`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const apiStream = anthropic.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 8192,
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

        // Record transaction
        const finalMsg = await apiStream.finalMessage()
        if (userId) {
          await recordTransaction({
            userId,
            model: 'claude-opus-4-6',
            inputTokens: finalMsg.usage?.input_tokens || 0,
            outputTokens: finalMsg.usage?.output_tokens || 0,
            agentName: agent.label,
            reason: messages[messages.length - 1]?.content?.slice(0, 200) || 'Agent chat',
          }).catch(() => {})
        }

        // Execute all signals found in the response
        const execResults = []

        // Helper: run a bash command on host
        const { existsSync } = await import('fs')
        const BASH = [
          process.env.SHELL,
          'C:\\Users\\pargo_pxnd4wa\\scoop\\apps\\git\\current\\bin\\bash.exe',
          '/bin/bash',
          'bash',
        ].find(p => p && (p === 'bash' || existsSync(p))) || 'bash'

        async function runBash(command, cwd) {
          return new Promise((resolve, reject) => {
            const child = spawn(BASH, ['-c', command], {
              cwd: cwd || process.env.HOME || process.cwd(),
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

        // Find all JSON signals in the response
        const signalRegex = /\{(?:"__bash_exec__|__vm_exec__|__playwright__|__walkthrough__")[^}]*(?:\{[^}]*\}[^}]*)?\}/g
        const allSignals = []
        let match
        // Use a broader approach — find all { ... } blobs that contain our signal keys
        const signalKeys = ['__bash_exec__', '__vm_exec__', '__playwright__', '__walkthrough__']
        for (const key of signalKeys) {
          const re = new RegExp(`\\{"${key}"[\\s\\S]*?\\}(?=\\s*(?:\\n|$|[^,]))`, 'g')
          let m
          while ((m = re.exec(fullText)) !== null) {
            try {
              const parsed = JSON.parse(m[0])
              allSignals.push({ key, signal: parsed, index: m.index })
            } catch {}
          }
        }
        // Sort by position in text
        allSignals.sort((a, b) => a.index - b.index)

        for (const { key, signal } of allSignals) {
          if (key === '__bash_exec__') {
            const command = signal.command || signal.cmd
            if (!command) continue
            // Expand ~ in cwd
            const home = process.env.HOME || process.env.USERPROFILE || process.cwd()
            const resolvedCwd = signal.cwd ? signal.cwd.replace(/^~/, home) : home
            controller.enqueue(encoder.encode(`\n\n💻 **Running:** \`${command.slice(0, 80)}${command.length > 80 ? '...' : ''}\``))
            try {
              const output = await runBash(command, resolvedCwd)
              const result = [output.stdout, output.stderr].filter(Boolean).join('\n').trim() || '(no output)'
              const resultText = `\n\n**Output** (exit ${output.exitCode}):\n\`\`\`\n${result.slice(0, 3000)}\n\`\`\``
              controller.enqueue(encoder.encode(resultText))
              execResults.push({ type: 'bash', command, result: result.slice(0, 3000), exitCode: output.exitCode })
            } catch (err) {
              controller.enqueue(encoder.encode(`\n\n❌ **Bash Error:** ${err.message}`))
              execResults.push({ type: 'bash', command, error: err.message })
            }
          }

          else if (key === '__vm_exec__' && userId) {
            const command = signal.command || signal.cmd
            if (!command) continue
            controller.enqueue(encoder.encode(`\n\n🖥️ **VM:** \`${command.slice(0, 80)}\``))
            try {
              const vm = await getOrCreateAgentVM(userId)
              const output = await execInVM(vm.id, userId, command)
              const result = output.stdout || output.stderr || '(no output)'
              controller.enqueue(encoder.encode(`\n\n**VM Output** (${vm.name}):\n\`\`\`\n${result.slice(0, 3000)}\n\`\`\``))
              execResults.push({ type: 'vm', command, result: result.slice(0, 3000) })
            } catch (err) {
              controller.enqueue(encoder.encode(`\n\n❌ **VM Error:** ${err.message}\n\nMake sure Docker Desktop is running. [Manage VMs](/vm)`))
              execResults.push({ type: 'vm', command, error: err.message })
            }
          }

          else if (key === '__playwright__') {
            if (!signal.code) continue
            controller.enqueue(encoder.encode(`\n\n🌐 **Browser:** ${signal.description || 'automating browser'}...`))
            try {
              const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
              const res = await fetch(`${origin}/api/playwright`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '' },
                body: JSON.stringify({ code: signal.code, url: signal.url, description: signal.description }),
              })
              const result = await res.json()
              if (result.error) {
                controller.enqueue(encoder.encode(`\n\n❌ **Browser Error:** ${result.error}`))
              } else {
                controller.enqueue(encoder.encode(`\n\n**Browser Result:**\n\`\`\`\n${result.output}\n\`\`\``))
                if (result.screenshotUrl) controller.enqueue(encoder.encode(`\n\n📸 **Screenshot:** ${result.screenshotUrl}`))
              }
            } catch (err) {
              controller.enqueue(encoder.encode(`\n\n❌ **Playwright Error:** ${err.message}`))
            }
          }

          else if (key === '__walkthrough__') {
            controller.enqueue(encoder.encode('\n\n🎬 Recording walkthrough video...'))
            try {
              const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
              const res = await fetch(`${origin}/api/walkthrough`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task: signal.task, permissionNeeded: signal.permissionNeeded, targetUrl: signal.targetUrl, agentName: agent.label }),
              })
              const result = await res.json()
              if (result.videoUrl) {
                controller.enqueue(encoder.encode(`\n\n📹 **Walkthrough ready:** ${result.videoUrl}\n\nWatch this ${result.stepCount}-step video — I'll narrate exactly what to do. Come back when done and I'll continue.`))
              }
            } catch {}
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
