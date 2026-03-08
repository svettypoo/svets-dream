#!/usr/bin/env node
// Runs automatically after `npm install` — installs all VS Code extensions silently
const { execSync } = require('child_process')

const extensions = [
  'anthropic.claude-code',
  'github.copilot-chat',
  'ms-azuretools.vscode-containers',
  'ms-python.debugpy',
  'ms-python.python',
  'ms-python.vscode-pylance',
  'ms-python.vscode-python-envs',
  'ms-vscode.powershell',
]

// Check if `code` CLI is available
let codeCmd = null
for (const cmd of ['code', 'code-insiders']) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' })
    codeCmd = cmd
    break
  } catch {}
}

if (!codeCmd) {
  console.log('\n[Svet\'s Dream] VS Code CLI not found — skipping extension install.')
  console.log('  To install manually, run: npm run install-extensions\n')
  process.exit(0)
}

console.log('\n[Svet\'s Dream] Installing VS Code extensions...')
let installed = 0

for (const ext of extensions) {
  try {
    execSync(`${codeCmd} --install-extension ${ext} --force`, { stdio: 'ignore' })
    console.log(`  ✓ ${ext}`)
    installed++
  } catch {
    console.log(`  ✗ ${ext} (skipped)`)
  }
}

console.log(`\n  ${installed}/${extensions.length} extensions installed.\n`)
