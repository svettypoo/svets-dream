import { anthropic } from '@/lib/claude'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { checkBudget, recordTransaction } from '@/lib/spend-tracker'
import { spawn } from 'child_process'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 min — Vercel Pro limit for long agent chains
const MAX_ITERATIONS = 20
const MAX_DELEGATION_DEPTH = 2

// ── Features registry cache (1hr TTL) ─────────────────────────────────────
// Reads features.md from Railway workspace — synced hourly by sync-features.js
let _featuresCache = { content: '', fetchedAt: 0 }
async function getFeatures() {
  const now = Date.now()
  if (_featuresCache.content && now - _featuresCache.fetchedAt < 3_600_000) return _featuresCache.content
  try {
    const execUrl = process.env.EXECUTION_SERVER_URL
    const execToken = process.env.EXEC_TOKEN || 'svets-exec-token-2026'
    if (!execUrl) return ''
    const res = await fetch(`${execUrl}/read?path=/root/workspace/features.md`, {
      headers: { Authorization: `Bearer ${execToken}` },
    })
    if (!res.ok) return ''
    const content = await res.text()
    _featuresCache = { content: content.slice(0, 12000), fetchedAt: now }
    return _featuresCache.content
  } catch { return '' }
}

export async function POST(req) {
  const { agent, messages, orgContext, rules, _delegationDepth = 0, workspaceId, quickMode, tokenBudget } = await req.json()
  const featuresContext = await getFeatures()

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

  // Per-conversation isolated workspace. Falls back to global home if no workspaceId supplied.
  // On Vercel only /tmp is writable. On Railway /root is writable. Never use /root on Vercel.
  const wsRoot = isVercel ? '/tmp' : '/root'
  const wsHome = workspaceId ? `${wsRoot}/workspace/${workspaceId}` : home
  // Ensure workspace exists locally and is a git repo (fire-and-forget)
  if (workspaceId) {
    import('fs').then(({ mkdirSync }) => {
      mkdirSync(wsHome, { recursive: true })
    }).catch(() => {})
    spawn(process.platform === 'win32' ? 'bash' : '/bin/bash', ['-c',
      `git -C "${wsHome}" rev-parse --git-dir 2>/dev/null || (git init -q "${wsHome}" && git -C "${wsHome}" config user.email "agents@svets-dream.app" && git -C "${wsHome}" config user.name "Svet's Dream Agent")`
    ], { stdio: 'ignore' }).unref()
  }

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
          tokenBudget: { type: 'integer', description: 'Optional max tokens this sub-agent may spend. Exceeded budget triggers a warning. Default: unlimited.' },
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
    {
      name: 'read_file',
      description: 'Read the contents of a file from your workspace.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (e.g. ~/myproject/index.html)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_dir',
      description: 'List files in a workspace directory.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (defaults to workspace root ~/)' },
        },
      },
    },
    {
      name: 'fetch_url',
      description: 'Fetch any URL and return its content. Use to read documentation, check npm packages, inspect deployed sites, or call any HTTP API.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to fetch' },
          format: { type: 'string', enum: ['text', 'json', 'raw'], description: 'text = HTML stripped to readable text (default), json = parsed JSON, raw = full response' },
        },
        required: ['url'],
      },
    },
    {
      name: 'web_search',
      description: 'Search the web for any topic. Returns results with titles, URLs, and summaries. Use to find docs, research competitors, look up APIs, check error messages.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'grep_files',
      description: 'Search file contents for a string or pattern (like grep -r). Returns matching lines with file paths and line numbers.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search string or regex pattern' },
          path: { type: 'string', description: 'Directory to search (default: workspace root)' },
          glob: { type: 'string', description: 'File type filter (e.g. "*.js", "*.tsx")' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'glob_files',
      description: 'Find files by name pattern (like find). Returns a list of matching file paths.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.tsx", "src/**/*.js", "*.json")' },
          path: { type: 'string', description: 'Directory to search (default: workspace root)' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'delegate_parallel',
      description: `Run 2–4 independent tasks simultaneously across different agents. Use when tasks don't depend on each other — it's faster than sequential delegation.\n\nYour team:\n${teamRoster || '(no team members)'}`,
      input_schema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Tasks to run in parallel (2–4). Each must be fully self-contained.',
            items: {
              type: 'object',
              properties: {
                to: { type: 'string', description: 'Agent label or id to assign to' },
                task: { type: 'string', description: 'Complete task description for this agent' },
              },
              required: ['to', 'task'],
            },
            minItems: 2,
            maxItems: 4,
          },
        },
        required: ['tasks'],
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
      name: 'read_file',
      description: 'Read the contents of a file from your workspace. Use this: (1) before editing existing files to understand what\'s there, (2) after writing to verify correctness, (3) when debugging to inspect current state.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (e.g. ~/myproject/index.html or ~/workspace/app.js)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_dir',
      description: 'List files and directories in your workspace. Use at the start to see what already exists before writing new files.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (defaults to workspace root ~/)' },
        },
      },
    },
    {
      name: 'edit_file',
      description: 'Edit a file by replacing an exact string with a new string. More precise and safer than write_file for targeted changes — use this instead of rewriting the whole file. Always use read_file first to confirm the exact text.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (e.g. ~/myproject/app.js)' },
          old_string: { type: 'string', description: 'Exact string to find and replace (must match exactly, including all whitespace and newlines)' },
          new_string: { type: 'string', description: 'Replacement string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'fetch_url',
      description: 'Fetch any URL and return its content. Use to read documentation, check npm package docs, inspect deployed sites, or call any HTTP API.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to fetch' },
          format: { type: 'string', enum: ['text', 'json', 'raw'], description: 'text = HTML stripped to readable text (default), json = parsed JSON, raw = full response' },
        },
        required: ['url'],
      },
    },
    {
      name: 'web_search',
      description: 'Search the web for any topic. Returns results with titles, URLs, and summaries. Use to look up docs, find npm packages, research solutions, check error messages.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'grep_files',
      description: 'Search file contents for a string or pattern. Returns matching lines with file paths and line numbers.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search string or regex pattern' },
          path: { type: 'string', description: 'Directory to search (default: workspace root)' },
          glob: { type: 'string', description: 'File type filter (e.g. "*.js", "*.tsx")' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'glob_files',
      description: 'Find files matching a name pattern.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.tsx", "*.json")' },
          path: { type: 'string', description: 'Directory to search (default: workspace root)' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'deploy',
      description: 'Deploy the workspace project to Vercel or Railway with a single call. Handles the full deploy command automatically.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['vercel', 'railway'], description: 'Target platform' },
          project_name: { type: 'string', description: 'Project name (used for first-time Vercel deployments)' },
        },
        required: ['platform'],
      },
    },
    {
      name: 'git_commit',
      description: 'Save a checkpoint of all work done so far. Call this after completing a significant piece of work (a full feature, a working page, a passing test). This commits all files to the workspace git repo so progress is never lost.',
      input_schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Short description of what was built or changed (e.g. "Add hero section and contact form")' },
        },
        required: ['message'],
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
    {
      name: 'send_email',
      description: 'Send a transactional email via Resend. Use to notify users, send reports, deliver results, or alert on events.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          html: { type: 'string', description: 'HTML body of the email' },
          from: { type: 'string', description: 'Sender address (default: noreply@birthdayboard.email)' },
        },
        required: ['to', 'subject', 'html'],
      },
    },
    {
      name: 'send_sms',
      description: 'Send an SMS message via Telnyx to any phone number. Use to alert, notify, or communicate with users.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number in E.164 format (e.g. +14155551234)' },
          message: { type: 'string', description: 'SMS message text (max 160 chars for single segment)' },
        },
        required: ['to', 'message'],
      },
    },
    {
      name: 'query_db',
      description: 'Query or write to the Supabase database directly. Run any SELECT, INSERT, UPDATE, or DELETE. Use for reading data, checking state, or persisting results.',
      input_schema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL query to execute (SELECT, INSERT, UPDATE, DELETE)' },
          params: { type: 'array', description: 'Optional parameterized query values', items: { type: 'string' } },
        },
        required: ['sql'],
      },
    },
    {
      name: 'screenshot_url',
      description: 'Navigate to any URL and take a screenshot in one step. The screenshot renders inline in the chat. Use this to verify a deployed site, check a competitor, or confirm a UI change. Faster than browser_navigate + browser_screenshot separately.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to screenshot (e.g. https://myapp.vercel.app)' },
          fullPage: { type: 'boolean', description: 'Capture full scrollable page vs viewport only (default false)' },
        },
        required: ['url'],
      },
    },
  ]

  // ── Task management tools (OpenClaw-style — every request is a task) ────────
  const taskWriteTool = {
    name: 'task_write',
    description: `Create a new task or update an existing one. Use this for EVERY significant thing the user asks you to do — capture work as a task first, then execute it. Tasks can be anything: software builds, research, reminders, follow-ups, plans. This is how you track all work across sessions.`,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task UUID to update (omit to create new)' },
        title: { type: 'string', description: 'Short task title (e.g. "Build landing page for AcmeCo", "Research React alternatives")' },
        description: { type: 'string', description: 'Full details: what needs to be done, why, acceptance criteria' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'cancelled', 'waiting'], description: 'Task status (default: todo)' },
        priority: { type: 'integer', minimum: 1, maximum: 5, description: '1=someday, 2=low, 3=normal, 4=high, 5=urgent' },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Categories e.g. ["code","client","personal","research"]' },
        notes: { type: 'string', description: 'Progress notes, blockers, or next steps' },
      },
      required: ['title'],
    },
  }

  const taskListTool = {
    name: 'task_list',
    description: 'List current tasks. Call at the start of conversations to see what is pending. Returns tasks sorted by priority then recency.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'cancelled', 'waiting', 'active', 'all'], description: 'Filter: "active" = todo+in_progress (default), "all" = everything' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max tasks to return (default 20)' },
        tag: { type: 'string', description: 'Filter by tag (e.g. "code", "personal")' },
      },
    },
  }

  const taskUpdateTool = {
    name: 'task_update',
    description: 'Update task status or append notes. Use after completing work or when status changes. Always mark tasks done when the work is finished.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task UUID to update' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'cancelled', 'waiting'] },
        notes: { type: 'string', description: 'Progress notes to append (added to existing notes)' },
        priority: { type: 'integer', minimum: 1, maximum: 5 },
      },
      required: ['id'],
    },
  }

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

  // ── OpenClaw feature tools ─────────────────────────────────────────────────
  const searchMemoryTool = {
    name: 'search_memory',
    description: 'Search your long-term memory by keyword. Returns memories whose text contains the search term. Use before starting work to surface relevant past context — e.g. search "color palette" to find saved brand colors, "deployment" to find past deploy URLs, "user preference" to find known preferences.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or phrase to find in memory (case-insensitive substring match)' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  }

  const blackboardReadTool = {
    name: 'blackboard_read',
    description: 'Read a shared value from the agent blackboard for this workspace run. The blackboard is a shared key-value store all agents in a run can read and write. Use to access findings from other agents (e.g. "brand_colors" set by UI Agent).',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to read (e.g. "brand_colors", "api_endpoint", "approved_design")' },
      },
      required: ['key'],
    },
  }

  const blackboardWriteTool = {
    name: 'blackboard_write',
    description: 'Write a shared value to the agent blackboard. Other agents in this workspace can read it with blackboard_read. Use to share research findings, design decisions, or intermediate state across the team.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to write (e.g. "brand_colors", "tech_stack", "deployment_url")' },
        value: { description: 'Value to store (any JSON: string, object, array, number)' },
      },
      required: ['key', 'value'],
    },
  }

  const requestApprovalTool = {
    name: 'request_approval',
    description: 'Pause and request a human decision before proceeding. Use when you reach a fork requiring user judgment: which of 2+ designs to build, whether to delete data, choosing a paid plan, or confirming a risky action. Execution pauses until the user responds.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The decision question to ask the user' },
        options: { type: 'array', items: { type: 'string' }, description: 'Optional list of choices (e.g. ["Option A", "Option B", "Cancel"])' },
        context: { type: 'string', description: 'Background info to help the user decide' },
      },
      required: ['question'],
    },
  }

  const structuredOutputTool = {
    name: 'structured_output',
    description: 'Emit a structured JSON result from your work. Use when the caller expects machine-readable output: a list of items, a config object, a color palette, analysis results, etc. The JSON will be captured and returned to whoever delegated this task.',
    input_schema: {
      type: 'object',
      properties: {
        schema_name: { type: 'string', description: 'Name describing the output type (e.g. "product_list", "color_palette", "site_analysis")' },
        data: { description: 'The structured data to emit (any JSON-serializable value)' },
      },
      required: ['schema_name', 'data'],
    },
  }

  // ── Workflow scheduling tool (OpenClaw cron) ──────────────────────────────
  const scheduleTaskTool = {
    name: 'schedule_task',
    description: `Schedule a recurring task to run automatically. Supports both interval-based ("every N minutes") and time-based cron expressions ("every Monday at 9am"). Use when the user wants something to happen repeatedly without them being present.

Examples:
- "remind me every morning at 9am" → cron_expr: "0 9 * * *", interval_minutes: 1440
- "check server every hour" → interval_minutes: 60
- "weekly summary every Monday at 8am" → cron_expr: "0 8 * * 1", interval_minutes: 10080
- "notify me at 6pm daily" → cron_expr: "0 18 * * *", interval_minutes: 1440

Always set notify_email or notify_phone so the output actually reaches the user.`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name for the workflow (e.g. "Morning task review")' },
        task: { type: 'string', description: 'The exact task instruction to run on schedule' },
        interval_minutes: { type: 'integer', minimum: 5, description: 'Fallback interval in minutes (60=hourly, 1440=daily, 10080=weekly)' },
        cron_expr: { type: 'string', description: 'Standard 5-field cron expression for time-based scheduling (e.g. "0 9 * * 1" = Monday 9am, "0 18 * * *" = daily 6pm)' },
        notify_email: { type: 'string', description: 'Email address to send the output to after each run' },
        notify_phone: { type: 'string', description: 'Phone number (E.164) to SMS the output to after each run' },
        notify_slack: { type: 'string', description: 'Slack webhook URL to post the output to after each run' },
        description: { type: 'string', description: 'Human-readable explanation of what this workflow does' },
      },
      required: ['name', 'task', 'interval_minutes'],
    },
  }

  // ── Slack notification tool ────────────────────────────────────────────────
  const slackNotifyTool = {
    name: 'slack_notify',
    description: 'Post a message to a Slack channel via webhook URL. Use to notify a team about deployments, task completions, errors, or any event. The webhook URL is provided by the user or stored in memory.',
    input_schema: {
      type: 'object',
      properties: {
        webhook_url: { type: 'string', description: 'Slack incoming webhook URL (e.g. https://hooks.slack.com/services/...)' },
        text: { type: 'string', description: 'Message text (supports Slack markdown: *bold*, _italic_, `code`, ```block```)' },
        username: { type: 'string', description: 'Display name for the bot (default: Svet\'s Dream)' },
        icon_emoji: { type: 'string', description: 'Emoji icon (e.g. ":robot_face:", ":white_check_mark:")' },
      },
      required: ['webhook_url', 'text'],
    },
  }

  // ── GitHub integration tool ────────────────────────────────────────────────
  const githubTool = {
    name: 'github_api',
    description: `Call the GitHub REST API. Use for: creating issues, PRs, comments; reading repo contents; searching code; checking CI status; listing branches/commits. Requires a GitHub token stored in memory (key: "github_token") or provided directly.

Common operations:
- List issues: GET /repos/{owner}/{repo}/issues
- Create issue: POST /repos/{owner}/{repo}/issues  body: {title, body, labels}
- Create PR: POST /repos/{owner}/{repo}/pulls  body: {title, body, head, base}
- Get file: GET /repos/{owner}/{repo}/contents/{path}
- Search code: GET /search/code?q={query}+repo:{owner}/{repo}
- List commits: GET /repos/{owner}/{repo}/commits`,
    input_schema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], description: 'HTTP method' },
        path: { type: 'string', description: 'GitHub API path (e.g. /repos/owner/repo/issues)' },
        body: { type: 'object', description: 'Request body for POST/PATCH/PUT' },
        token: { type: 'string', description: 'GitHub personal access token (if not stored in memory as "github_token")' },
      },
      required: ['method', 'path'],
    },
  }

  // ── Notion integration tool ────────────────────────────────────────────────
  const notionTool = {
    name: 'notion_api',
    description: `Call the Notion API to read and write pages, databases, and blocks. Requires a Notion integration token stored in memory (key: "notion_token") or provided directly.

Common operations:
- Search pages: POST /search  body: {query}
- Read page: GET /pages/{page_id}
- Read blocks: GET /blocks/{block_id}/children
- Append blocks: PATCH /blocks/{page_id}/children  body: {children: [...blocks]}
- Query database: POST /databases/{database_id}/query
- Create page: POST /pages  body: {parent, properties, children}`,
    input_schema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], description: 'HTTP method' },
        path: { type: 'string', description: 'Notion API path (e.g. /pages/{id}, /databases/{id}/query)' },
        body: { type: 'object', description: 'Request body' },
        token: { type: 'string', description: 'Notion integration token (if not stored in memory as "notion_token")' },
      },
      required: ['method', 'path'],
    },
  }

  const baseTools = isTopAgent ? managerTools : implementerTools
  const tools = [...baseTools, taskWriteTool, taskListTool, taskUpdateTool, scheduleTaskTool, slackNotifyTool, githubTool, notionTool, messageAgentTool, rememberTool, recallLogTool, saveProjectTool, searchMemoryTool, blackboardReadTool, blackboardWriteTool, requestApprovalTool, structuredOutputTool, ...skillTools]

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
STEP 1 — Choose a project folder name and write a vision document immediately
Pick a short slug for the project (e.g. "crm-app", "landing-page", "dashboard"). Use it everywhere.
Call write_document to write ~/[slug]/VISION.md with a complete vision: what it is, tech stack, target users, key pages/features, design direction.
Make confident decisions based on industry standards — do NOT ask for approval first.
Use web_search and fetch_url if you need to research the domain before writing.

STEP 2 — Delegate to UI Agent to research competitors (MANDATORY — do not skip)
Call delegate_task to the UI Agent BEFORE touching Backend Programmer.
Task them: "Research 2-3 competitors for [project type]. Use browser_navigate + browser_screenshot to capture their sites. Return: screenshots, color palette, layout patterns, typography, standout UI decisions. Then close the browser."
You MUST wait for the UI Agent result before Step 3. Skipping produces generic output.

STEP 3 — Delegate to Backend Programmer with the full brief
Only after UI Agent returns, call delegate_task to the Backend Programmer with:
- The project type and goal
- The slug/folder to use (~/[slug]/)
- UI Agent findings verbatim (colors, layout, patterns observed)
- Tech stack decision: for simple sites use a single index.html; for apps use Next.js or Node.js
- Tell them to use the blackboard_write tool to store the live URL when deployed
Do NOT wait for user confirmation. Do NOT say "does this sound good?". Just delegate.

STEP 4 — Report results to user
After Backend Programmer completes, tell the user: what was built, live URL, how to run it locally.
Pull the live URL from blackboard_read if the Backend Programmer wrote it there.

CRITICAL RULES:
- You MUST call delegate_task within the first 3 tool calls. No exceptions.
- You NEVER implement code yourself — always use delegate_task.
- NEVER ask the user for permission to proceed. Just proceed.
- NEVER say "shall I proceed?" or "does this sound good?" — just do it.
- request_approval is for genuine product decisions only (e.g. "deploy to Vercel or Railway?", "paid plan or free?") — not for technical choices you can make yourself.` : ''

  const uiWorkflow = isUIAgent ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR WORKFLOW AS UI AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Read the VISION.md the CTO wrote — check blackboard_read("vision_path") for the path, or list_dir ~/ and look for VISION.md files.
2. Use browser_navigate to go to a competitor's website, then browser_screenshot to capture it. Repeat for 2-3 competitors.
3. Use browser_read to extract pricing, features, or copy if needed.
4. Always call browser_close when done.
5. Write precise design specs: layout grid, exact colors (hex), font sizes, component hierarchy, hover states, mobile breakpoints.
6. Store your color palette finding with blackboard_write("brand_colors", {...}) so Backend Programmer can access it.
7. Present competitor screenshots with specific observations — not "clean look" but "uses 72px hero, white bg #FAFAFA, navy CTA #1B2A4A"
8. Never contact the user — report to CTO
9. After implementation: browser_navigate to the live URL, browser_screenshot to verify, compare against spec, report gaps.` : ''

  const hasExecServer = !!process.env.EXECUTION_SERVER_URL
  const userFacing = quickMode || false
  const implementerInstructions = !isTopAgent ? (hasExecServer ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have FULL access to a persistent execution server with pre-authorized credentials.
- Use list_dir first to see what already exists in your workspace before writing anything
- Use read_file before editing any existing file — understand it before changing it
- Use run_bash freely: npm install, git clone, git push, npx create-next-app — all work
- Use write_file to create source files, then run_bash to install deps and test
- ${userFacing ? 'Report results directly to the user with a clear summary' : 'NEVER contact the user directly — report results back to the CTO'}
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
The CTO will tell you which folder/slug to use. Use EXACTLY that path.
To deploy a real app:
1. run_bash: mkdir -p ~/[slug] && cd ~/[slug] (use the slug from your task brief)
2. For simple sites: write_file ~/[slug]/index.html with the full HTML
   For apps: run_bash "cd ~/[slug] && npm init -y" then write_file source files, then npm install
3. run_bash: cd ~/[slug] && npm run build (if it's an npm project)
4. run_bash: cd ~/[slug] && vercel --prod --yes (deploys to Vercel, returns live URL)
5. Store the live URL: blackboard_write("deployment_url", "https://...")
6. Report the live URL back to ${userFacing ? 'the user' : 'CTO'}

IMPORTANT: The workspace ~ maps to /tmp on this server. Files persist for this session only.
Use git_commit frequently so work is checkpointed even if the session ends.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELF-TEST LOOP — MANDATORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After writing any code file, you MUST verify it works:
1. Use read_file to read back what you just wrote — confirm content is correct
2. For Node.js scripts: run_bash "node ~/[file]" — check for errors
3. For npm projects: run_bash "cd ~/[project] && npm run build" or "npm test"
4. If you get an error: read the exact error message, fix the code, run again
5. Do NOT declare done until the code actually executes without errors
6. Then call git_commit to checkpoint your working state

You can also: git clone repos, push code to GitHub, run tests, set up databases, send emails via Resend, send SMS via Telnyx.
Always use write_file for large file content, then run_bash for commands.` : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use list_dir first to see what already exists before writing anything new
- Use read_file before editing an existing file — understand it first
- Use output_html to create HTML files, write_file for CSS/JS
- run_bash for simple operations like mkdir, ls (no npm/git/npx — not available)
- ${userFacing ? 'Report results directly to the user with a clear summary' : 'NEVER contact the user directly — report results back to the CTO'}
- Keep going until the task is FULLY complete — do not stop after one step
- Home directory: ${wsHome}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML GENERATION — MANDATORY APPROACH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST generate websites as self-contained single-file HTML.

REQUIRED STEPS:
1. Use list_dir to see what already exists
2. Call output_html with:
   - path="~/[project]/index.html"
   - html="<FULL COMPLETE HTML DOCUMENT>"
   The "html" field MUST contain the ENTIRE HTML document.
3. The HTML must have ALL CSS in <style> tags, ALL JS inline or via CDN (e.g. https://cdn.tailwindcss.com)
4. Make it look professional: hero, navigation, services, about, contact form, footer

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELF-TEST LOOP — MANDATORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After writing any file:
1. Use read_file to verify the file saved correctly — check content looks right
2. Fix anything wrong and write it again
3. Then call git_commit to checkpoint your working state

CRITICAL: Put the ENTIRE HTML in the "html" field of output_html. Do NOT just put the path.`) : ''

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

    // 5. Feature registry — all services/tools available across all projects
    featuresContext ? `## Available Services & Tools (do NOT rebuild these — reuse them)\n${featuresContext}` : '',

    // 6. Global rules
    globalRules || '',

    // 6. Org context
    `## Team\n${orgContext ? JSON.stringify(orgContext.nodes?.map(n => ({ id: n.id, label: n.label, role: n.role, level: n.level })), null, 2) : 'Standalone agent.'}`,

    // 7. Long-term memories (injected last so they're closest to the conversation)
    memoriesPrompt || '',

    // 8. Autonomy directive + task-first operating model
    `You are fully autonomous. Be direct and decisive. No hedging, no asking for permission.

TASK-FIRST OPERATING MODEL (like OpenClaw):
Every request you receive is a task. Your job is to:
1. Call task_list at the start of a conversation to see what is already pending
2. Call task_write to capture the new task before doing work on it
3. Execute the work (delegate, research, code, write, plan — whatever is needed)
4. Call task_update to mark the task done when complete

You handle ANY kind of task — not just code:
- "Remind me to call John tomorrow" → task_write with due_date, note the reminder
- "Research the best React frameworks" → task_write + web_search + summarize
- "Build a landing page for my startup" → task_write + delegate to dev team
- "Organize my week" → task_list + help prioritize
Software development is one skill among many. Use the dev team (delegate_task) only when building software.

MEMORY: Use remember for important facts about the user, their preferences, their projects. Use search_memory to recall past context before starting.

STREAMING THOUGHTS — MANDATORY:
Think out loud in short bursts as you work. Do NOT compose a long response and send it all at once. Instead:
- Output a short line before each action: "Checking the task list…", "Searching for X…", "Found it — now writing the fix…"
- After each tool call, post 1-2 sentences on what you got back before moving to the next step
- Use short paragraphs of 2-3 sentences max. Hit enter often.
- The user sees your output in real time — make it feel alive, like watching you think
- Never make the user wait more than a few seconds without seeing new text
Example pattern:
"Got the task. Looking at what's already in progress…
\n\n[task_list call]
\n\nThree open tasks — none blocking this. Writing a new one now…
\n\n[task_write call]
\n\nOk, captured. Now let me search for the answer…"`,
  ].filter(Boolean).join('\n\n')

  // ── Bash runner ───────────────────────────────────────────────────────────
  // Always runs locally on the same container where files are written.
  // No HTTP hop — unified filesystem means agents can read their own writes instantly.
  // Execution server (EXEC_SERVER_URL) is kept only for Playwright/browser tools.
  const EXEC_SERVER_URL = process.env.EXECUTION_SERVER_URL
  const EXEC_TOKEN = process.env.EXEC_TOKEN || ''

  const LOCAL_BASH = process.platform === 'win32'
    ? (() => { const { existsSync } = require('fs'); return [process.env.SHELL, 'C:\\Users\\pargo_pxnd4wa\\scoop\\apps\\git\\current\\bin\\bash.exe', '/bin/bash', 'bash'].find(p => p && (p === 'bash' || existsSync(p))) || 'bash' })()
    : '/bin/bash'

  async function runBash(command, cwd) {
    const cwdResolved = (cwd || wsHome).replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome)

    return new Promise((resolve) => {
      const child = spawn(LOCAL_BASH, ['-c', command], {
        cwd: cwdResolved,
        env: { ...process.env, HOME: wsHome, FORCE_COLOR: '0', TERM: 'dumb' },
        timeout: 120000,
        shell: false,
      })
      let stdout = '', stderr = ''
      child.stdout?.on('data', d => stdout += d.toString())
      child.stderr?.on('data', d => stderr += d.toString())
      child.on('close', code => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 }))
      child.on('error', err => resolve({ stdout: '', stderr: err.message, exitCode: 1 }))
    })
  }

  // ── Artifact registry ─────────────────────────────────────────────────────
  // Auto-logs all files written, URLs deployed, emails sent to agent_artifacts table
  async function logArtifact(type, pathOrUrl, metadata = {}) {
    try {
      const svc = createServiceClient()
      await svc.from('agent_artifacts').insert({
        user_id: userId,
        workspace_id: workspaceId || 'global',
        agent_id: agentId,
        type,
        path: (type === 'file' || type === 'html' || type === 'structured_output') ? String(pathOrUrl) : null,
        url: (type === 'deploy' || type === 'email' || type === 'sms') ? String(pathOrUrl) : null,
        metadata,
      })
    } catch {} // non-fatal
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
            workspaceId,
            tokenBudget: input.tokenBudget || null,
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
      // Extract token budget usage from output markers
      const tokenMatch = subOutput.match(/<!--TOKEN_USAGE:(\d+)-->/)
      const tokensUsed = tokenMatch ? parseInt(tokenMatch[1]) : null
      if (input.tokenBudget && tokensUsed) {
        const remaining = input.tokenBudget - tokensUsed
        if (remaining < 0) send(`\n\n⚠️ **Token budget exceeded** by ${-remaining} tokens (budget: ${input.tokenBudget}, used: ${tokensUsed})`)
      }
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
      const resolvedPath = input.path.replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome)
      send(`\n\n📄 **Generating website** \`${input.path}\` (${htmlContent.length} chars)`)
      try {
        mkdirSync(dirname(resolvedPath), { recursive: true })
        writeFileSync(resolvedPath, htmlContent, 'utf8')
        send(`\n\n✅ Website written: ${input.path}`)
        const escaped = Buffer.from(htmlContent).toString('base64')
        send(`\n\n<!--PREVIEW_HTML:${escaped}-->`)
        send(`\n\n<!--FILE_ENTRY:${JSON.stringify({ path: input.path, content: htmlContent.slice(0, 2400) })}-->`)
        logArtifact('html', input.path, { size: htmlContent.length }).catch(() => {})
        return `HTML website written to ${input.path} (${htmlContent.length} chars). Preview will display automatically.`
      } catch (err) {
        send(`\n\n❌ ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'write_document' || name === 'write_file') {
      const { writeFileSync, mkdirSync } = await import('fs')
      const { dirname } = await import('path')
      // Always resolve ~ to the per-conversation workspace dir
      const resolvedPath = input.path.replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome)
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
        logArtifact('file', input.path, { size: input.content.length }).catch(() => {})
        return `Written: ${input.path} (${input.content.length} chars)`
      } catch (err) {
        send(`\n\n❌ ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'git_commit') {
      const msg = (input.message || 'checkpoint').replace(/"/g, '\\"')
      const r = await runBash(`git add -A && git commit -m "${msg}" --allow-empty`, wsHome)
      send(`\n\n📦 **Committed:** \`${input.message}\``)
      return (r.stdout || r.stderr || 'Committed.').slice(0, 500)

    } else if (name === 'read_file') {
      const resolvedPath = (input.path || '').replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome)
      try {
        const { readFileSync } = await import('fs')
        const content = readFileSync(resolvedPath, 'utf8')
        send(`\n\n📖 **Read:** \`${input.path}\` (${content.length} chars)`)
        return content.slice(0, 20000)
      } catch (err) {
        return `File not found: ${err.message}`
      }

    } else if (name === 'list_dir') {
      const dirPath = input.path
        ? input.path.replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome)
        : wsHome
      const r = await runBash(
        `find "${dirPath}" -maxdepth 3 -not -path "*/.git/*" -not -path "*/node_modules/*" | sort`,
        wsHome
      )
      send(`\n\n📁 **Directory:** \`${input.path || '~/'}\``)
      return r.stdout || r.stderr || '(empty directory)'

    } else if (name === 'run_bash') {
      const cmd = input.command
      const cwd = input.cwd ? input.cwd.replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome) : wsHome
      send(`\n\n💻 **Running:** \`${cmd.slice(0, 100)}${cmd.length > 100 ? '...' : ''}\``)
      try {
        const r = await runBash(cmd, cwd)
        const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim() || '(no output)'
        const truncated = out.slice(0, 3000)
        send(`\n\n**Output** (exit ${r.exitCode}):\n\`\`\`\n${truncated}\n\`\`\``)

        // ── Auto-screenshot any live URL found in output ──────────────────
        const urlMatch = out.match(/https:\/\/[\w.-]+\.(vercel\.app|railway\.app|netlify\.app|up\.railway\.app|herokuapp\.com|pages\.dev)(\/\S*)?/i)
        if (urlMatch && process.env.EXECUTION_SERVER_URL) {
          const liveUrl = urlMatch[0].replace(/[.,;)'"]+$/, '') // strip trailing punctuation
          send(`\n\n🚀 **Live URL detected:** [${liveUrl}](${liveUrl})\n📸 Taking screenshot...`)
          try {
            const execUrl = process.env.EXECUTION_SERVER_URL
            const execToken = process.env.EXEC_TOKEN || 'svets-exec-token-2026'
            const navRes = await fetch(`${execUrl}/browser`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${execToken}` },
              body: JSON.stringify({ action: 'navigate', sessionId: `deploy-${agentId}`, url: liveUrl }),
            })
            const navResult = await navRes.json()
            if (navResult.ok) {
              // Wait a moment for JS to render
              await new Promise(r => setTimeout(r, 2000))
              const shotRes = await fetch(`${execUrl}/browser`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${execToken}` },
                body: JSON.stringify({ action: 'screenshot', sessionId: `deploy-${agentId}`, fullPage: false }),
              })
              const shot = await shotRes.json()
              if (shot.screenshot) {
                send(`\n\n![Live site screenshot](data:image/png;base64,${shot.screenshot})`)
                send(`\n\n<!--PREVIEW_URL:${liveUrl}-->`)
              }
              // Close session
              fetch(`${execUrl}/browser`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${execToken}` },
                body: JSON.stringify({ action: 'close', sessionId: `deploy-${agentId}` }),
              }).catch(() => {})
            }
          } catch {} // screenshot failure is non-fatal
        }

        return `exit ${r.exitCode}:\n${truncated}`
      } catch (err) {
        send(`\n\n❌ **Error:** ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'send_email') {
      send(`\n\n📧 **Sending email** to \`${input.to}\`...`)
      try {
        const apiKey = process.env.RESEND_API_KEY
        if (!apiKey) return 'send_email requires RESEND_API_KEY env var.'
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            from: input.from || 'Svet\'s Dream <noreply@birthdayboard.email>',
            to: [input.to],
            subject: input.subject,
            html: input.html,
          }),
        })
        const result = await res.json()
        if (result.id) {
          send(`\n\n✅ Email sent (id: ${result.id})`)
          logArtifact('email', `mailto:${input.to}`, { subject: input.subject, resend_id: result.id }).catch(() => {})
          return `Email sent successfully. ID: ${result.id}`
        } else {
          send(`\n\n❌ Email failed: ${result.message || JSON.stringify(result)}`)
          return `Error: ${result.message || JSON.stringify(result)}`
        }
      } catch (err) {
        send(`\n\n❌ Email error: ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'send_sms') {
      send(`\n\n📱 **Sending SMS** to \`${input.to}\`...`)
      try {
        const apiKey = process.env.TELNYX_API_KEY
        if (!apiKey) return 'send_sms requires TELNYX_API_KEY env var.'
        const res = await fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            from: '+15878643090',
            to: input.to,
            text: input.message,
          }),
        })
        const result = await res.json()
        if (result.data?.id) {
          send(`\n\n✅ SMS sent (id: ${result.data.id})`)
          return `SMS sent successfully. ID: ${result.data.id}`
        } else {
          const err = result.errors?.[0]?.detail || JSON.stringify(result)
          send(`\n\n❌ SMS failed: ${err}`)
          return `Error: ${err}`
        }
      } catch (err) {
        send(`\n\n❌ SMS error: ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'query_db') {
      send(`\n\n🗄️ **DB query:** \`${input.sql.slice(0, 80)}${input.sql.length > 80 ? '...' : ''}\``)
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !serviceKey) return 'query_db requires Supabase env vars.'
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ query: input.sql }),
        })
        // Fallback: if exec_sql not available, return helpful message
        if (res.status === 404) {
          return 'Direct SQL not available. Use run_bash with a node script using SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars to query via REST API.'
        }
        const result = await res.json()
        const preview = JSON.stringify(result).slice(0, 1000)
        send(`\n\n**Result:**\n\`\`\`json\n${preview}\n\`\`\``)
        return preview
      } catch (err) {
        send(`\n\n❌ DB error: ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (name === 'screenshot_url') {
      const execUrl = process.env.EXECUTION_SERVER_URL
      if (!execUrl) return 'screenshot_url requires EXECUTION_SERVER_URL to be configured.'
      const execToken = process.env.EXEC_TOKEN || 'svets-exec-token-2026'
      send(`\n\n📸 **Screenshot:** \`${input.url}\``)
      try {
        // Navigate first, then screenshot
        const navRes = await fetch(`${execUrl}/browser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${execToken}` },
          body: JSON.stringify({ action: 'navigate', sessionId: `screenshot-${agentId}`, url: input.url }),
        })
        const navResult = await navRes.json()
        if (!navResult.ok) {
          send(`\n\n❌ **Screenshot Error:** ${navResult.error}`)
          return `Error: ${navResult.error}`
        }
        const shotRes = await fetch(`${execUrl}/browser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${execToken}` },
          body: JSON.stringify({ action: 'screenshot', sessionId: `screenshot-${agentId}`, fullPage: input.fullPage || false }),
        })
        const shotResult = await shotRes.json()
        if (shotResult.screenshot) {
          send(`\n\n![screenshot](data:image/png;base64,${shotResult.screenshot})`)
        }
        // Close session after use
        await fetch(`${execUrl}/browser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${execToken}` },
          body: JSON.stringify({ action: 'close', sessionId: `screenshot-${agentId}` }),
        }).catch(() => {})
        return `Screenshot of ${input.url} captured. Title: ${navResult.title || ''}. URL: ${navResult.url || input.url}`
      } catch (err) {
        send(`\n\n❌ **Screenshot Error:** ${err.message}`)
        return `Error: ${err.message}`
      }

    } else if (['browser_navigate', 'browser_screenshot', 'browser_click', 'browser_fill', 'browser_read', 'browser_close', 'browser_key_press'].includes(name)) {
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
        key_press: `Pressing "${input.key || 'Enter'}"`,
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
              workspaceId,
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

    // ── Task management handlers ───────────────────────────────────────────────
    } else if (name === 'task_write') {
      try {
        const svc = createServiceClient()
        const PRIORITY_LABELS = { 1: '⚪ someday', 2: '🔵 low', 3: '🟡 normal', 4: '🟠 high', 5: '🔴 urgent' }
        if (input.id) {
          // Update existing task
          const updates = {}
          if (input.status) updates.status = input.status
          if (input.priority) updates.priority = input.priority
          if (input.due_date) updates.due_date = input.due_date
          if (input.tags) updates.tags = input.tags
          if (input.notes) {
            const { data: existing } = await svc.from('agent_tasks').select('notes').eq('id', input.id).maybeSingle()
            updates.notes = existing?.notes ? `${existing.notes}\n\n${input.notes}` : input.notes
          }
          if (input.description) updates.description = input.description
          if (input.title) updates.title = input.title
          const { data } = await svc.from('agent_tasks').update(updates).eq('id', input.id).select().maybeSingle()
          send(`\n\n📋 **Task updated:** ${data?.title || input.id} → ${data?.status || ''}`)
          send(`\n\n<!--TASK_UPDATE:${JSON.stringify({ id: data?.id, title: data?.title, status: data?.status, priority: data?.priority })}-->`)
          return `Task updated: "${data?.title}" (${data?.status})`
        } else {
          // Create new task
          const row = {
            user_id: userId,
            title: input.title,
            description: input.description || null,
            status: input.status || 'todo',
            priority: input.priority || 3,
            due_date: input.due_date || null,
            tags: input.tags || null,
            workspace_id: workspaceId || null,
            agent_id: agentId,
            notes: input.notes || null,
          }
          const { data } = await svc.from('agent_tasks').insert(row).select().maybeSingle()
          const pri = PRIORITY_LABELS[data?.priority] || ''
          send(`\n\n📋 **Task created:** ${data?.title} ${pri}`)
          send(`\n\n<!--TASK_UPDATE:${JSON.stringify({ id: data?.id, title: data?.title, status: data?.status, priority: data?.priority })}-->`)
          return `Task created: "${data?.title}" (id: ${data?.id})`
        }
      } catch (err) {
        return `task_write error: ${err.message}`
      }

    } else if (name === 'task_list') {
      try {
        const svc = createServiceClient()
        const statusFilter = input.status || 'active'
        let query = svc.from('agent_tasks').select('id,title,status,priority,due_date,tags,notes,created_at,workspace_id').eq('user_id', userId)
        if (statusFilter === 'active') {
          query = query.in('status', ['todo', 'in_progress'])
        } else if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter)
        }
        if (input.tag) query = query.contains('tags', [input.tag])
        const { data } = await query.order('priority', { ascending: false }).order('created_at', { ascending: false }).limit(input.limit || 20)
        if (!data?.length) return `No tasks found (filter: ${statusFilter}).`
        const ICONS = { todo: '⬜', in_progress: '🔄', done: '✅', cancelled: '❌', waiting: '⏳' }
        const PRIS = { 5: '🔴', 4: '🟠', 3: '🟡', 2: '🔵', 1: '⚪' }
        const lines = data.map(t => `${ICONS[t.status] || '?'} ${PRIS[t.priority] || ''} **${t.title}**${t.due_date ? ` (due ${t.due_date})` : ''}\n   id: ${t.id}${t.notes ? `\n   📝 ${t.notes.split('\n')[0].slice(0, 80)}` : ''}`)
        const out = `**Tasks (${statusFilter}):**\n${lines.join('\n\n')}`
        send(`\n\n${out}`)
        send(`\n\n<!--TASK_LIST:${JSON.stringify(data.map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, tags: t.tags })))}-->`)
        return out
      } catch (err) {
        return `task_list error: ${err.message}`
      }

    } else if (name === 'task_update') {
      try {
        const svc = createServiceClient()
        const updates = {}
        if (input.status) updates.status = input.status
        if (input.priority) updates.priority = input.priority
        if (input.notes) {
          const { data: existing } = await svc.from('agent_tasks').select('notes').eq('id', input.id).maybeSingle()
          updates.notes = existing?.notes ? `${existing.notes}\n\n${input.notes}` : input.notes
        }
        const { data } = await svc.from('agent_tasks').update(updates).eq('id', input.id).select().maybeSingle()
        const icon = input.status === 'done' ? '✅' : input.status === 'in_progress' ? '🔄' : '📋'
        send(`\n\n${icon} **Task:** ${data?.title || input.id} → **${data?.status}**`)
        send(`\n\n<!--TASK_UPDATE:${JSON.stringify({ id: data?.id, title: data?.title, status: data?.status, priority: data?.priority })}-->`)
        return `Task "${data?.title}" → ${data?.status}`
      } catch (err) {
        return `task_update error: ${err.message}`
      }

    } else if (name === 'schedule_task') {
      try {
        const svc = createServiceClient()
        // Compute next_run: prefer cron_expr for time-based, else interval
        let nextRun = new Date(Date.now() + input.interval_minutes * 60 * 1000).toISOString()
        if (input.cron_expr) {
          // Simple cron next-run calculator (handles daily, weekly, hourly-at-minute)
          try {
            const [min, hour, , , dow] = input.cron_expr.split(' ')
            const now = new Date(); const next = new Date(now); next.setSeconds(0, 0)
            if (min !== '*' && hour !== '*' && (dow === '*' || dow === undefined)) {
              next.setHours(parseInt(hour), parseInt(min), 0, 0)
              if (next <= now) next.setDate(next.getDate() + 1)
              nextRun = next.toISOString()
            } else if (min !== '*' && hour !== '*' && dow !== '*') {
              const targetDow = parseInt(dow); const currentDow = now.getDay()
              let daysUntil = (targetDow - currentDow + 7) % 7
              if (daysUntil === 0) { const t2 = new Date(now); t2.setHours(parseInt(hour), parseInt(min), 0, 0); if (t2 <= now) daysUntil = 7 }
              next.setDate(next.getDate() + daysUntil); next.setHours(parseInt(hour), parseInt(min), 0, 0)
              nextRun = next.toISOString()
            } else if (min !== '*' && hour === '*') {
              next.setMinutes(parseInt(min), 0, 0)
              if (next <= now) next.setHours(next.getHours() + 1)
              nextRun = next.toISOString()
            }
          } catch {}
        }
        const { data } = await svc.from('agent_workflows').insert({
          name: input.name,
          description: input.description || null,
          task: input.task,
          interval_minutes: input.interval_minutes,
          cron_expr: input.cron_expr || null,
          notify_email: input.notify_email || null,
          notify_phone: input.notify_phone || null,
          notify_slack: input.notify_slack || null,
          workspace_id: workspaceId || 'global',
          next_run: nextRun,
          active: true,
        }).select().maybeSingle()
        const freq = input.cron_expr || (
          input.interval_minutes >= 1440 ? `every ${input.interval_minutes / 1440}d`
          : input.interval_minutes >= 60 ? `every ${input.interval_minutes / 60}h`
          : `every ${input.interval_minutes}m`
        )
        const notifNote = input.notify_email ? ` → results to ${input.notify_email}` : input.notify_phone ? ` → SMS ${input.notify_phone}` : ''
        send(`\n\n⏰ **Workflow scheduled:** "${input.name}" — ${freq}${notifNote}`)
        send(`\n\n<!--WORKFLOW_CREATED:${JSON.stringify({ id: data?.id, name: input.name, interval_minutes: input.interval_minutes, next_run: nextRun })}-->`)
        return `Workflow "${input.name}" scheduled (${freq}). First run at ${nextRun}.${notifNote}`
      } catch (err) {
        return `schedule_task error: ${err.message}`
      }

    } else if (name === 'slack_notify') {
      try {
        const payload = {
          text: input.text,
          username: input.username || "Svet's Dream",
          icon_emoji: input.icon_emoji || ':robot_face:',
        }
        const res = await fetch(input.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.text()
        if (!res.ok) return `Slack error ${res.status}: ${body}`
        send(`\n\n💬 **Slack:** Message sent`)
        return 'Message sent to Slack.'
      } catch (err) {
        return `slack_notify error: ${err.message}`
      }

    } else if (name === 'github_api') {
      try {
        // Get token from input, or fall back to memory
        let token = input.token
        if (!token) {
          const svc = createServiceClient()
          const { data: mem } = await svc.from('agent_memories')
            .select('content').eq('user_id', userId).ilike('content', '%github_token%').maybeSingle()
          if (mem?.content) {
            const m = mem.content.match(/github_token[:\s]+([A-Za-z0-9_]+)/)
            if (m) token = m[1]
          }
        }
        if (!token) return 'GitHub token not found. Ask the user to provide their GitHub personal access token, then store it with remember() as "github_token: ghp_..."'

        const res = await fetch(`https://api.github.com${input.path}`, {
          method: input.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: input.body ? JSON.stringify(input.body) : undefined,
        })
        const data = await res.json()
        if (!res.ok) return `GitHub API error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`
        send(`\n\n🐙 **GitHub:** ${input.method} ${input.path} → ${res.status}`)
        return JSON.stringify(data).slice(0, 4000)
      } catch (err) {
        return `github_api error: ${err.message}`
      }

    } else if (name === 'notion_api') {
      try {
        let token = input.token
        if (!token) {
          const svc = createServiceClient()
          const { data: mem } = await svc.from('agent_memories')
            .select('content').eq('user_id', userId).ilike('content', '%notion_token%').maybeSingle()
          if (mem?.content) {
            const m = mem.content.match(/notion_token[:\s]+(secret_[A-Za-z0-9]+)/)
            if (m) token = m[1]
          }
        }
        if (!token) return 'Notion token not found. Ask the user to share their Notion integration token, then store it with remember() as "notion_token: secret_..."'

        const res = await fetch(`https://api.notion.com/v1${input.path}`, {
          method: input.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: input.body ? JSON.stringify(input.body) : undefined,
        })
        const data = await res.json()
        if (!res.ok) return `Notion API error ${res.status}: ${JSON.stringify(data).slice(0, 300)}`
        send(`\n\n📓 **Notion:** ${input.method} ${input.path} → ${res.status}`)
        return JSON.stringify(data).slice(0, 4000)
      } catch (err) {
        return `notion_api error: ${err.message}`
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
    } else if (name === 'fetch_url') {
      const { url, format = 'text' } = input
      send(`\n\n🌐 **Fetching:** \`${url}\``)
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SvetsDream/1.0)' },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`
        const contentType = res.headers.get('content-type') || ''
        if (format === 'json' || (format !== 'raw' && contentType.includes('json'))) {
          try {
            const json = await res.json()
            const out = JSON.stringify(json, null, 2).slice(0, 20000)
            send(`\n\n(${out.length} chars JSON)`)
            return out
          } catch { /* fall through */ }
        }
        const text = await res.text()
        if (format === 'raw') {
          send(`\n\n(${text.length} chars raw)`)
          return text.slice(0, 20000)
        }
        const stripped = text
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ').trim()
        send(`\n\n(${stripped.length} chars)`)
        return stripped.slice(0, 20000)
      } catch (err) {
        return `Fetch error: ${err.message}`
      }

    } else if (name === 'web_search') {
      const query = encodeURIComponent(input.query)
      send(`\n\n🔍 **Searching:** \`${input.query}\``)
      try {
        const res = await fetch(`https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SvetsDream/1.0)' },
          signal: AbortSignal.timeout(10000),
        })
        const data = await res.json()
        const results = []
        if (data.AbstractText) results.push(`**Summary:** ${data.AbstractText}\nSource: ${data.AbstractURL}`)
        for (const topic of (data.RelatedTopics || []).slice(0, 8)) {
          if (topic.Text && topic.FirstURL) results.push(`- ${topic.Text.slice(0, 120)} (${topic.FirstURL})`)
          else if (topic.Topics) {
            for (const sub of topic.Topics.slice(0, 3)) {
              if (sub.Text && sub.FirstURL) results.push(`- ${sub.Text.slice(0, 120)} (${sub.FirstURL})`)
            }
          }
        }
        if (results.length === 0) {
          // Fallback: bash curl to DDG HTML
          const r = await runBash(
            `curl -sL --max-time 8 "https://html.duckduckgo.com/html/?q=${query}" | grep -oP '(?<=class="result__snippet">)[^<]+' | head -5`,
            wsHome
          )
          if (r.stdout.trim()) results.push(r.stdout.trim())
          else results.push(`No instant results for "${input.query}". Try fetch_url with a specific docs URL or run_bash with curl.`)
        }
        const out = results.join('\n\n')
        send(`\n\n${out.slice(0, 600)}`)
        return out.slice(0, 5000)
      } catch (err) {
        return `Search error: ${err.message}`
      }

    } else if (name === 'edit_file') {
      const resolvedPath = (input.path || '').replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome)
      send(`\n\n✏️ **Editing:** \`${input.path}\``)
      try {
        const { readFileSync, writeFileSync } = await import('fs')
        const current = readFileSync(resolvedPath, 'utf8')
        if (!current.includes(input.old_string)) {
          return `Edit failed: exact string not found in ${input.path}.\n\nExpected:\n\`\`\`\n${input.old_string.slice(0, 300)}\n\`\`\`\n\nUse read_file first to check the actual content.`
        }
        const updated = current.replace(input.old_string, input.new_string)
        writeFileSync(resolvedPath, updated, 'utf8')
        const delta = input.new_string.length - input.old_string.length
        send(`\n\n✅ Edited: ${input.path} (${delta >= 0 ? '+' : ''}${delta} chars)`)
        return `Edited ${input.path}: replaced ${input.old_string.length} chars with ${input.new_string.length} chars.`
      } catch (err) {
        return `Edit error: ${err.message}`
      }

    } else if (name === 'grep_files') {
      const searchPath = input.path ? input.path.replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome) : wsHome
      const include = input.glob ? `--include="${input.glob}"` : ''
      const pat = input.pattern.replace(/"/g, '\\"')
      const cmd = `grep -r -n --color=never ${include} "${pat}" "${searchPath}" 2>/dev/null | head -100`
      send(`\n\n🔎 **Grep:** \`${input.pattern}\` in \`${input.path || '~/'}\``)
      const r = await runBash(cmd, wsHome)
      const out = (r.stdout || r.stderr || '(no matches)').trim()
      send(`\n\n\`\`\`\n${out.slice(0, 2000)}\n\`\`\``)
      return out.slice(0, 5000)

    } else if (name === 'glob_files') {
      const searchPath = input.path ? input.path.replace(/^~\//, wsHome + '/').replace(/^~$/, wsHome) : wsHome
      // Convert glob to find + grep filter
      const globRegex = (input.pattern || '*')
        .replace(/\./g, '\\.').replace(/\*\*/g, 'GLOBSTAR').replace(/\*/g, '[^/]*').replace(/GLOBSTAR/g, '.*').replace(/\?/g, '.')
      const cmd = `find "${searchPath}" -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/.next/*" | grep -E "${globRegex}" | sort | head -100`
      send(`\n\n📂 **Glob:** \`${input.pattern}\` in \`${input.path || '~/'}\``)
      const r = await runBash(cmd, wsHome)
      const out = (r.stdout || r.stderr || '(no matches)').trim()
      send(`\n\n\`\`\`\n${out.slice(0, 2000)}\n\`\`\``)
      return out.slice(0, 5000)

    } else if (name === 'delegate_parallel') {
      if (_delegationDepth >= MAX_DELEGATION_DEPTH) {
        send(`\n\n⚠️ **Delegation depth limit reached.**`)
        return 'Delegation blocked: max depth reached.'
      }
      const tasks = input.tasks || []
      const divider = '─'.repeat(50)
      send(`\n\n${divider}\n⚡ **Parallel delegation:** ${tasks.length} tasks starting simultaneously\n${divider}\n\n`)

      const results = await Promise.all(tasks.map(async (t) => {
        const targetAgent = orgContext?.nodes?.find(n =>
          n.id === t.to ||
          n.id?.toLowerCase() === t.to?.toLowerCase() ||
          n.label?.toLowerCase() === t.to?.toLowerCase() ||
          n.label?.toLowerCase().includes(t.to?.toLowerCase())
        )
        if (!targetAgent) return `❌ Agent "${t.to}" not found.`
        send(`\n<!--agent-active:${targetAgent.id}-->\n🤝 **→ ${targetAgent.label}:** ${t.task.slice(0, 120)}...\n`)
        let subOutput = ''
        try {
          const res = await fetch(`${origin}/api/agent-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
              agent: targetAgent,
              messages: [{ role: 'user', content: t.task }],
              orgContext, rules,
              _delegationDepth: _delegationDepth + 1,
              workspaceId,
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
          subOutput = `Error: ${err.message}`
          send(`\n\n❌ ${targetAgent.label} error: ${err.message}`)
        }
        send(`\n<!--agent-idle:${targetAgent.id}-->`)
        return `[${targetAgent.label}]: ${subOutput.slice(0, 2000)}`
      }))

      send(`\n\n${divider}\n✓ **All ${tasks.length} parallel tasks complete**\n${divider}\n\n`)
      return results.join('\n\n---\n\n')

    } else if (name === 'deploy') {
      const platform = input.platform || 'vercel'
      send(`\n\n🚀 **Deploying to ${platform}...**`)
      try {
        if (platform === 'vercel') {
          const projectFlag = input.project_name ? `--name ${input.project_name}` : ''
          const r = await runBash(`vercel --prod --yes ${projectFlag} 2>&1`, wsHome)
          const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
          const urlMatch = out.match(/https:\/\/[\w.-]+\.vercel\.app[\S]*/i)
          if (urlMatch) {
            const url = urlMatch[0].replace(/[.,;)'"]+$/, '')
            send(`\n\n🎉 **Deployed:** [${url}](${url})`)
            send(`\n\n<!--PREVIEW_URL:${url}-->`)
            logArtifact('deploy', url, { platform: 'vercel' }).catch(() => {})
          }
          return out.slice(0, 2000)
        } else if (platform === 'railway') {
          const r = await runBash(`railway up --detach 2>&1`, wsHome)
          const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
          const urlMatch = out.match(/https:\/\/[\w.-]+\.up\.railway\.app[\S]*/i)
          if (urlMatch) {
            send(`\n\n🎉 **Deployed:** [${urlMatch[0]}](${urlMatch[0]})`)
            logArtifact('deploy', urlMatch[0], { platform: 'railway' }).catch(() => {})
          }
          return out.slice(0, 2000)
        }
        return `Unknown platform: ${platform}`
      } catch (err) {
        send(`\n\n❌ Deploy error: ${err.message}`)
        return `Error: ${err.message}`
      }
    }

    // ── Feature 1: Semantic memory search ─────────────────────────────────────
    } else if (name === 'search_memory') {
      try {
        const svc = createServiceClient()
        const query = (input.query || '').trim()
        const limit = Math.min(input.limit || 10, 20)
        const { data } = await svc
          .from('agent_memories')
          .select('content, type, importance, created_at')
          .eq('user_id', userId)
          .ilike('content', `%${query}%`)
          .order('importance', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(limit)
        if (!data?.length) return `No memories found matching "${query}".`
        const results = data.map(m => `[${m.type}, importance:${m.importance}] ${m.content}`)
        const out = results.join('\n')
        send(`\n\n🧠 **Memory search:** ${data.length} result(s) for "${query}"`)
        return out
      } catch (err) {
        return `Error searching memory: ${err.message}`
      }

    // ── Feature 3: Shared agent blackboard ────────────────────────────────────
    } else if (name === 'blackboard_read') {
      try {
        const svc = createServiceClient()
        const wsId = workspaceId || 'global'
        const { data } = await svc
          .from('agent_blackboard')
          .select('value, updated_at')
          .eq('user_id', userId)
          .eq('workspace_id', wsId)
          .eq('key', input.key)
          .maybeSingle()
        if (!data) return `Blackboard key "${input.key}" not found.`
        send(`\n\n📋 **Blackboard read:** \`${input.key}\` = ${JSON.stringify(data.value).slice(0, 120)}`)
        return JSON.stringify(data.value)
      } catch (err) {
        return `Blackboard read error: ${err.message}`
      }

    } else if (name === 'blackboard_write') {
      try {
        const svc = createServiceClient()
        const wsId = workspaceId || 'global'
        await svc.from('agent_blackboard').upsert({
          user_id: userId,
          workspace_id: wsId,
          key: input.key,
          value: input.value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,workspace_id,key' })
        send(`\n\n📋 **Blackboard write:** \`${input.key}\` = ${JSON.stringify(input.value).slice(0, 120)}`)
        return `Written to blackboard: ${input.key}`
      } catch (err) {
        return `Blackboard write error: ${err.message}`
      }

    // ── Feature 4: Human-in-the-loop pauses ───────────────────────────────────
    // Architecture: agent emits APPROVAL_REQUEST marker and stops. Frontend shows decision UI.
    // User clicks an option → their next chat message includes the decision → agent continues.
    // This avoids blocking the HTTP stream (Vercel 300s limit) and gives proper UX.
    } else if (name === 'request_approval') {
      try {
        const svc = createServiceClient()
        const approvalId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await svc.from('pending_approvals').insert({
          id: approvalId,
          user_id: userId,
          workspace_id: workspaceId || 'global',
          agent_id: agentId,
          question: input.question,
          context: input.context || null,
          options: input.options || null,
          status: 'pending',
        })
        // Emit UI marker — frontend catches this and shows the approval card
        const payload = JSON.stringify({ id: approvalId, question: input.question, options: input.options || [], context: input.context || '' })
        send(`\n\n⏸️ **Waiting for your decision**\n\n**${input.question}**`)
        if (input.options?.length) send(`\n\nOptions: ${input.options.map((o, i) => `**${i + 1}.** ${o}`).join(' | ')}`)
        if (input.context) send(`\n\n*${input.context}*`)
        send(`\n\n<!--APPROVAL_REQUEST:${payload}-->`)
        // Return immediately — do NOT poll. The stream will close normally.
        // The frontend will show the decision buttons. The user's next message IS the decision.
        // When the user replies, the agent loop resumes with their choice as context.
        return `PAUSED — awaiting your decision on: "${input.question}". Reply with your choice and I will continue from here.`
      } catch (err) {
        return `Approval error: ${err.message}`
      }

    // ── Feature 6: Structured output enforcement ──────────────────────────────
    } else if (name === 'structured_output') {
      try {
        const pretty = JSON.stringify(input.data, null, 2).slice(0, 3000)
        send(`\n\n📊 **Structured output** (\`${input.schema_name}\`):\n\`\`\`json\n${pretty}\n\`\`\``)
        const payload = JSON.stringify({ schema: input.schema_name, data: input.data })
        send(`\n\n<!--STRUCTURED_OUTPUT:${payload}-->`)
        logArtifact('structured_output', input.schema_name, { data: input.data }).catch(() => {})
        return `Structured output emitted: ${input.schema_name} (${JSON.stringify(input.data).length} chars)`
      } catch (err) {
        return `Structured output error: ${err.message}`
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
          if (last && last.role === msg.role) {
            // Handle multimodal (array) content — don't stringify it
            if (Array.isArray(last.content) || Array.isArray(msg.content)) {
              const a = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content) }]
              const b = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }]
              last.content = [...a, ...b]
            } else {
              last.content += '\n\n' + msg.content
            }
          } else {
            normalized.push({ ...msg })
          }
        }
        loopMessages = normalized

        // ── Feature 2: Persistent agent sessions ──────────────────────────────
        // Load prior session history so agents remember cross-conversation context
        if (workspaceId && _delegationDepth === 0 && messages.length === 1) {
          try {
            const svc = createServiceClient()
            const { data: session } = await svc
              .from('agent_sessions')
              .select('messages')
              .eq('user_id', userId)
              .eq('workspace_id', workspaceId)
              .eq('agent_id', agentId)
              .maybeSingle()
            if (session?.messages?.length > 1) {
              // Prepend last 16 messages as context (up to 8 prior pairs)
              const history = session.messages.slice(-16).filter(m =>
                typeof m.content === 'string' // keep only simple text, not tool results
              )
              if (history.length > 0) loopMessages = [...history, ...loopMessages]
              while (loopMessages.length > 0 && loopMessages[0].role !== 'user') loopMessages.shift()
            }
          } catch {}
        }

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

          // Max output tokens: claude-sonnet-4-6 supports up to 64K output
          const maxTokens = 64000

          // Rate-limit retry: on 429 or 529 (overloaded), backoff and retry up to 3 times
          let apiStream, finalMsg
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              apiStream = anthropic.messages.stream({
                model: 'claude-sonnet-4-6',
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

              finalMsg = await apiStream.finalMessage()
              break // success — exit retry loop
            } catch (apiErr) {
              const isRateLimit = apiErr?.status === 429 || apiErr?.status === 529 || /rate.?limit|overloaded/i.test(apiErr?.message || '')
              if (isRateLimit && attempt < 2) {
                const waitMs = (attempt + 1) * 12000 // 12s, then 24s
                send(`\n\n⏳ *Rate limit hit — retrying in ${waitMs / 1000}s (attempt ${attempt + 2}/3)...*`)
                await new Promise(r => setTimeout(r, waitMs))
              } else {
                throw apiErr // non-rate-limit error or out of retries
              }
            }
          }
          totalInputTokens += finalMsg.usage?.input_tokens || 0
          totalOutputTokens += finalMsg.usage?.output_tokens || 0

          const toolUseBlocks = finalMsg.content.filter(b => b.type === 'tool_use')

          // No tool calls = model is done
          if (toolUseBlocks.length === 0) break

          // Context compaction: if history is growing large, summarize the middle to preserve
          // build state without ballooning token costs (OpenClaw-style chunked compaction)
          if (loopMessages.length > 20) {
            try {
              // Keep first user message (the original task) + last 8 messages
              const anchor = loopMessages[0]
              const tail = loopMessages.slice(-8)
              const middle = loopMessages.slice(1, -8)
              // Summarize the middle messages to preserve key decisions/file paths/URLs
              const middleText = middle.map(m => {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                return `[${m.role}]: ${content.slice(0, 800)}`
              }).join('\n\n')
              const summaryRes = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1200,
                messages: [{ role: 'user', content: `Summarize this agent work log in 600 words. Preserve ALL: file paths written, URLs deployed, decisions made, errors encountered, current task state. This will be injected as context for the agent to continue work.\n\n${middleText}` }],
              })
              const summary = summaryRes.content[0]?.text || ''
              loopMessages = [
                anchor,
                { role: 'user', content: `[CONTEXT SUMMARY — work done so far]\n${summary}` },
                { role: 'assistant', content: 'Understood, continuing from where I left off.' },
                ...tail,
              ]
            } catch {
              // Fallback to simple truncation if summarization fails
              const firstMsg = loopMessages[0]
              loopMessages = [firstMsg, ...loopMessages.slice(-16)]
            }
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

        // ── Feature 7: Token budget reporting ─────────────────────────────────
        const totalTokens = totalInputTokens + totalOutputTokens
        if (tokenBudget && totalTokens > tokenBudget) {
          send(`\n\n⚠️ **Token budget exceeded:** used ${totalTokens.toLocaleString()} (budget: ${tokenBudget.toLocaleString()})`)
        }
        // Emit token usage marker so parent delegate_task can track it
        send(`\n\n<!--TOKEN_USAGE:${totalTokens}-->`)

        if (userId) {
          await recordTransaction({
            userId,
            model: 'claude-sonnet-4-6',
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            agentName: agent.label,
            reason: messages[messages.length - 1]?.content?.slice(0, 200) || 'Agent chat',
          }).catch(() => {})

          // Append to daily log
          const userMsg = messages[messages.length - 1]?.content?.slice(0, 200) || 'task'
          await appendToLog(`${agent.label} handled: "${userMsg}" (${totalInputTokens}in/${totalOutputTokens}out tokens)`).catch(() => {})
        }

        // ── Feature 2: Save persistent session ────────────────────────────────
        if (workspaceId && _delegationDepth === 0) {
          try {
            const svc = createServiceClient()
            // Save last 20 messages; only keep text-based ones (not tool result arrays)
            const sessionMessages = loopMessages.slice(-20)
              .filter(m => typeof m.content === 'string')
              .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }))
            if (sessionMessages.length > 0) {
              await svc.from('agent_sessions').upsert({
                user_id: userId,
                workspace_id: workspaceId,
                agent_id: agentId,
                messages: sessionMessages,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id,workspace_id,agent_id' })
            }
          } catch {}
        }

        controller.close()
      } catch (err) {
        console.error(`[agent-chat] ${agent?.label} error:`, err.message)
        send(`\n\n❌ **Error:** ${err.message.slice(0, 300)}`)
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
