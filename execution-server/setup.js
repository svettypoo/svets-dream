/**
 * Svet's Dream — Execution Server Setup
 * Runs once on startup to install CLIs and configure credentials.
 */

const { execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = process.env.HOME || os.homedir()

function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
    return out.trim()
  } catch (e) {
    return e.stderr?.trim() || e.message
  }
}

function log(msg) {
  console.log(`[setup] ${msg}`)
}

// ── 1. Log available CLIs ─────────────────────────────────────────────────────
log('Available CLIs:')
for (const bin of ['node', 'npm', 'git', 'vercel', 'railway', 'python3', 'curl']) {
  const loc = run(`which ${bin} 2>/dev/null || echo "not found"`)
  log(`  ${bin}: ${loc}`)
}

// ── 2. Configure GitHub credentials ──────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
if (GITHUB_TOKEN) {
  log('Configuring GitHub...')
  // Write .netrc for git HTTPS auth
  const netrcPath = path.join(HOME, '.netrc')
  const netrcEntry = `machine github.com\n  login svettypoo\n  password ${GITHUB_TOKEN}\n`
  fs.writeFileSync(netrcPath, netrcEntry, { mode: 0o600 })
  run(`git config --global credential.helper store`)
  run(`git config --global user.name "Svet"`)
  run(`git config --global user.email "pargov.svet@gmail.com"`)
  log('  GitHub: configured via .netrc')
} else {
  log('  GitHub: GITHUB_TOKEN not set, skipping')
}

// ── 3. Configure Vercel CLI ───────────────────────────────────────────────────
const VERCEL_TOKEN = process.env.VERCEL_TOKEN
if (VERCEL_TOKEN) {
  log('Configuring Vercel CLI...')
  const vercelConfigDir = path.join(HOME, '.local', 'share', 'com.vercel.cli')
  fs.mkdirSync(vercelConfigDir, { recursive: true })
  fs.writeFileSync(
    path.join(vercelConfigDir, 'auth.json'),
    JSON.stringify({ token: VERCEL_TOKEN }),
  )
  log('  Vercel: configured')
} else {
  log('  Vercel: VERCEL_TOKEN not set, skipping')
}

// ── 4. Configure Supabase CLI ─────────────────────────────────────────────────
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (SUPABASE_ACCESS_TOKEN) {
  log('Configuring Supabase CLI...')
  const supabaseConfigDir = path.join(HOME, '.config', 'supabase')
  fs.mkdirSync(supabaseConfigDir, { recursive: true })
  fs.writeFileSync(
    path.join(supabaseConfigDir, 'access-token'),
    SUPABASE_ACCESS_TOKEN,
  )
  log('  Supabase: configured')
} else {
  log('  Supabase: SUPABASE_ACCESS_TOKEN not set, skipping')
}

// ── 5. Ensure workspace exists ────────────────────────────────────────────────
const WORK_DIR = process.env.WORK_DIR || path.join(HOME, 'workspace')
fs.mkdirSync(WORK_DIR, { recursive: true })
log(`Workspace: ${WORK_DIR}`)

log('Setup complete.')
