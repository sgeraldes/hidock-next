import { GoogleGenerativeAI, type Part } from '@google/generative-ai'
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server'
import { extname } from 'node:path'
import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engine-interface.js'

export interface GeminiEngineOptions {
  apiKey: string
  model?: string
  language?: string
}

const MIME_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mp3',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.hda': 'audio/mp3',
}

/**
 * GeminiEngine transcribes audio using Google Gemini's multimodal API
 * (inline base64 data, not Google Speech-to-Text). It sends the entire
 * audio file plus a transcription prompt, and returns a single segment
 * containing the full transcript text.
 *
 * This engine is not streaming (isStreaming = false) and is not local
 * (isLocal = false) — it requires an internet connection and a Gemini API key.
 *
 * The optional `context` field in TranscribeOptions is appended to the
 * transcription prompt to improve accuracy (e.g. meeting subject / attendees).
 */
export class GeminiEngine implements TranscriptionEngine {
  readonly isStreaming = false
  readonly isLocal = false

  /** Raw-audio size above which the Files API is used instead of inline base64. */
  static readonly INLINE_LIMIT_BYTES = 14 * 1024 * 1024

  private readonly apiKey: string
  private readonly model: string
  private readonly language: string

  constructor(options: GeminiEngineOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? 'gemini-2.5-flash'
    this.language = options.language ?? 'unknown'
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0
  }

  /**
   * Upload a large audio file via the Gemini Files API and wait for it to
   * finish server-side processing, returning a fileData Part for
   * generateContent. Required for audio above INLINE_LIMIT_BYTES.
   */
  private async uploadViaFilesApi(filePath: string, mimeType: string): Promise<Part> {
    const fileManager = new GoogleAIFileManager(this.apiKey)
    const upload = await fileManager.uploadFile(filePath, { mimeType })

    let file = upload.file
    const deadline = Date.now() + 5 * 60 * 1000
    while (file.state === FileState.PROCESSING) {
      if (Date.now() > deadline) {
        throw new Error('Gemini Files API: timed out waiting for file processing')
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
      file = await fileManager.getFile(file.name)
    }

    if (file.state === FileState.FAILED) {
      throw new Error('Gemini Files API: file processing failed')
    }

    return { fileData: { mimeType: file.mimeType, fileUri: file.uri } }
  }

  /**
   * Transcribe an audio buffer using Gemini. The audio is base64-encoded and
   * sent inline. Returns exactly one TranscriptSegment containing the full
   * transcript (no timestamps — Gemini does not provide word-level timing).
   *
   * The `options.context` string, if provided, is appended to the prompt to
   * give Gemini meeting context (subject, attendees, time) for better accuracy.
   *
   * The `options.source` value is used to produce a speaker label
   * ('you' for mic, 'them' for system).
   */
  async *transcribe(audio: Buffer, options: TranscribeOptions & { filePath?: string }): AsyncIterable<TranscriptSegment> {
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured')
    }

    const filePath = (options as { filePath?: string }).filePath ?? ''
    const ext = extname(filePath).toLowerCase()
    const mimeType = MIME_TYPES[ext] ?? 'audio/wav'

    const genAI = new GoogleGenerativeAI(this.apiKey)
    const modelInstance = genAI.getGenerativeModel({ model: this.model })

    // Gemini rejects inline requests over ~20 MB total; base64 inflates audio
    // by ~33%, so anything above ~14 MB raw must go through the Files API
    // (hour-long recordings were failing with a bare "fetch failed" otherwise).
    const audioPart: Part =
      audio.length > GeminiEngine.INLINE_LIMIT_BYTES && filePath
        ? await this.uploadViaFilesApi(filePath, mimeType)
        : { inlineData: { mimeType, data: audio.toString('base64') } }

    const contextSection = options.context ? `\n${options.context}` : ''
    const transcriptionPrompt = `Transcribe this audio recording.
The audio may be in Spanish or English - transcribe in the original language.
Provide a clean, accurate transcription of all speech.
If there are multiple speakers, try to indicate speaker changes with "Speaker 1:", "Speaker 2:", etc.${contextSection}
Return ONLY the transcription, no additional commentary.`

    const result = await modelInstance.generateContent([
      audioPart,
      { text: transcriptionPrompt },
    ])

    const text = result.response.text().trim()
    if (!text) {
      return
    }

    const speaker = options.source === 'mic' ? 'you' : 'them'

    yield {
      speaker,
      text,
      startTime: 0,
      endTime: 0,
      confidence: 1,
      source: options.source,
    }
  }
}
