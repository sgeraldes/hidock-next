import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engine-interface.js'

export interface VibeVoiceEngineOptions {
  pythonPath?: string
  asrPath?: string
  /** ISO 639-1 code, or "auto" (default) — VibeVoice auto-detects and code-switches. */
  language?: string
  vocabularyPath?: string
  hfToken?: string
}

/**
 * VibeVoiceEngine runs microsoft/VibeVoice-ASR via the asr_mcp CLI
 * (`python -m asr_mcp.cli <file> --backend vibevoice`). VibeVoice performs
 * joint ASR + speaker diarization + timestamping in a single pass, so its own
 * speaker labels (e.g. "Speaker 0", "Speaker 1") are preserved rather than
 * remapped to the live two-source you/them convention.
 *
 * Batch / full-file only (not streaming) — intended for transcribing or
 * re-processing complete recordings.
 */
export class VibeVoiceEngine implements TranscriptionEngine {
  readonly isStreaming = false
  readonly isLocal = true

  private readonly pythonPath: string
  private readonly asrPath?: string
  private readonly language: string
  private readonly vocabularyPath?: string
  private readonly hfToken?: string

  constructor(options: VibeVoiceEngineOptions = {}) {
    this.pythonPath = options.pythonPath ?? 'python'
    this.asrPath = options.asrPath
    this.language = options.language ?? 'auto'
    this.vocabularyPath = options.vocabularyPath
    this.hfToken = options.hfToken
  }

  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const proc = spawn(this.pythonPath, ['-m', 'asr_mcp.cli', '--help'], {
        cwd: this.asrPath,
        stdio: 'ignore',
        env: this.hfToken ? { ...process.env, HF_TOKEN: this.hfToken } : process.env,
      })
      proc.on('error', () => resolve(false))
      proc.on('close', (code) => resolve(code === 0))
    })
  }

  async *transcribe(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment> {
    const tempPath = join(tmpdir(), `hidock-vibevoice-${randomUUID()}.wav`)
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
          speaker: seg.speaker ?? 'unknown',
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

  private invokeCli(audioPath: string, options: TranscribeOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const args = ['-m', 'asr_mcp.cli', audioPath, '--backend', 'vibevoice', '-f', 'json']
      args.push('-l', options.language ?? this.language)
      if (this.vocabularyPath) {
        args.push('--vocabulary', this.vocabularyPath)
      }

      const env = this.hfToken ? { ...process.env, HF_TOKEN: this.hfToken } : process.env

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
