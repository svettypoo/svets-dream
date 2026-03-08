import { createServerSupabaseClient } from '@/lib/supabase-server'
import { spawn } from 'child_process'
import { checkBudget } from '@/lib/spend-tracker'

export const runtime = 'nodejs'

export async function POST(req) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { command, cwd, stream: streamOutput, timeoutMs = 60000 } = await req.json()
  if (!command) return Response.json({ error: 'No command' }, { status: 400 })

  const shell = process.platform === 'win32'
    ? { cmd: 'bash', args: ['-c', command] }   // Git Bash on Windows
    : { cmd: 'bash', args: ['-c', command] }

  if (!streamOutput) {
    // Non-streaming: collect and return
    const output = await runBash(shell.cmd, shell.args, cwd, timeoutMs)
    return Response.json({ output })
  }

  // Streaming output
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    start(controller) {
      const child = spawn(shell.cmd, shell.args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: timeoutMs,
        shell: false,
      })

      child.stdout.on('data', d => controller.enqueue(encoder.encode(d.toString())))
      child.stderr.on('data', d => controller.enqueue(encoder.encode('[stderr] ' + d.toString())))
      child.on('close', code => {
        if (code !== 0) controller.enqueue(encoder.encode(`\n[exit code ${code}]`))
        controller.close()
      })
      child.on('error', err => {
        controller.enqueue(encoder.encode(`[Error] ${err.message}`))
        controller.close()
      })
    }
  })

  return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

function runBash(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: timeoutMs,
      shell: false,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => stdout += d.toString())
    child.stderr.on('data', d => stderr += d.toString())
    child.on('close', code => resolve({ stdout, stderr, exitCode: code }))
    child.on('error', reject)
  })
}
