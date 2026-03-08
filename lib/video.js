// Assembles screenshots + audio clips into an MP4 using bundled ffmpeg
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import { writeFile, mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import https from 'https'
import http from 'http'

ffmpeg.setFfmpegPath(ffmpegPath)

// Upload a file to 0x0.st and return the public URL
export async function uploadTo0x0(filePath) {
  const { default: FormData } = await import('form-data')
  const { createReadStream } = await import('fs')

  const form = new FormData()
  form.append('file', createReadStream(filePath))

  return new Promise((resolve, reject) => {
    const options = {
      hostname: '0x0.st',
      method: 'POST',
      headers: form.getHeaders(),
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data.trim()))
    })
    req.on('error', reject)
    form.pipe(req)
  })
}

// Build a video from steps: [{ screenshotPath, audioPath, durationMs, caption }]
export async function buildWalkthroughVideo(steps, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()

    // Add each screenshot as an input with its duration
    for (const step of steps) {
      cmd.input(step.screenshotPath)
        .inputOptions([`-loop 1`, `-t ${(step.durationMs / 1000).toFixed(2)}`])
    }

    // Add each audio as an input
    for (const step of steps) {
      if (step.audioPath && existsSync(step.audioPath)) {
        cmd.input(step.audioPath)
      }
    }

    // Complex filter: concat video streams, mix audio streams
    const n = steps.length
    const vstreams = steps.map((_, i) => `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`).join(';')
    const vconcat = steps.map((_, i) => `[v${i}]`).join('') + `concat=n=${n}:v=1:a=0[vout]`

    const hasAudio = steps.some((s, i) => s.audioPath && existsSync(s.audioPath))
    let filterComplex = `${vstreams};${vconcat}`
    let outputOptions = ['-map [vout]', '-c:v libx264', '-pix_fmt yuv420p', '-r 25']

    if (hasAudio) {
      const audioInputOffset = n // audio inputs start after video inputs
      const adelays = []
      let cumulativeMs = 0
      steps.forEach((step, i) => {
        if (step.audioPath && existsSync(step.audioPath)) {
          adelays.push(`[${audioInputOffset + i}:a]adelay=${cumulativeMs}|${cumulativeMs}[a${i}]`)
        }
        cumulativeMs += step.durationMs
      })
      const amixInputs = adelays.map((_, i) => `[a${i}]`).join('')
      const amix = `${amixInputs}amix=inputs=${adelays.length}:duration=longest[aout]`
      filterComplex += `;${adelays.join(';')};${amix}`
      outputOptions.push('-map [aout]', '-c:a aac', '-shortest')
    }

    cmd
      .complexFilter(filterComplex)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
}
