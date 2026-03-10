#!/usr/bin/env node
const https = require('https')
const fs = require('fs')
const path = require('path')

const script = fs.readFileSync(path.join(__dirname, 'scripts', 'workflow-runner.js'), 'utf8')

async function run(command) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ command })
    const req = https.request({
      hostname: 'svets-dream-production.up.railway.app',
      path: '/run',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'Bearer svets-exec-token-2026',
      },
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

;(async () => {
  // Write the file using base64 to avoid heredoc issues
  const b64 = Buffer.from(script).toString('base64')
  console.log('Writing workflow-runner.js...')
  const writeResult = await run(
    `echo ${b64} | base64 -d > /root/workspace/scripts/workflow-runner.js && echo "written OK"`
  )
  console.log(writeResult)

  // Kill any existing runner
  console.log('Killing old runner...')
  await run('pkill -f workflow-runner || true')

  // Start fresh
  console.log('Starting runner...')
  const startResult = await run(
    'nohup node /root/workspace/scripts/workflow-runner.js > /root/workspace/workflow-runner.log 2>&1 & echo "started PID $!"'
  )
  console.log(startResult)

  // Verify it's running
  await new Promise(r => setTimeout(r, 2000))
  const checkResult = await run('pgrep -fa workflow-runner | head -5')
  console.log('Running:', checkResult)
})()
