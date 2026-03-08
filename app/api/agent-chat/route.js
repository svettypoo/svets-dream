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
- Act autonomously and report outcomes — never ask, always do
- When you need to test code, run a script, or execute a shell command safely in a sandbox, respond with:
  {"__vm_exec__": true, "command": "the shell command to run"}
  The system will execute it in a Docker VM sandbox and return the output to you
- When you need real host machine access (git, npm, file system, installed tools, network), respond with:
  {"__bash_exec__": true, "command": "the bash command to run", "cwd": "/optional/working/directory"}
  The system will execute it on the actual machine and return the output to you
- When you need to automate a browser (navigate, click, scrape, fill forms, take screenshots), respond with:
  {"__playwright__": true, "url": "optional starting URL", "description": "what you're doing", "code": "// JS code using page, browser, context variables\nconst title = await page.title();\nreturn title;"}
  The system will run it in a real Chromium browser and return output + screenshot`

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

        // Detect VM exec signal — agent wants to run a command in a VM
        const vmExecMatch = fullText.match(/\{"__vm_exec__"[\s\S]*?\}/)
        if (vmExecMatch && userId) {
          try {
            const signal = JSON.parse(vmExecMatch[0])
            const command = signal.command || signal.cmd
            if (command) {
              controller.enqueue(encoder.encode('\n\n🖥️ Executing in VM...'))
              try {
                const vm = await getOrCreateAgentVM(userId)
                const output = await execInVM(vm.id, userId, command)
                const result = output.stdout || output.stderr || '(no output)'
                controller.enqueue(encoder.encode(
                  `\n\n**VM Output** (${vm.name}):\n\`\`\`\n${result.slice(0, 4000)}\n\`\`\``
                ))
              } catch (vmErr) {
                controller.enqueue(encoder.encode(
                  `\n\n❌ **VM Error:** ${vmErr.message}\n\nMake sure Docker Desktop is running. [Manage VMs](/vm)`
                ))
              }
            }
          } catch {}
        }

        // Detect bash exec signal — agent wants to run a command on the host machine
        const bashExecMatch = fullText.match(/\{"__bash_exec__"[\s\S]*?\}/)
        if (bashExecMatch) {
          try {
            const signal = JSON.parse(bashExecMatch[0])
            const command = signal.command || signal.cmd
            if (command) {
              controller.enqueue(encoder.encode('\n\n💻 Running on host machine...'))
              try {
                const output = await new Promise((resolve, reject) => {
                  const child = spawn('bash', ['-c', command], {
                    cwd: signal.cwd || process.cwd(),
                    env: { ...process.env, FORCE_COLOR: '0' },
                    timeout: 60000,
                    shell: false,
                  })
                  let stdout = '', stderr = ''
                  child.stdout.on('data', d => stdout += d.toString())
                  child.stderr.on('data', d => stderr += d.toString())
                  child.on('close', code => resolve({ stdout, stderr, exitCode: code }))
                  child.on('error', reject)
                })
                const result = [output.stdout, output.stderr].filter(Boolean).join('\n').trim() || '(no output)'
                controller.enqueue(encoder.encode(
                  `\n\n**Host Output** (exit ${output.exitCode}):\n\`\`\`\n${result.slice(0, 4000)}\n\`\`\``
                ))
              } catch (bashErr) {
                controller.enqueue(encoder.encode(`\n\n❌ **Bash Error:** ${bashErr.message}`))
              }
            }
          } catch {}
        }

        // Detect Playwright signal — agent wants to run browser automation
        const playwrightMatch = fullText.match(/\{"__playwright__"[\s\S]*?\}/)
        if (playwrightMatch) {
          try {
            const signal = JSON.parse(playwrightMatch[0])
            if (signal.code) {
              controller.enqueue(encoder.encode(`\n\n🌐 Running browser automation${signal.description ? `: ${signal.description}` : ''}...`))
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
                  if (result.screenshotUrl) {
                    controller.enqueue(encoder.encode(`\n\n📸 **Screenshot:** ${result.screenshotUrl}`))
                  }
                }
              } catch (pwErr) {
                controller.enqueue(encoder.encode(`\n\n❌ **Playwright Error:** ${pwErr.message}`))
              }
            }
          } catch {}
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
