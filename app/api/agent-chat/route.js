import { anthropic } from '@/lib/claude'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
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

  // Single-user workspace — always Svet. Auth wall removed.
  const userId = 'svet'

  const isCTO = /cto|chief\s*tech/i.test(agent.role || '') || /cto/i.test(agent.label || '')
  const isTopAgent = (agent.level === 0 || agent.level === '0' || isCTO) && agent.id !== 'rules'
  const isUIAgent = /ui\s*agent|design|ux|front.?end/i.test(agent.role || '') || /ui\s*agent/i.test(agent.label || '')
  const agentId = agent.id || agent.label

  // ── Load profile, memories, projects, skills from Supabase ───────────────
  let soulMd = ''
  let agentsMd = ''
  let memoriesPrompt = ''
  let skillTools = []
  let skillInstructions = ''

  try {
    const svc = createServiceClient()

    // Load persistent agent profile (SOUL.md + AGENTS.md)
    const { data: profile } = await svc
      .from('agent_profiles')
      .select('soul_md, agents_md')
      .eq('user_id', userId)
      .eq('agent_id', agentId)
      .maybeSingle()
    if (profile?.soul_md) soulMd = profile.soul_md
    if (profile?.agents_md) agentsMd = profile.agents_md

    // Load top 20 memories (highest importance + most recent)
    const { data: memories } = await svc
      .from('agent_memories')
      .select('content, type, importance')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)

    // Load 10 most recent projects
    const { data: projects } = await svc
      .from('projects')
      .select('name, description, live_url, github_repo, tech_stack, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(10)

    const memLines = memories?.length
      ? memories.map(m => `[${m.type}] ${m.content}`)
      : []

    const projLines = projects?.length
      ? projects.map(p => [
          `• ${p.name}`,
          p.description ? `  ${p.description}` : '',
          p.live_url ? `  Live: ${p.live_url}` : '',
          p.github_repo ? `  Repo: ${p.github_repo}` : '',
          p.tech_stack ? `  Stack: ${p.tech_stack}` : '',
          p.notes ? `  Notes: ${p.notes}` : '',
        ].filter(Boolean).join('\n'))
      : []

    if (memLines.length || projLines.length) {
      memoriesPrompt = [
        memLines.length ? `## Long-term Memory\n${memLines.join('\n')}` : '',
        projLines.length ? `## Past Projects (${projects.length})\n${projLines.join('\n\n')}` : '',
      ].filter(Boolean).join('\n\n')
    }

    // Load skills assigned to this agent
    const { data: agentSkillRows } = await svc
      .from('agent_skills')
      .select('skills(id, slug, name, description, tool_definition, instructions)')
      .eq('user_id', userId)
      .eq('agent_id', agentId)

    if (agentSkillRows?.length) {
      for (const row of agentSkillRows) {
        if (row.skills?.tool_definition) skillTools.push({ ...row.skills.tool_definition, _skill_id: row.skills.id, _skill_slug: row.skills.slug })
        if (row.skills?.instructions) skillInstructions += `\n\n### Skill: ${row.skills.name}\n${row.skills.instructions}`
      }
    }
  } catch {}

  const teamRoster = orgContext?.nodes
    ?.filter(n => n.id !== 'rules' && n.id !== (agent.id || agent.label))
    ?.map(n => `  - "${n.label}" (id: "${n.id}") — ${n.role}: ${n.description?.split('\n')[0] || ''}`)
    ?.join('\n') || ''

  // ── Tool definitions ──────────────────────────────────────────────────────
  // message_agent: OpenClaw sessions_send equivalent — direct synchronous A2A messaging
  // Any agent can send a direct message to any other agent and get a reply (up to maxTurns ping-pong)
  const messageAgentTool = {
    name: 'message_agent',
    description: `Send a direct message to another agent and receive their reply. Use this for peer-to-peer consultation, getting a second opinion, or coordinating with a specialist without fully delegating a task.\n\nSupports up to 5 back-and-forth turns.\n\nYour team:\n${teamRoster || '(no team members)'}`,
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Agent label or id to message (e.g. "UI Agent", "Backend Programmer")' },
        message: { type: 'string', description: 'Your message to the agent' },
        maxTurns: { type: 'integer', minimum: 1, maximum: 5, description: 'Max ping-pong turns (default 1, max 5). Use >1 for back-and-forth dialogue.' },
      },
      required: ['to', 'message'],
    },
  }

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
    // ── Browser tools (Option B: dedicated pre-built actions, persistent session) ──
    {
      name: 'browser_navigate',
      description: 'Open a URL in the browser. The session persists — the page stays open for follow-up clicks, reads, or screenshots. Always returns a screenshot of the loaded page.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to navigate to (e.g. https://example.com)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current browser page. Use after navigating, clicking, or filling to visually verify the result.',
      input_schema: {
        type: 'object',
        properties: {
          fullPage: { type: 'boolean', description: 'Capture the full scrollable page (default false = visible viewport only)' },
        },
        required: [],
      },
    },
    {
      name: 'browser_click',
      description: 'Click an element on the current page. Pass a CSS selector (e.g. "#submit-btn", "button.primary") or visible text (e.g. "Sign in"). Always returns a screenshot after clicking.',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector or visible text of the element to click' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'browser_fill',
      description: 'Type text into an input field on the current page. Use a CSS selector to identify the field (e.g. "input[name=email]", "#search").',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the input field' },
          value: { type: 'string', description: 'Text to type into the field' },
        },
        required: ['selector', 'value'],
      },
    },
    {
      name: 'browser_read',
      description: 'Read the visible text content of the current page or a specific element. Use to extract data, verify content, or check what is on screen.',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to read from (default: entire page body)' },
        },
        required: [],
      },
    },
    {
      name: 'browser_close',
      description: 'Close the browser session and free memory. Call this when you are done with all browser tasks.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
  ]

  // ── Cross-agent tools (available to everyone) ─────────────────────────────
  const rememberTool = {
    name: 'remember',
    description: 'Save an important fact, preference, goal, or context to long-term memory. This persists across all future conversations. Call this after learning something critical about the user, project, or decisions made.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or insight to remember' },
        type: { type: 'string', enum: ['fact', 'preference', 'goal', 'context'], description: 'Category of memory' },
        importance: { type: 'integer', minimum: 1, maximum: 5, description: '1=minor detail, 3=normal, 5=critical must-know' },
      },
      required: ['content'],
    },
  }

  const recallLogTool = {
    name: 'recall_log',
    description: 'Read your activity log for a past date to remember what you worked on.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Defaults to today.' },
      },
      required: [],
    },
  }

  const saveProjectTool = {
    name: 'save_project',
    description: 'Save a completed project to the workspace memory. Call this immediately after deploying something or completing a major milestone. It persists across all future sessions.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short project name (e.g. "Landing Page for AcmeCo")' },
        description: { type: 'string', description: 'What this project does in 1-2 sentences' },
        live_url: { type: 'string', description: 'Live URL if deployed (e.g. https://acmeco.vercel.app)' },
        github_repo: { type: 'string', description: 'GitHub repo URL if pushed' },
        tech_stack: { type: 'string', description: 'Technologies used (e.g. "Next.js, Supabase, Vercel")' },
        notes: { type: 'string', description: 'Any important notes for future reference' },
      },
      required: ['name'],
    },
  }

  const baseTools = isTopAgent ? managerTools : implementerTools
  const tools = [...baseTools, messageAgentTool, rememberTool, recallLogTool, saveProjectTool, ...skillTools]

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
1. Search online for the answer yourself (use read_files to check existing files, delegate browser_navigate + browser_screenshot to UI Agent to capture competitor screenshots)
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

STEP 2 — Delegate to UI Agent to research competitors (optional but recommended)
Call delegate_task to the UI Agent and tell them to use browser_navigate + browser_screenshot to capture 2-3 competitor screenshots for inspiration.
The UI Agent has these browser tools available: browser_navigate, browser_screenshot, browser_click, browser_fill, browser_read, browser_close.

STEP 3 — Delegate to Backend Programmer immediately
Once you have enough context (from VISION.md and optional UI research), call delegate_task to the Backend Programmer.
Tell them to generate a complete single-file static HTML website using write_file to ~/st-properties/index.html.
Do NOT wait for user confirmation. Do NOT say "does this sound good?". Just delegate.

STEP 4 — Report results
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
2. Use browser_navigate to go to a competitor's website, then browser_screenshot to capture it. Repeat for 2-3 competitors.
3. Use browser_read to extract pricing, features, or copy if needed.
4. Always call browser_close when done.
5. Design in full detail: layout, colors, typography, components, states, edge cases
6. Present design + competitor screenshots with specific comparisons
7. Write precise specs for Backend Programmer (exact CSS, component structure, API shape)
8. Never contact the user — report to CTO
9. After implementation: browser_navigate to the live URL, browser_screenshot to verify, compare against design, report gaps` : ''

  const hasExecServer = !!process.env.EXECUTION_SERVER_URL
  const implementerInstructions = !isTopAgent ? (hasExecServer ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have FULL access to a persistent execution server with pre-authorized credentials.
- Use run_bash freely: npm install, git clone, git push, npx create-next-app, vercel deploy — all work
- Use write_file to create source files, then run_bash to install deps and deploy
- NEVER contact the user directly — report results back to the CTO
- Keep going until the task is FULLY complete — do not stop after one step
- Working directory: ~/workspace (persists between commands)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRE-AUTHORIZED CREDENTIALS (already configured, just use them)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- GitHub (svettypoo): git push/clone work directly, no login needed
- Vercel CLI: run "vercel --prod --yes" to deploy, no login needed
- Supabase CLI: run "supabase ..." with SUPABASE_ACCESS_TOKEN env var available
- Anthropic API: ANTHROPIC_API_KEY env var available
- Resend email: RESEND_API_KEY env var available — use to send transactional email
- Telnyx SMS: TELNYX_API_KEY env var available — use to send SMS/make calls
- Supabase DB: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars available
- Railway CLI: RAILWAY_TOKEN env var available

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPLOYMENT WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To deploy a real app:
1. run_bash: mkdir ~/workspace/[project] && cd ~/workspace/[project] && npm init -y (or npx create-next-app)
2. write_file: write source files into ~/workspace/[project]/
3. run_bash: cd ~/workspace/[project] && npm install && npm run build (if needed)
4. run_bash: cd ~/workspace/[project] && vercel --prod --yes (deploys to Vercel, returns live URL)
5. Report the live URL back to CTO

You can also: git clone repos, push code to GitHub, run tests, set up databases, send emails via Resend, send SMS via Telnyx.
Always use write_file for large file content, then run_bash for commands.` : `
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
DO NOT attempt npm install, git push, or running a server.`) : ''

  // OpenClaw context assembly order: SOUL.md → AGENTS.md → role/workflow → skills → org → memories
  const systemPrompt = [
    // 1. SOUL.md — personality, values, communication style (injected first like OpenClaw)
    soulMd
      ? `## Soul\n${soulMd}`
      : `You are ${agent.label}.`,

    // 2. AGENTS.md — operational instructions override (if user has customized this agent)
    agentsMd
      ? `## Instructions\n${agentsMd}`
      : `Role: ${agent.role}\n\n${agent.description}`,

    // 3. Built-in workflow instructions (CTO / UI agent / implementer)
    ctoWorkflow || uiWorkflow || implementerInstructions || '',

    // 4. Skills instructions
    skillInstructions || '',

    // 5. Global rules
    globalRules || '',

    // 6. Org context
    `## Team\n${orgContext ? JSON.stringify(orgContext.nodes?.map(n => ({ id: n.id, label: n.label, role: n.role, level: n.level })), null, 2) : 'Standalone agent.'}`,

    // 7. Long-term memories (injected last so they're closest to the conversation)
    memoriesPrompt || '',

    // 8. Autonomy directive
    `You are fully autonomous. Be direct and decisive. No hedging, no asking for permission.
Use remember to save important facts. Use save_project after every deployment (name, live_url, github_repo). Use recall_log to review past work.
Use message_agent to consult a peer directly. Use delegate_task to assign implementation work.`,
  ].filter(Boolean).join('\n\n')

  // ── Bash runner ───────────────────────────────────────────────────────────
  // If EXECUTION_SERVER_URL is set, forward bash commands to the persistent execution server.
  // Otherwise fall back to local spawn (works in local dev, limited on Vercel serverless).
  const EXEC_SERVER_URL = process.env.EXECUTION_SERVER_URL
  const EXEC_TOKEN = process.env.EXEC_TOKEN || ''

  async function runBash(command, cwd) {
    if (EXEC_SERVER_URL) {
      // Forward to execution server — has npm, git, vercel CLI, etc.
      const cwdResolved = (cwd || home).replace(/^~\//, home + '/').replace(/^~$/, home)
      const res = await fetch(`${EXEC_SERVER_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EXEC_TOKEN}` },
        body: JSON.stringify({ command, cwd: cwdResolved, timeout: 120000 }),
      })
      if (!res.ok) {
        const txt = await res.text()
        return { stdout: '', stderr: txt, exitCode: 1 }
      }
      // Collect streamed output
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let output = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        output += decoder.decode(value, { stream: true })
      }
      // Parse exit code from "[exit: N]" suffix
      const exitMatch = output.match(/\[exit:\s*(\d+)\]$/)
      const exitCode = exitMatch ? parseInt(exitMatch[1]) : 0
      const stdout = exitMatch ? output.slice(0, -exitMatch[0].length).trim() : output
      return { stdout, stderr: '', exitCode }
    }

    // Local fallback
    const { existsSync } = await import('fs')
    const BASH = [
      process.env.SHELL,
      'C:\\Users\\pargo_pxnd4wa\\scoop\\apps\\git\\current\\bin\\bash.exe',
      '/bin/bash',
      'bash',
    ].find(p => p && (p === 'bash' || existsSync(p))) || 'bash'

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
        // Mirror to Railway execution server so sub-agents can read it via bash
        if (EXEC_SERVER_URL) {
          fetch(`${EXEC_SERVER_URL}/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EXEC_TOKEN}` },
            body: JSON.stringify({ path: input.path, content: input.content }),
          }).catch(() => {})
        }
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

    } else if (['browser_navigate', 'browser_screenshot', 'browser_click', 'browser_fill', 'browser_read', 'browser_close'].includes(name)) {
      const execUrl = process.env.EXECUTION_SERVER_URL
      if (!execUrl) {
        return 'Browser tools require EXECUTION_SERVER_URL to be configured.'
      }
      const execToken = process.env.EXEC_TOKEN || 'svets-exec-token-2026'

      // Map tool name → browser action
      const action = name.replace('browser_', '')
      const labels = {
        navigate: `Navigating to ${input.url}`,
        screenshot: 'Taking screenshot',
        click: `Clicking "${input.selector}"`,
        fill: `Filling "${input.selector}" with "${input.value?.slice(0, 40)}"`,
        read: `Reading page content`,
        close: 'Closing browser session',
      }
      send(`\n\n🌐 **Browser:** ${labels[action]}...`)

      try {
        const res = await fetch(`${execUrl}/browser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${execToken}` },
          body: JSON.stringify({ action, sessionId: agentId, ...input }),
        })
        const result = await res.json()

        if (!result.ok) {
          send(`\n\n❌ **Browser Error:** ${result.error}`)
          return `Error: ${result.error}`
        }

        let out = ''
        if (result.title || result.url) {
          out += `Page: ${result.title || ''} — ${result.url || ''}\n`
        }
        if (result.text) {
          send(`\n\n**Page Content:**\n\`\`\`\n${result.text.slice(0, 2000)}\n\`\`\``)
          out += result.text
        }
        if (result.message) {
          send(`\n\n✅ ${result.message}`)
          out += result.message
        }
        if (result.screenshot) {
          // Render as inline base64 image
          const dataUrl = `data:image/png;base64,${result.screenshot}`
          send(`\n\n![screenshot](${dataUrl})`)
          out += '\nScreenshot captured.'
        }
        return out || 'Browser action completed.'
      } catch (err) {
        send(`\n\n❌ **Browser Error:** ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'message_agent') {
      // OpenClaw sessions_send equivalent — direct synchronous peer-to-peer messaging
      if (_delegationDepth >= MAX_DELEGATION_DEPTH) {
        return 'Message blocked: max agent depth reached.'
      }

      const targetAgent = orgContext?.nodes?.find(n =>
        n.id === input.to ||
        n.id?.toLowerCase() === input.to?.toLowerCase() ||
        n.label?.toLowerCase() === input.to?.toLowerCase() ||
        n.label?.toLowerCase().includes(input.to?.toLowerCase())
      )
      if (!targetAgent) return `Agent "${input.to}" not found. Available: ${teamRoster}`

      const maxTurns = Math.min(input.maxTurns || 1, 5)
      send(`\n\n💬 **${agent.label} → ${targetAgent.label}:** ${input.message.slice(0, 120)}${input.message.length > 120 ? '...' : ''}`)
      send(`\n<!--agent-active:${targetAgent.id}-->`)

      let pingPongMessages = [{ role: 'user', content: input.message }]
      let lastReply = ''

      for (let turn = 0; turn < maxTurns; turn++) {
        try {
          const res = await fetch(`${origin}/api/agent-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
              agent: targetAgent,
              messages: pingPongMessages,
              orgContext,
              rules,
              _delegationDepth: _delegationDepth + 1,
            }),
          })
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let replyText = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            replyText += chunk
            send(chunk)
          }
          lastReply = replyText.replace(/<!--[^>]*-->/g, '').trim()

          // For multi-turn: add reply and prompt next turn only if caller has more to say
          if (turn < maxTurns - 1 && lastReply) {
            pingPongMessages.push({ role: 'assistant', content: lastReply })
            // Multi-turn stops unless there's a follow-up — just one turn by default
            break
          }
        } catch (err) {
          send(`\n\n❌ Message error: ${err.message}`)
          lastReply = `Error: ${err.message}`
          break
        }
      }

      send(`\n<!--agent-idle:${targetAgent.id}-->`)
      return lastReply.slice(0, 5000) || 'No reply.'

    } else if (name === 'remember') {
      try {
        const svc = createServiceClient()
        await svc.from('agent_memories').insert({
          user_id: userId,
          agent_id: agentId,
          content: input.content,
          type: input.type || 'fact',
          importance: input.importance || 3,
        })
        send(`\n\n🧠 **Remembered:** ${input.content.slice(0, 120)}`)
        return `Saved to long-term memory: "${input.content.slice(0, 120)}"`
      } catch (err) {
        return `Error saving memory: ${err.message}`
      }

    } else if (name === 'save_project') {
      try {
        const svc = createServiceClient()
        const row = {
          name: input.name,
          description: input.description || null,
          live_url: input.live_url || null,
          github_repo: input.github_repo || null,
          tech_stack: input.tech_stack || null,
          notes: input.notes || null,
        }
        await svc.from('projects').insert(row)
        const summary = [input.name, input.live_url, input.github_repo].filter(Boolean).join(' | ')
        send(`\n\n📁 **Project saved:** ${summary}`)
        return `Project "${input.name}" saved to workspace memory.`
      } catch (err) {
        return `Error saving project: ${err.message}`
      }

    } else if (name === 'recall_log') {
      try {
        const svc = createServiceClient()
        const date = input.date || new Date().toISOString().slice(0, 10)
        const { data } = await svc.from('agent_logs')
          .select('content')
          .eq('user_id', userId)
          .eq('agent_id', agentId)
          .eq('date', date)
          .maybeSingle()
        return data?.content || `No activity log found for ${date}.`
      } catch (err) {
        return `Error: ${err.message}`
      }

    } else if (skillTools.some(t => t.name === name)) {
      // Dynamic skill execution
      const skill = skillTools.find(t => t.name === name)
      send(`\n\n⚡ **Skill:** ${skill?.description?.slice(0, 80) || name}...`)
      try {
        const svc = createServiceClient()
        const { data: skillData } = await svc.from('skills').select('api_calls, env_vars').eq('id', skill._skill_id).maybeSingle()
        if (!skillData?.api_calls?.length) return `Skill "${name}" has no API calls configured.`

        const { data: keys } = await svc.from('user_api_keys').select('service, key_encrypted').eq('user_id', userId)
        const keyMap = {}
        if (keys) for (const k of keys) keyMap[k.service] = k.key_encrypted

        let results = []
        for (const call of skillData.api_calls) {
          let url = call.url || ''
          let headers = { ...(call.headers || {}) }
          let body = call.body ? JSON.stringify(call.body) : undefined

          // Substitute env vars from user's stored keys
          const envVarNames = Object.keys(skillData.env_vars || {})
          for (const varName of envVarNames) {
            const keyVal = keyMap[varName.toLowerCase()] || process.env[varName] || ''
            const re = new RegExp(`\\{\\{${varName}\\}\\}`, 'g')
            url = url.replace(re, keyVal)
            if (body) body = body.replace(re, keyVal)
            for (const h of Object.keys(headers)) headers[h] = headers[h].replace(re, keyVal)
          }

          // Substitute input params
          for (const [k, v] of Object.entries(input)) {
            const re = new RegExp(`\\{\\{${k}\\}\\}`, 'g')
            url = url.replace(re, v)
            if (body) body = body.replace(re, String(v))
          }

          const res = await fetch(url, {
            method: call.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...headers },
            body,
          })
          const text = await res.text()
          results.push(`${call.method || 'GET'} ${url.slice(0, 60)} → ${res.status}: ${text.slice(0, 500)}`)
        }
        const out = results.join('\n\n')
        send(`\n\n**Result:**\n\`\`\`\n${out.slice(0, 2000)}\n\`\`\``)
        return out.slice(0, 3000)
      } catch (err) {
        send(`\n\n❌ Skill error: ${err.message}`)
        return `Error: ${err.message}`
      }
    }

    return `Unknown tool: ${name}`
  }

  // ── Append to daily activity log ───────────────────────────────────────────
  async function appendToLog(entry) {
    if (!userId) return
    try {
      const svc = createServiceClient()
      const date = new Date().toISOString().slice(0, 10)
      const timestamp = new Date().toISOString().slice(11, 19)
      const line = `[${timestamp}] ${entry}`
      const { data: existing } = await svc.from('agent_logs')
        .select('id, content')
        .eq('user_id', userId)
        .eq('agent_id', agentId)
        .eq('date', date)
        .maybeSingle()
      if (existing) {
        await svc.from('agent_logs').update({ content: existing.content + '\n' + line, updated_at: new Date().toISOString() }).eq('id', existing.id)
      } else {
        await svc.from('agent_logs').insert({ user_id: userId, agent_id: agentId, date, content: line })
      }
    } catch {}
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
          // For implementers (Backend Programmer etc.), ALWAYS disable thinking by default:
          //   - Implementers just write code/HTML — thinking wastes max_tokens budget
          //   - With thinking=8000 + max_tokens=16000, only 8000 tokens remain for HTML → truncated tool call
          const forceToolCall = isTopAgent && iter < 5
          const toolChoice = forceToolCall ? { type: 'any' } : { type: 'auto' }

          // Phase 5: Adaptive thinking — use per-agent thinking_depth if set
          const thinkingDepth = agent.thinking_depth || (isTopAgent ? 'high' : 'off')
          function resolveThinking(depth, forceOff) {
            if (forceOff) return { type: 'disabled' }
            const lastMsg = loopMessages[loopMessages.length - 1]
            const msgLen = typeof lastMsg?.content === 'string' ? lastMsg.content.length : 0
            switch (depth) {
              case 'off': return { type: 'disabled' }
              case 'low': return { type: 'enabled', effort: 'low' }
              case 'high': return { type: 'enabled', effort: 'high' }
              case 'adaptive': return msgLen > 500 ? { type: 'enabled', effort: 'high' } : { type: 'disabled' }
              default: return isTopAgent ? { type: 'enabled', effort: 'high' } : { type: 'disabled' }
            }
          }
          const thinkingConfig = resolveThinking(thinkingDepth, forceToolCall)

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

          // Append to daily log
          const userMsg = messages[messages.length - 1]?.content?.slice(0, 200) || 'task'
          await appendToLog(`${agent.label} handled: "${userMsg}" (${totalInputTokens}in/${totalOutputTokens}out tokens)`).catch(() => {})
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
