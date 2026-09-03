import { spawn } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'
import { delimiter, isAbsolute, join } from 'path'
import { tmpdir } from 'os'

export interface WhisperSegment {
  speaker: string
  start: number
  end: number
  text: string
}

export interface WhisperTranscriptionResult {
  fullText: string
  language: string
  segments: WhisperSegment[]
}

interface WhisperJson {
  result?: { language?: string }
  transcription?: Array<{
    text?: string
    offsets?: { from?: number; to?: number }
  }>
}

/** Resolve an executable without invoking a shell (the packaged app has a small PATH). */
export function resolveWhisperBinary(configuredPath?: string): string | null {
  const requested = configuredPath?.trim() || process.env.WHISPER_CPP_BIN?.trim()
  if (requested) {
    if (isAbsolute(requested)) return existsSync(requested) ? requested : null
    for (const dir of (process.env.PATH || '').split(delimiter)) {
      const candidate = join(dir, requested)
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  const candidates = process.platform === 'darwin'
    ? ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli']
    : process.platform === 'win32'
      ? ['whisper-cli.exe']
      : ['/usr/local/bin/whisper-cli', '/usr/bin/whisper-cli']

  for (const candidate of candidates) {
    if (isAbsolute(candidate) && existsSync(candidate)) return candidate
    for (const dir of (process.env.PATH || '').split(delimiter)) {
      const resolved = join(dir, candidate)
      if (existsSync(resolved)) return resolved
    }
  }
  return null
}

export function validateWhisperConfiguration(
  binaryPath: string,
  modelPath: string
): { binary: string; model: string } {
  const binary = resolveWhisperBinary(binaryPath)
  if (!binary) {
    throw new Error('Whisper CLI not found. Install whisper-cpp or check its path in Settings.')
  }
  const model = modelPath.trim()
  if (!model || !existsSync(model)) {
    throw new Error('Whisper model not found. Check the local model path in Settings.')
  }
  return { binary, model }
}

export function parseWhisperJson(text: string): WhisperTranscriptionResult {
  const parsed = JSON.parse(text) as WhisperJson
  const segments = (parsed.transcription || [])
    .map((segment): WhisperSegment => ({
      speaker: 'Speaker',
      start: Math.max(0, Number(segment.offsets?.from || 0) / 1000),
      end: Math.max(0, Number(segment.offsets?.to || 0) / 1000),
      text: (segment.text || '').trim()
    }))
    .filter((segment) => segment.text.length > 0)

  return {
    fullText: segments.map((segment) => segment.text).join('\n'),
    language: parsed.result?.language || 'unknown',
    segments
  }
}

export async function transcribeWithWhisperCpp(
  filePath: string,
  options: {
    binaryPath: string
    modelPath: string
    language?: string
    threads?: number
    initialPrompt?: string
    onProgress?: (progress: number) => void
  }
): Promise<WhisperTranscriptionResult> {
  const { binary, model } = validateWhisperConfiguration(options.binaryPath, options.modelPath)
  const outputBase = join(tmpdir(), `hidock-whisper-${randomUUID()}`)
  const outputJson = `${outputBase}.json`
  const language = (options.language || 'auto').trim().toLowerCase()
  const args = [
    '-m', model,
    '-f', filePath,
    '-l', language === 'unknown' ? 'auto' : language,
    '-t', String(Math.max(1, Math.min(16, options.threads || 8))),
    '-oj',
    '-of', outputBase,
    '-pp'
  ]
  if (options.initialPrompt?.trim()) {
    // Keep the decoding prompt bounded; metadata can be unexpectedly large.
    args.push('--prompt', options.initialPrompt.trim().slice(0, 1000))
  }

  options.onProgress?.(5)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-16_000)
        const matches = [...chunk.matchAll(/progress\s*=\s*(\d+)%/gi)]
        const last = matches.at(-1)
        if (last) options.onProgress?.(Math.min(95, Math.max(5, Number(last[1]))))
      })
      child.on('error', (error) => reject(new Error(`Failed to start Whisper: ${error.message}`)))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Whisper exited with code ${code}: ${stderr.trim().slice(-2000)}`))
      })
    })

    if (!existsSync(outputJson)) throw new Error('Whisper completed without producing JSON output')
    const result = parseWhisperJson(readFileSync(outputJson, 'utf8'))
    options.onProgress?.(100)
    return result
  } finally {
    try {
      if (existsSync(outputJson)) unlinkSync(outputJson)
    } catch {
      /* best-effort cleanup of our unique temporary output */
    }
  }
}
