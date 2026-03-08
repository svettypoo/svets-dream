// Google Translate TTS — free, no API key, no setup
import https from 'https'
import { writeFile } from 'fs/promises'

export async function textToSpeechFile(text, outputPath) {
  const encoded = encodeURIComponent(text.slice(0, 200)) // Google TTS limit
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encoded}`

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', async () => {
        const buf = Buffer.concat(chunks)
        await writeFile(outputPath, buf)
        resolve(outputPath)
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}
