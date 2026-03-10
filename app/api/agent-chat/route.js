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

  // On Vercel serverless, HOME=/var/task which is read-only. Use /tmp for all writes.
  const rawHome = process.env.HOME || process.env.USERPROFILE || process.cwd()
  const isVercel = !!process.env.VERCEL
  const home = isVercel ? '/tmp' : rawHome
  const tmpDir = process.env.TEMP || process.env.TMP || '/tmp'
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
      name: 'output_html',
      description: 'Output a complete HTML website. Preferred over write_file for HTML because it handles large content reliably. The "html" field must contain the ENTIRE HTML document.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Output path (e.g. ~/myproject/index.html)' },
          html: { type: 'string', description: 'The COMPLETE HTML document — all CSS in <style> tags, all JS inline or via CDN. Must be a fully valid standalone HTML file.' },
        },
        required: ['path', 'html'],
      },
    },
    {
      name: 'write_file',
      description: 'Write any non-HTML file to disk (CSS, JS, JSON, config files). For HTML files use output_html instead.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (e.g. ~/myproject/style.css)' },
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
YOUR WORKFLOW — EXECUTE IMMEDIATELY, NO GATES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — Write a vision document immediately
Call write_document to write ~/st-properties/VISION.md with a complete vision for the project.
(Note: ~ maps to /tmp on the server, so this writes to /tmp/st-properties/VISION.md)
Make confident decisions based on industry standards — do NOT ask the user for approval first.

STEP 2 — Delegate to Backend Programmer immediately
As soon as VISION.md is written, call delegate_task to the Backend Programmer.
Tell them to generate a complete single-file static HTML website using write_file to ~/st-properties/index.html.
Do NOT wait for user confirmation. Do NOT say "does this sound good?". Just delegate.

STEP 3 — Report results
After the Backend Programmer completes, tell the user what was built. The preview will show automatically.

CRITICAL RULES:
- You MUST call delegate_task within the first 3 tool calls. No exceptions.
- You NEVER implement code yourself — always use delegate_task.
- NEVER ask the user for permission to proceed. Just proceed.
- NEVER say "shall I proceed?" or "does this sound good?" — just do it.` : ''

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
- Use write_file to create HTML/CSS/JS files (no npm, no git needed)
- Use run_bash only for simple operations like mkdir, ls, cat (no npm/git/npx — not available)
- NEVER contact the user directly — report results back to the CTO
- Keep going until the task is FULLY complete — do not stop after one step
- Home directory: ${home}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML GENERATION — MANDATORY APPROACH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are running on a serverless environment. npm, git, npx, node servers — NONE are available.
You MUST generate websites as self-contained single-file HTML.

REQUIRED STEPS:
1. Use run_bash to read any VISION.md or project files first
2. Call output_html with:
   - path="~/[project]/index.html"
   - html="<FULL COMPLETE HTML DOCUMENT>"
   The "html" field MUST contain the ENTIRE HTML document — not a summary, not a description, the actual HTML code.
3. The HTML must have ALL CSS in <style> tags, ALL JS inline or via CDN (e.g. https://cdn.tailwindcss.com)
4. Make it look professional: hero, navigation, services, about, contact form, footer

CRITICAL: Put the ENTIRE HTML in the "html" field of output_html. Do NOT just put the path. Do NOT stream it as text first.
DO NOT attempt npm install, git push, or running a server.` : ''

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
        cwd: (cwd || home).replace(/^~\//, home + '/').replace(/^~$/, home),
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

    } else if (name === 'output_html') {
      const { writeFileSync, mkdirSync } = await import('fs')
      const { dirname } = await import('path')
      const htmlContent = input.html
      if (!htmlContent) {
        return `Error: output_html was called without the html content. The "html" field MUST contain the complete HTML document. Call output_html again with both path AND html fields populated.`
      }
      const resolvedPath = input.path.replace(/^~\//, home + '/').replace(/^~$/, home)
      send(`\n\n📄 **Generating website** \`${input.path}\` (${htmlContent.length} chars)`)
      try {
        mkdirSync(dirname(resolvedPath), { recursive: true })
        writeFileSync(resolvedPath, htmlContent, 'utf8')
        send(`\n\n✅ Website written: ${input.path}`)
        const escaped = Buffer.from(htmlContent).toString('base64')
        send(`\n\n<!--PREVIEW_HTML:${escaped}-->`)
        send(`\n\n<!--FILE_ENTRY:${JSON.stringify({ path: input.path, content: htmlContent.slice(0, 2400) })}-->`)
        return `HTML website written to ${input.path} (${htmlContent.length} chars). Preview will display automatically.`
      } catch (err) {
        send(`\n\n❌ ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'write_document' || name === 'write_file') {
      const { writeFileSync, mkdirSync } = await import('fs')
      const { dirname } = await import('path')
      // Always resolve ~ to the writable home dir (which is /tmp on Vercel)
      const resolvedPath = input.path.replace(/^~\//, home + '/').replace(/^~$/, home)
      if (!input.content) {
        return `Error: write_file was called without content. You MUST include the full file content in the "content" parameter. Call write_file again with both path AND content.`
      }
      send(`\n\n📄 **Writing** \`${input.path}\` (${(input.content || '').length} chars)`)
      try {
        mkdirSync(dirname(resolvedPath), { recursive: true })
        writeFileSync(resolvedPath, input.content, 'utf8')
        send(`\n\n✅ Written: ${input.path}`)
        // If this is an HTML file, emit a preview marker
        if (input.path.endsWith('.html') && input.content) {
          const escaped = Buffer.from(input.content).toString('base64')
          send(`\n\n<!--PREVIEW_HTML:${escaped}-->`)
        }
        send(`\n\n<!--FILE_ENTRY:${JSON.stringify({ path: input.path, content: (input.content || '').slice(0, 2400) })}-->`)
        return `Written: ${input.path} (${input.content.length} chars)`
      } catch (err) {
        send(`\n\n❌ ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'run_bash') {
      const cmd = input.command
      const cwd = input.cwd ? input.cwd.replace(/^~\//, home + '/').replace(/^~$/, home) : home
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
          // For top agents (CTO/manager), force tool call for first 5 iters; thinking enabled after.
          // For implementers (Backend Programmer etc.), ALWAYS disable thinking:
          //   - Implementers just write code/HTML — thinking wastes max_tokens budget
          //   - With thinking=8000 + max_tokens=16000, only 8000 tokens remain for HTML → truncated tool call → content=undefined
          const forceToolCall = isTopAgent && iter < 5
          const toolChoice = forceToolCall ? { type: 'any' } : { type: 'auto' }
          const thinkingConfig = (!isTopAgent || forceToolCall)
            ? { type: 'disabled' }
            : { type: 'enabled', budget_tokens: 32000 }

          // Max output tokens: claude-opus-4-6 supports up to 128K output
          const maxTokens = 128000

          const apiStream = anthropic.messages.stream({
            model: 'claude-opus-4-6',
            max_tokens: maxTokens,
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

          // Context compaction: if history is growing large, keep only first message + last 8 pairs
          // This prevents ballooning token costs across 20 iterations
          if (loopMessages.length > 18) {
            const firstMsg = loopMessages[0]
            loopMessages = [firstMsg, ...loopMessages.slice(-16)]
          }

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
