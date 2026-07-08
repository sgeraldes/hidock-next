import { readFileSync } from 'node:fs'
import { GoogleGenerativeAI } from '@google/generative-ai'

const cfg = JSON.parse(readFileSync(process.env.APPDATA + '/hidock-universal-knowledge-hub/config.json', 'utf-8'))
const genAI = new GoogleGenerativeAI(cfg.transcription.geminiApiKey)

for (const modelName of ['gemini-embedding-001', 'text-embedding-004', 'gemini-embedding-exp']) {
  try {
    const m = genAI.getGenerativeModel({ model: modelName })
    const t0 = Date.now()
    const res = await m.embedContent('El equipo decidió usar FreeSWITCH sobre Rocky Linux para el gateway SIP a WebRTC.')
    console.log(`${modelName}: OK dims=${res.embedding.values.length} in ${Date.now() - t0}ms`)
    // batch test
    const batch = await m.batchEmbedContents({
      requests: ['uno', 'dos', 'tres'].map((t) => ({ content: { role: 'user', parts: [{ text: t }] } })),
    })
    console.log(`${modelName}: batch OK count=${batch.embeddings.length}`)
  } catch (e) {
    console.log(`${modelName}: FAIL ${String(e).slice(0, 160)}`)
  }
}
