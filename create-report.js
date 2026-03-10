#!/usr/bin/env node
const https = require('https')

const TOKEN = '224afdce58a3ab8b317b2dec39244bdadc3158c8e677fad8d924a678819a'

const content = [
  {tag:'h3',children:['Overview']},
  {tag:'p',children:['This document compares the experience of assigning a task across three AI assistant systems: Svet\'s Dream, Claude Code, and OpenClaw — covering response speed, task tracking behavior, user-perceived latency, and concrete recommendations.']},

  {tag:'h3',children:['1. Time to First Output — What the User Waits Through']},
  {tag:'p',children:['The single biggest factor in how a task assignment feels is how long before the user sees anything happen.']},
  {tag:'p',children:['Claude Code: 0.5–1.5s. Direct local API call, streams immediately. No overhead. The user sees the first word within 1–2 seconds of pressing Enter.']},
  {tag:'p',children:['OpenClaw: 2–4s. Message goes through a messaging platform relay (WhatsApp/Telegram bot), then hits the LLM. Platform overhead adds latency but on Telegram it streams live. WhatsApp delivers complete messages in chunks.']},
  {tag:'p',children:['Svet\'s Dream: 4–8s before meaningful output. Current flow: (1) Vercel handler warm-up ~0.5s, (2) task_list DB call ~0.5–1s, (3) task_write DB call ~0.5–1s, (4) LLM first token ~1–2s. That is 3–5 seconds of silent overhead before the user sees a single character. This is the biggest UX gap vs the other two.']},

  {tag:'h3',children:['2. How Each System Handles Task Creation']},
  {tag:'p',children:['Claude Code: No automatic task creation. Uses TodoWrite only when the task is complex enough to warrant tracking (3+ steps). For simple requests it goes straight to the answer. Task tracking is optional and contextual — not a mandatory step on every message.']},
  {tag:'p',children:['OpenClaw: Task tracking is a lightweight memory write — the agent appends a note to MEMORY.md if the request is worth remembering. No DB round-trip, no structured schema. Cost is ~100ms not ~1000ms. Invisible to the user.']},
  {tag:'p',children:['Svet\'s Dream: Every message triggers task_list + task_write as mandatory first steps. Correct for long-running work but overkill for quick questions. The user pays the full overhead even for a 2-second answer.']},

  {tag:'h3',children:['3. Streaming Quality During Execution']},
  {tag:'p',children:['Claude Code: Streams continuously. Tool call results, bash output, and model text all appear in real time. The user never waits more than 2–3 seconds without seeing new content.']},
  {tag:'p',children:['OpenClaw (Telegram): True streaming via bot edit-in-place. The message updates live as the model generates. Feels instant once started.']},
  {tag:'p',children:['OpenClaw (WhatsApp): No streaming — complete message sent on finish. User waits the full generation time with no feedback.']},
  {tag:'p',children:['Svet\'s Dream: Streams character-by-character once the LLM starts talking. But during tool calls (run_bash, web_search, etc.) the stream goes silent — sometimes 5–15 seconds while a command runs. The user sees nothing except "Thinking..."']},

  {tag:'h3',children:['4. Task Visibility']},
  {tag:'p',children:['Claude Code: Tasks shown inline in the conversation via TodoWrite. Simple, readable, no separate panel needed.']},
  {tag:'p',children:['OpenClaw: No dedicated task UI. Tasks live in MEMORY.md — readable only by the agent or by opening the file. No visual panel for the user.']},
  {tag:'p',children:['Svet\'s Dream: Best of all three. Dedicated TasksPanel with live updates streamed from the agent. Tasks grouped by status, click to cycle. This is genuinely better than both others and should be kept and extended.']},

  {tag:'h3',children:['5. Recommendations — Priority Order']},

  {tag:'p',children:['#1 — Make task_list and task_write lazy, not eager. (Biggest win: 1–2 second improvement on every message.)']},
  {tag:'p',children:['Currently both run before any work starts. Instead: load the task list in the background at session start and inject it passively into context. Only call task_write when the agent decides work is worth tracking — not as a reflex. Skip both entirely for short Q&A messages (under ~20 words that are clearly questions, not work requests).']},

  {tag:'p',children:['#2 — Show an instant "received" acknowledgement.']},
  {tag:'p',children:['As soon as the user sends a message, show a client-side "On it..." line in ~100ms — before the API even responds. Makes the wait feel shorter. Claude Code does this through its shell UI. OpenClaw does it via Telegram read receipts.']},

  {tag:'p',children:['#3 — Emit progress during tool calls.']},
  {tag:'p',children:['The longest silences happen during run_bash and web_search. The agent should emit a short text line before AND after each tool: "Running the build...", "Done — build succeeded, now deploying...". The STREAMING THOUGHTS system prompt helps but needs reinforcement in the actual tool-call loop so there is never more than 3 seconds of silence.']},

  {tag:'p',children:['#4 — Cache task_list for the session.']},
  {tag:'p',children:['Right now task_list hits the DB on every new message. Fetch once at session start, hold in agent context, patch on task_write/task_update. Eliminates the DB read on the critical path entirely.']},

  {tag:'p',children:['#5 — Skip task tracking for simple Q&A.']},
  {tag:'p',children:['OpenClaw and Claude Code both implicitly skip task tracking for simple questions. A message under ~20 words that looks like a question ("what is X?", "how does Y work?") should skip task_list and task_write entirely and go straight to the LLM. Only messages that describe actual work trigger the full task flow.']},

  {tag:'p',children:['#6 — Load existing tasks before the first message, not after.']},
  {tag:'p',children:['Currently the TasksPanel is populated as the agent runs. Better: load existing tasks immediately when the dashboard opens (parallel to page render), so the user can see their backlog before they type. This is how Linear, Notion, and every proper task tool works.']},

  {tag:'h3',children:['Summary Table']},
  {tag:'p',children:['Time to first output — Claude Code: 0.5–1.5s | OpenClaw: 2–4s | Svet\'s Dream: 4–8s (needs fix)']},
  {tag:'p',children:['Task creation cost — Claude Code: optional, zero overhead | OpenClaw: ~100ms memory write | Svet\'s Dream: ~2s mandatory DB calls (needs fix)']},
  {tag:'p',children:['Streaming during tools — Claude Code: continuous | OpenClaw: silent on WhatsApp | Svet\'s Dream: silent (needs fix)']},
  {tag:'p',children:['Task visibility UI — Claude Code: inline only | OpenClaw: none | Svet\'s Dream: best in class']},
  {tag:'p',children:['Stop generation — Claude Code: Ctrl+C | OpenClaw: none | Svet\'s Dream: Stop button (just added)']},
  {tag:'p',children:['Scheduling/workflows — Claude Code: none | OpenClaw: cron tool | Svet\'s Dream: full workflow system (best in class)']},
  {tag:'p',children:['Slack/GitHub/Notion tools — Claude Code: none built-in | OpenClaw: yes | Svet\'s Dream: yes (just added)']},
]

const body = JSON.stringify({
  access_token: TOKEN,
  title: "Task Assignment UX: Svet's Dream vs Claude Code vs OpenClaw",
  author_name: "Svet's Dream Analysis",
  return_content: false,
  content,
})

const req = https.request({
  hostname: 'api.telegra.ph',
  path: '/createPage',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
}, res => {
  let d = ''
  res.on('data', c => d += c)
  res.on('end', () => {
    const r = JSON.parse(d)
    if (r.ok) console.log('URL:', r.result.url)
    else console.log('Error:', d)
  })
})
req.write(body)
req.end()
