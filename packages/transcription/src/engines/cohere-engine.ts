import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engine-interface.js'

export interface CohereEngineOptions {
  pythonPath?: string
  asrPath?: string
  language?: string
  numBeams?: number
  vocabularyPath?: string
  hfToken?: string
}

export class CohereEngine implements TranscriptionEngine {
  readonly isStreaming = false
  readonly isLocal = true

  private readonly pythonPath: string
  private readonly asrPath?: string
  private readonly language: string
  private readonly numBeams: number
  private readonly vocabularyPath?: string
  private readonly hfToken?: string

  constructor(options: CohereEngineOptions = {}) {
    this.pythonPath = options.pythonPath ?? 'python'
    this.asrPath = options.asrPath
    this.language = options.language ?? 'en'
    this.numBeams = options.numBeams ?? 5
    this.vocabularyPath = options.vocabularyPath
    this.hfToken = options.hfToken
  }

  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const proc = spawn(this.pythonPath, ['-m', 'asr_mcp.cli', '--help'], {
        cwd: this.asrPath,
        stdio: 'ignore',
        env: this.hfToken
          ? { ...process.env, HF_TOKEN: this.hfToken }
          : process.env,
      })
      proc.on('error', () => resolve(false))
      proc.on('close', (code) => resolve(code === 0))
    })
  }

  async *transcribe(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment> {
    const tempPath = join(tmpdir(), `hidock-asr-${randomUUID()}.wav`)
    try {
      await writeFile(tempPath, audio)

      const output = await this.invokeCli(tempPath, options)
      const parsed = JSON.parse(output)

      const segments: Array<{ text: string; start?: number; end?: number; speaker?: string }> =
        Array.isArray(parsed.segments) ? parsed.segments :
        Array.isArray(parsed) ? parsed :
        [{ text: parsed.text ?? '' }]

      const timeOffset = options.timeOffset ?? 0

      for (const seg of segments) {
        yield {
          speaker: this.mapSpeaker(seg.speaker, options.source),
          text: (seg.text ?? '').trim(),
          startTime: timeOffset + (seg.start ?? 0),
          endTime: timeOffset + (seg.end ?? 0),
          confidence: 1,
          source: options.source,
        }
      }
    } finally {
      await unlink(tempPath).catch(() => {})
    }
  }

  private mapSpeaker(pythonSpeaker: string | undefined, source: TranscribeOptions['source']): string {
    if (source === 'mic') return 'you'
    if (source === 'system') return 'them'
    return pythonSpeaker ?? 'unknown'
  }

  private invokeCli(audioPath: string, options: TranscribeOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const args = ['-m', 'asr_mcp.cli', audioPath]
      args.push('-l', options.language ?? this.language)
      args.push('--diarize')
      args.push('-f', 'json')
      if (this.numBeams !== 5) {
        args.push('--num-beams', String(this.numBeams))
      }
      if (this.vocabularyPath) {
        args.push('--vocabulary', this.vocabularyPath)
      }

      const env = this.hfToken
        ? { ...process.env, HF_TOKEN: this.hfToken }
        : process.env

      const proc = spawn(this.pythonPath, args, {
        cwd: this.asrPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      proc.on('error', (err) => reject(new Error(`Failed to spawn Python process: ${err.message}`)))
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`asr_mcp.cli exited with code ${code}: ${stderr}`))
        } else {
          resolve(stdout)
        }
      })
    })
  }
}
