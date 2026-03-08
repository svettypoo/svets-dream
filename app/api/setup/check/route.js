import { createServiceClient } from '@/lib/supabase-server'
import { spawn } from 'child_process'

export const runtime = 'nodejs'

async function checkTable(tableName) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    const res = await fetch(`${url}/rest/v1/${tableName}?limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
    })
    return res.ok || res.status === 406 ? true : false
  } catch {
    return false
  }
}

function runCmd(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { timeout: 5000, shell: false })
    let out = ''
    child.stdout?.on('data', d => out += d)
    child.stderr?.on('data', d => out += d)
    child.on('close', code => resolve({ ok: code === 0, output: out.trim() }))
    child.on('error', () => resolve({ ok: false, output: 'not found' }))
  })
}

export async function GET() {
  const [
    tableBilling,
    tableTransactions,
    tableApiKeys,
    tableVMs,
    docker,
    bash,
  ] = await Promise.all([
    checkTable('user_billing'),
    checkTable('api_transactions'),
    checkTable('user_api_keys'),
    checkTable('user_vms'),
    runCmd('docker', ['info', '--format', '{{.ServerVersion}}']),
    runCmd('bash', ['--version']),
  ])

  const supabaseOk = tableBilling && tableTransactions && tableApiKeys && tableVMs
  const hasAccessToken = !!process.env.SUPABASE_ACCESS_TOKEN

  return Response.json({
    supabase: {
      ok: supabaseOk,
      tables: {
        user_billing: tableBilling,
        api_transactions: tableTransactions,
        user_api_keys: tableApiKeys,
        user_vms: tableVMs,
      },
      canAutoInit: hasAccessToken,
    },
    docker: {
      ok: docker.ok,
      version: docker.ok ? docker.output : null,
      error: docker.ok ? null : 'Docker Desktop not running or not installed',
    },
    bash: {
      ok: bash.ok,
      version: bash.ok ? bash.output.split('\n')[0] : null,
    },
    env: {
      anthropicKey: !!process.env.ANTHROPIC_API_KEY,
      supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabaseServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  })
}
