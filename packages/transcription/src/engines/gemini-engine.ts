import { GoogleGenerativeAI } from '@google/generative-ai'
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

    const base64Audio = audio.toString('base64')
    const filePath = (options as { filePath?: string }).filePath ?? ''
    const ext = extname(filePath).toLowerCase()
    const mimeType = MIME_TYPES[ext] ?? 'audio/wav'

    const genAI = new GoogleGenerativeAI(this.apiKey)
    const modelInstance = genAI.getGenerativeModel({ model: this.model })

    const contextSection = options.context ? `\n${options.context}` : ''
    const transcriptionPrompt = `Transcribe this audio recording.
The audio may be in Spanish or English - transcribe in the original language.
Provide a clean, accurate transcription of all speech.
If there are multiple speakers, try to indicate speaker changes with "Speaker 1:", "Speaker 2:", etc.${contextSection}
Return ONLY the transcription, no additional commentary.`

    const result = await modelInstance.generateContent([
      {
        inlineData: {
          mimeType,
          data: base64Audio,
        },
      },
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
