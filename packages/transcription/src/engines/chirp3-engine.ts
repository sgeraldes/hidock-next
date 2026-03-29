import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engine-interface.js'

export interface Chirp3Options {
  apiKey?: string
  languageCode?: string
  model?: string
}

interface SpeechRecognitionResult {
  alternatives: Array<{
    transcript: string
    confidence: number
    words?: Array<{
      word: string
      startTime: string
      endTime: string
      speakerTag?: number
    }>
  }>
}

interface SpeechRecognitionResponse {
  results?: SpeechRecognitionResult[]
}

export class Chirp3Engine implements TranscriptionEngine {
  readonly isStreaming = true
  readonly isLocal = false

  private readonly apiKey?: string
  private readonly languageCode: string
  private readonly model: string

  constructor(options: Chirp3Options = {}) {
    this.apiKey = options.apiKey
    this.languageCode = options.languageCode ?? 'en-US'
    this.model = options.model ?? 'chirp_2'
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey != null && this.apiKey.length > 0
  }

  async *transcribe(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment> {
    if (!this.apiKey) {
      throw new Error('Chirp3Engine requires an API key')
    }

    const base64Audio = audio.toString('base64')
    const timeOffset = options.timeOffset ?? 0

    const requestBody = {
      config: {
        encoding: 'WEBM_OPUS',
        languageCode: options.language ?? this.languageCode,
        model: this.model,
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
      },
      audio: {
        content: base64Audio,
      },
    }

    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Google Speech API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as SpeechRecognitionResponse
    const speaker = options.source === 'mic' ? 'you' : 'them'

    if (!data.results || data.results.length === 0) {
      return
    }

    for (const result of data.results) {
      const alt = result.alternatives[0]
      if (!alt) continue

      let startTime = 0
      let endTime = 0

      if (alt.words && alt.words.length > 0) {
        startTime = parseGoogleDuration(alt.words[0].startTime)
        endTime = parseGoogleDuration(alt.words[alt.words.length - 1].endTime)
      }

      yield {
        speaker,
        text: alt.transcript.trim(),
        startTime: timeOffset + startTime,
        endTime: timeOffset + endTime,
        confidence: alt.confidence ?? 1,
        source: options.source,
      }
    }
  }
}

function parseGoogleDuration(duration: string): number {
  // Google returns durations like "1.500s" or "0s"
  if (!duration) return 0
  const stripped = duration.replace('s', '')
  const parsed = parseFloat(stripped)
  return isNaN(parsed) ? 0 : parsed
}
