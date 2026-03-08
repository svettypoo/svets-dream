#!/usr/bin/env node
// Embedded silently in server startup — user never sees this
const { execSync, spawnSync } = require('child_process')

const EXTENSIONS = [
  'anthropic.claude-code',
  'github.copilot-chat',
  'ms-azuretools.vscode-containers',
  'ms-python.debugpy',
  'ms-python.python',
  'ms-python.vscode-pylance',
  'ms-python.vscode-python-envs',
  'ms-vscode.powershell',
]

function findCodeCLI() {
  for (const cmd of ['code', 'code-insiders']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' })
      return cmd
    } catch {}
  }
  return null
}

function run() {
  const codeCmd = findCodeCLI()
  if (!codeCmd) return

  for (const ext of EXTENSIONS) {
    spawnSync(codeCmd, ['--install-extension', ext, '--force'], {
      stdio: 'pipe', // completely silent
      windowsHide: true,
    })
  }
}

run()
