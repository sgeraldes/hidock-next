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
    // Keep in sync with CURRENT_GEMINI_MODEL in the electron app's config.ts —
    // 2.x models are retired and 404 on generateContent.
    this.model = options.model ?? 'gemini-3.5-flash'
    this.language = options.language ?? 'unknown'
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0
  }

  /**
   * Split a PCM WAV buffer into independent, playable WAV chunks of roughly
   * TARGET_CHUNK_SECONDS each (capped so each chunk stays inline-safe after
   * base64 inflation). Returns null when the buffer is not a plain PCM WAV —
   * callers must fall back to whole-file transcription.
   */
  private splitWavIntoChunks(audio: Buffer): Buffer[] | null {
    const TARGET_CHUNK_SECONDS = 600
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
      return null
    }

    // Walk RIFF chunks to find fmt and data
    let offset = 12
    let fmt: {
      audioFormat: number
      channels: number
      sampleRate: number
      byteRate: number
      blockAlign: number
      bitsPerSample: number
    } | null = null
    let dataOffset = -1
    let dataSize = 0
    while (offset + 8 <= audio.length) {
      const id = audio.toString('ascii', offset, offset + 4)
      const size = audio.readUInt32LE(offset + 4)
      if (id === 'fmt ' && size >= 16) {
        fmt = {
          audioFormat: audio.readUInt16LE(offset + 8),
          channels: audio.readUInt16LE(offset + 10),
          sampleRate: audio.readUInt32LE(offset + 12),
          byteRate: audio.readUInt32LE(offset + 16),
          blockAlign: audio.readUInt16LE(offset + 20),
          bitsPerSample: audio.readUInt16LE(offset + 22),
        }
      } else if (id === 'data') {
        dataOffset = offset + 8
        dataSize = Math.min(size, audio.length - dataOffset)
      }
      offset += 8 + size + (size % 2)
    }

    if (!fmt || fmt.audioFormat !== 1 || dataOffset < 0 || fmt.byteRate <= 0 || fmt.blockAlign <= 0) {
      return null // compressed / malformed WAV — do not slice blindly
    }

    // Chunk size: target duration, but never exceed the inline base64 budget.
    let chunkBytes = Math.min(fmt.byteRate * TARGET_CHUNK_SECONDS, GeminiEngine.INLINE_LIMIT_BYTES - 1024 * 1024)
    chunkBytes = Math.max(fmt.blockAlign, chunkBytes - (chunkBytes % fmt.blockAlign))
    if (dataSize <= chunkBytes) return null // single chunk — no point splitting

    const buildHeader = (sliceLen: number): Buffer => {
      const h = Buffer.alloc(44)
      h.write('RIFF', 0, 'ascii')
      h.writeUInt32LE(36 + sliceLen, 4)
      h.write('WAVE', 8, 'ascii')
      h.write('fmt ', 12, 'ascii')
      h.writeUInt32LE(16, 16)
      h.writeUInt16LE(1, 20) // PCM
      h.writeUInt16LE(fmt!.channels, 22)
      h.writeUInt32LE(fmt!.sampleRate, 24)
      h.writeUInt32LE(fmt!.byteRate, 28)
      h.writeUInt16LE(fmt!.blockAlign, 32)
      h.writeUInt16LE(fmt!.bitsPerSample, 34)
      h.write('data', 36, 'ascii')
      h.writeUInt32LE(sliceLen, 40)
      return h
    }

    const chunks: Buffer[] = []
    for (let pos = 0; pos < dataSize; pos += chunkBytes) {
      const slice = audio.subarray(dataOffset + pos, dataOffset + Math.min(pos + chunkBytes, dataSize))
      chunks.push(Buffer.concat([buildHeader(slice.length), slice]))
    }
    return chunks
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

    // WHY CHUNKING: single-call transcription of hour-long audio is unreliable
    // no matter the config (all observed live against gemini-3.5-flash):
    //  - default config truncates after ~2k output tokens (MAX_TOKENS ignored)
    //  - large maxOutputTokens: the thinking model burns the entire budget on
    //    thoughts and returns 1 token, or leaks chain-of-thought into output
    //  - thinkingBudget 0 + temp 0: degenerates into infinite repetition
    //  - non-streaming long calls die after ~5 min with a bare "fetch failed"
    // Splitting the PCM WAV into ~10-minute segments keeps every request small,
    // fast and deterministic. Non-WAV audio can't be split without decoders, so
    // it falls back to a single call (inline or Files API by size).
    const wavChunks = this.splitWavIntoChunks(audio)
    const audioParts: Part[] =
      wavChunks && wavChunks.length > 1
        ? wavChunks.map((c) => ({ inlineData: { mimeType: 'audio/wav', data: c.toString('base64') } }))
        : [
            audio.length > GeminiEngine.INLINE_LIMIT_BYTES && filePath
              ? await this.uploadViaFilesApi(filePath, mimeType)
              : { inlineData: { mimeType, data: audio.toString('base64') } },
          ]

    const contextSection = options.context ? `\n${options.context}` : ''
    // thinkingBudget 0: transcription needs no reasoning, and letting the
    // thinking model reason consumes the output budget (observed: 62k thought
    // tokens, 1 output token). 8192 output tokens comfortably covers 10 minutes
    // of dense speech (~1.8k words).
    const generationConfig = {
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    } as Record<string, unknown>

    const transcribeSegment = async (part: Part, index: number, previousTail: string): Promise<string> => {
      const positionNote =
        audioParts.length > 1
          ? `\nThis is segment ${index + 1} of ${audioParts.length} of a longer recording.` +
            (previousTail
              ? `\nThe previous segment's transcription ended with:\n«${previousTail}»\nKeep speaker labels consistent with it.`
              : '')
          : ''
      const prompt = `Transcribe this audio recording.
The audio may be in Spanish or English - transcribe in the original language.
Provide a clean, accurate transcription of all speech.
If there are multiple speakers, try to indicate speaker changes with "Speaker 1:", "Speaker 2:", etc.${positionNote}${contextSection}
Return ONLY the transcription, no additional commentary.`

      const attempt = async (config: Record<string, unknown>) => {
        const result = await modelInstance.generateContentStream({
          contents: [{ role: 'user', parts: [part, { text: prompt }] }],
          generationConfig: config as never,
        })
        let out = ''
        for await (const chunk of result.stream) {
          out += chunk.text()
        }
        const response = await result.response
        return { text: out.trim(), finishReason: response.candidates?.[0]?.finishReason as string | undefined }
      }

      let res
      try {
        res = await attempt(generationConfig)
      } catch (err) {
        // If the model rejects thinkingConfig or the token cap, retry plain.
        if (String(err).includes('INVALID_ARGUMENT') || String(err).includes('thinking')) {
          res = await attempt({})
        } else {
          throw err
        }
      }
      // MAX_TOKENS on a ~10-minute segment means degeneration (a segment can't
      // contain 8k tokens of real speech) — retry once with default sampling.
      if (res.finishReason === 'MAX_TOKENS') {
        const retry = await attempt({ maxOutputTokens: 8192 })
        if (retry.text && retry.finishReason !== 'MAX_TOKENS') res = retry
      }
      return res.text
    }

    const onProgress = (options as { onProgress?: (done: number, total: number) => void }).onProgress
    const pieces: string[] = []
    for (let i = 0; i < audioParts.length; i++) {
      const previousTail = pieces.length > 0 ? pieces[pieces.length - 1].slice(-300) : ''
      const segmentText = await transcribeSegment(audioParts[i], i, previousTail)
      if (segmentText) pieces.push(segmentText)
      onProgress?.(i + 1, audioParts.length)
    }
    const text = pieces.join('\n')

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
