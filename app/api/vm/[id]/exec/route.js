import { createServerSupabaseClient } from '@/lib/supabase-server'
import { execInVM } from '@/lib/vm-manager'

export const runtime = 'nodejs'

export async function POST(req, { params }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { command, stream: streamOutput } = await req.json()
  if (!command) return Response.json({ error: 'No command provided' }, { status: 400 })

  if (!streamOutput) {
    try {
      const output = await execInVM(params.id, user.id, command)
      return Response.json({ output })
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 })
    }
  }

  // Stream output
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const output = await execInVM(params.id, user.id, command)
        if (output.stdout) controller.enqueue(encoder.encode(output.stdout))
        if (output.stderr) controller.enqueue(encoder.encode('\n[stderr] ' + output.stderr))
        controller.close()
      } catch (err) {
        controller.enqueue(encoder.encode(`[Error] ${err.message}`))
        controller.close()
      }
    }
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
