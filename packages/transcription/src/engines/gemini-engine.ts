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

/** One transcribable slice of audio plus its position in the whole recording. */
export interface AudioChunk {
  /** Independent, self-contained audio buffer (a valid WAV or a run of MP3 frames). */
  data: Buffer
  /** MIME type to send to Gemini for this chunk. */
  mimeType: string
  /** Start time of this chunk within the whole recording, in seconds. */
  startSec: number
  /** Duration of this chunk, in seconds. */
  durationSec: number
}

/**
 * Split a PCM WAV buffer into independent, playable WAV chunks of roughly
 * TARGET_CHUNK_SECONDS each (capped so each chunk stays inline-safe after
 * base64 inflation). Returns null when the buffer is not a plain PCM WAV or
 * would be a single chunk — callers must fall back to MP3 splitting or
 * whole-file transcription.
 */
export function splitWavIntoChunks(audio: Buffer, targetSeconds = 600): AudioChunk[] | null {
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
  let chunkBytes = Math.min(fmt.byteRate * targetSeconds, GeminiEngine.INLINE_LIMIT_BYTES - 1024 * 1024)
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

  // pos walks [0, dataSize) in chunkBytes steps; the final iteration covers the
  // trailing partial chunk (pos + chunkBytes may exceed dataSize — the slice is
  // clamped to dataSize), so the whole recording including its tail is covered.
  const chunks: AudioChunk[] = []
  for (let pos = 0; pos < dataSize; pos += chunkBytes) {
    const sliceLen = Math.min(pos + chunkBytes, dataSize) - pos
    const slice = audio.subarray(dataOffset + pos, dataOffset + pos + sliceLen)
    chunks.push({
      data: Buffer.concat([buildHeader(slice.length), slice]),
      mimeType: 'audio/wav',
      startSec: pos / fmt.byteRate,
      durationSec: sliceLen / fmt.byteRate,
    })
  }
  return chunks
}

// --- MPEG audio (MP3) frame parsing ---------------------------------------
// HiDock devices record MP3-encoded audio, stored with a `.wav`/`.hda`
// extension (saveRecording only renames the extension, it does not transcode).
// splitWavIntoChunks rejects these (no RIFF header), so without a dedicated
// MP3 splitter the whole hour-long file was sent to Gemini as ONE call and
// truncated at the output-token cap. splitMp3IntoChunks slices the stream on
// frame boundaries — a run of MP3 frames is itself a valid MP3 — so each chunk
// is small, inline-safe, and covers the recording end-to-end (including the tail).

const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1]
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1]
const MP3_SAMPLERATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
}

interface Mp3FrameHeader {
  frameLen: number
  frameDurationSec: number
}

/** Parse an MPEG-1/2/2.5 Layer III frame header at `p`, or null if invalid. */
function parseMp3FrameHeader(audio: Buffer, p: number): Mp3FrameHeader | null {
  if (p + 4 > audio.length) return null
  if (audio[p] !== 0xff || (audio[p + 1] & 0xe0) !== 0xe0) return null
  const versionBits = (audio[p + 1] >> 3) & 0x3
  const layerBits = (audio[p + 1] >> 1) & 0x3
  if (versionBits === 1 || layerBits !== 0x1) return null // reserved version, or not Layer III
  const brIndex = (audio[p + 2] >> 4) & 0xf
  const srIndex = (audio[p + 2] >> 2) & 0x3
  const padding = (audio[p + 2] >> 1) & 0x1
  if (brIndex === 0 || brIndex === 15 || srIndex === 3) return null // free/bad bitrate or reserved sample rate
  const mpeg1 = versionBits === 3
  const bitrate = (mpeg1 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[brIndex] * 1000
  const sampleRate = MP3_SAMPLERATES[versionBits][srIndex]
  if (!sampleRate || bitrate <= 0) return null
  const frameLen = mpeg1
    ? Math.floor((144 * bitrate) / sampleRate) + padding
    : Math.floor((72 * bitrate) / sampleRate) + padding
  if (frameLen < 4) return null
  const samplesPerFrame = mpeg1 ? 1152 : 576
  return { frameLen, frameDurationSec: samplesPerFrame / sampleRate }
}

/**
 * Split an MP3 byte stream into independent chunks of ~targetSeconds each,
 * cutting only on frame boundaries. Returns null when the buffer is not a
 * parseable MP3, when parsing derails before reaching the end (returning
 * partial chunks would silently drop the tail — the exact bug this fixes), or
 * when it would be a single chunk.
 */
export function splitMp3IntoChunks(audio: Buffer, targetSeconds = 600): AudioChunk[] | null {
  let start = 0
  // Skip an ID3v2 tag if present (syncsafe 28-bit size at bytes 6..9).
  if (audio.length > 10 && audio.toString('ascii', 0, 3) === 'ID3') {
    const size =
      ((audio[6] & 0x7f) << 21) | ((audio[7] & 0x7f) << 14) | ((audio[8] & 0x7f) << 7) | (audio[9] & 0x7f)
    start = 10 + size
  }
  if (start >= audio.length || !parseMp3FrameHeader(audio, start)) {
    // Not positioned at a frame; try to find the first sync within the head.
    let q = start
    const limit = Math.min(audio.length - 1, start + 8192)
    while (q < limit && !parseMp3FrameHeader(audio, q)) q++
    if (!parseMp3FrameHeader(audio, q)) return null
    start = q
  }

  const maxChunkBytes = GeminiEngine.INLINE_LIMIT_BYTES - 1024 * 1024
  const boundaries: Array<{ start: number; end: number; startSec: number; durationSec: number }> = []
  let chunkStart = start
  let chunkStartSec = 0
  let chunkDur = 0
  let totalSec = 0
  let p = start
  let derailed = false

  while (p + 4 <= audio.length) {
    const hdr = parseMp3FrameHeader(audio, p)
    if (!hdr) {
      // Try to resync to the next frame within a bounded window.
      let q = p + 1
      const limit = Math.min(audio.length - 1, p + 4096)
      while (q < limit && !parseMp3FrameHeader(audio, q)) q++
      if (!parseMp3FrameHeader(audio, q)) {
        // Can't resync. Trailing non-frame bytes at EOF (padding / a stray tag,
        // less than one frame) are a clean end; only a large unparsed region
        // means we genuinely lost sync mid-stream and must bail.
        if (audio.length - p > 8192) derailed = true
        break
      }
      p = q
      continue
    }
    const nextP = p + hdr.frameLen
    if (nextP > audio.length) break // truncated final frame — stop cleanly
    chunkDur += hdr.frameDurationSec
    totalSec += hdr.frameDurationSec
    if (chunkDur >= targetSeconds || nextP - chunkStart >= maxChunkBytes) {
      boundaries.push({ start: chunkStart, end: nextP, startSec: chunkStartSec, durationSec: chunkDur })
      chunkStart = nextP
      chunkStartSec = totalSec
      chunkDur = 0
    }
    p = nextP
  }
  // Flush the trailing partial chunk so the recording tail is never dropped.
  if (chunkStart < p) {
    boundaries.push({ start: chunkStart, end: p, startSec: chunkStartSec, durationSec: chunkDur })
  }

  if (boundaries.length === 0) return null
  // If parsing derailed and left a meaningful trailing region unparsed, bail to
  // the single-call fallback rather than silently returning a truncated set.
  const lastEnd = boundaries[boundaries.length - 1].end
  if (derailed || audio.length - lastEnd > 8192) return null
  if (boundaries.length < 2) return null // single chunk — let the caller do one call

  return boundaries.map((b) => ({
    data: audio.subarray(b.start, b.end),
    mimeType: 'audio/mp3',
    startSec: b.startSec,
    durationSec: b.durationSec,
  }))
}

/** `[MM:SS] Speaker N:` (or `[HH:MM:SS] …`) turn marker, matched ANYWHERE in the
 * text — not just at a line start. Gemini sometimes returns a whole chunk as one
 * paragraph with dozens of embedded markers; splitting on line starts alone left
 * them all glued into a single 0–600s segment (ISSUE-7, seen live on Rec43). */
const INLINE_TURN_RE = /\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]\s*(Speaker\s*\d+)\s*:/g

/**
 * Split `text` on every `[ts] Speaker N:` marker, wherever it occurs. Returns
 * one segment per marker (plus a leading default-speaker segment for any prose
 * before the first marker, so nothing is dropped), or null when the text has no
 * such marker — in which case the caller falls back to the line-based parser.
 */
function parseInlineTurns(
  text: string,
  chunkStartSec: number,
  defaultSpeaker: string,
  source: 'mic' | 'system'
): TranscriptSegment[] | null {
  const markers: Array<{ contentStart: number; markerStart: number; tsSec: number; speaker: string }> = []
  INLINE_TURN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_TURN_RE.exec(text)) !== null) {
    const min = Number(m[1])
    const sec = Number(m[2])
    const hasHours = m[3] != null
    const tsSec = hasHours ? min * 3600 + sec * 60 + Number(m[3]) : min * 60 + sec
    markers.push({
      markerStart: m.index,
      contentStart: m.index + m[0].length,
      tsSec,
      speaker: m[4].replace(/\s+/g, ' ').trim()
    })
  }
  if (markers.length === 0) return null

  const segments: TranscriptSegment[] = []
  const push = (speaker: string, raw: string, startTime: number) => {
    // Collapse the newlines/whitespace that join continuation lines within a turn.
    const body = raw.replace(/\s+/g, ' ').trim()
    if (body) {
      segments.push({ speaker, text: body, startTime, endTime: startTime, confidence: 1, source })
    }
  }

  // Any text before the first marker is a leading turn with the default speaker.
  push(defaultSpeaker, text.slice(0, markers[0].markerStart), chunkStartSec)

  for (let i = 0; i < markers.length; i++) {
    const contentEnd = i + 1 < markers.length ? markers[i + 1].markerStart : text.length
    push(markers[i].speaker, text.slice(markers[i].contentStart, contentEnd), chunkStartSec + markers[i].tsSec)
  }

  return segments.length > 0 ? segments : null
}

/**
 * Parse a chunk's transcription text into speaker turns. Recognises turns of the
 * form `[MM:SS] Speaker N: text` (the format the prompt requests), where the
 * timestamp is relative to the chunk start and is offset by `chunkStartSec` to
 * become an absolute recording time.
 *
 * Markers are recognised wherever they appear, not only at the start of a line:
 * when a chunk comes back as one long paragraph with the markers inline, it is
 * still split into one segment per turn. Well-formed line-per-turn output is a
 * special case of the same split, so it keeps working. When the chunk has no
 * `[..] Speaker N:` markers at all, the fallback line parser handles bare
 * timestamps, `Speaker N:`/name labels, and continuation lines; failing that,
 * the whole chunk becomes a single turn — content is preserved verbatim either
 * way, nothing is dropped.
 */
export function parseTurns(
  text: string,
  chunkStartSec: number,
  defaultSpeaker: string,
  source: 'mic' | 'system'
): TranscriptSegment[] {
  // Fast path: split on every inline `[ts] Speaker N:` marker across the whole
  // text. This covers both the one-paragraph-with-inline-markers case and the
  // clean line-per-turn case (newlines inside a turn collapse to spaces).
  const inlineSegments = parseInlineTurns(text, chunkStartSec, defaultSpeaker, source)
  if (inlineSegments) return inlineSegments

  const segments: TranscriptSegment[] = []
  const tsRe = /^\[?(\d{1,3}):(\d{2})(?::(\d{2}))?\]?\s+(.*)$/
  const speakerRe = /^(Speaker\s*\d+|[A-Z][^:\n]{0,40}?):\s+(.*)$/

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    let rest = line
    let tsSec: number | null = null
    const tm = rest.match(tsRe)
    if (tm) {
      const a = Number(tm[1])
      const b = Number(tm[2])
      const c = tm[3] != null ? Number(tm[3]) : null
      tsSec = c != null ? a * 3600 + b * 60 + c : a * 60 + b
      rest = tm[4].trim()
    }

    let speaker: string | undefined
    const sm = rest.match(speakerRe)
    if (sm) {
      speaker = sm[1].replace(/\s+/g, ' ').trim()
      rest = sm[2].trim()
    }

    if (!rest) continue

    // A line with no timestamp and no speaker label continues the current turn.
    if (tsSec == null && speaker == null && segments.length > 0) {
      segments[segments.length - 1].text += ` ${rest}`
      continue
    }

    const startTime = tsSec != null ? chunkStartSec + tsSec : chunkStartSec
    segments.push({
      speaker: speaker ?? defaultSpeaker,
      text: rest,
      startTime,
      endTime: startTime,
      confidence: 1,
      source,
    })
  }

  return segments
}

/**
 * GeminiEngine transcribes audio using Google Gemini's multimodal API.
 *
 * Long recordings are split into ~10-minute chunks (PCM WAV via
 * splitWavIntoChunks, or MP3 via splitMp3IntoChunks — HiDock records MP3), so
 * each request stays small and never hits the output-token cap. Each chunk is
 * prompted for `[MM:SS] Speaker N: text` turns; timestamps are offset to
 * absolute time and the turns are yielded as individual TranscriptSegments.
 *
 * A chunk that returns empty, or is truncated at MAX_TOKENS after a retry,
 * throws rather than being silently dropped — a truncated transcript must
 * surface as a failure, not be stored as a complete-but-incomplete result.
 *
 * This engine is not streaming (isStreaming = false) and is not local
 * (isLocal = false) — it requires an internet connection and a Gemini API key.
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
   * Build the list of chunks to transcribe. Prefers real splitting (WAV or
   * MP3) so hour-long recordings become many small requests; falls back to a
   * single inline / Files-API part when the audio can't be split.
   */
  private async buildChunks(
    audio: Buffer,
    filePath: string,
    mimeType: string
  ): Promise<AudioChunk[]> {
    const split = splitWavIntoChunks(audio) ?? splitMp3IntoChunks(audio)
    if (split && split.length > 1) return split

    // Single call: inline when small, Files API when large (needs a filePath).
    const part =
      audio.length > GeminiEngine.INLINE_LIMIT_BYTES && filePath
        ? await this.uploadViaFilesApi(filePath, mimeType)
        : { inlineData: { mimeType, data: audio.toString('base64') } }
    // startSec/durationSec unknown for a single whole-file part.
    return [{ data: audio, mimeType, startSec: 0, durationSec: 0, part } as AudioChunk & { part: Part }]
  }

  /**
   * Transcribe an audio buffer using Gemini, yielding one TranscriptSegment
   * per speaker turn with absolute timestamps.
   *
   * The `options.context` string, if provided, is appended to the prompt to
   * give Gemini meeting context (subject, attendees, time) for better accuracy.
   * The `options.source` value produces a default speaker label ('you' for
   * mic, 'them' for system) used when a turn has no explicit "Speaker N" label.
   */
  async *transcribe(
    audio: Buffer,
    options: TranscribeOptions & { filePath?: string }
  ): AsyncIterable<TranscriptSegment> {
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured')
    }

    const filePath = (options as { filePath?: string }).filePath ?? ''
    const ext = extname(filePath).toLowerCase()
    const mimeType = MIME_TYPES[ext] ?? 'audio/wav'

    const genAI = new GoogleGenerativeAI(this.apiKey)
    const modelInstance = genAI.getGenerativeModel({ model: this.model })

    const chunks = await this.buildChunks(audio, filePath, mimeType)
    const defaultSpeaker = options.source === 'mic' ? 'you' : 'them'
    const contextSection = options.context ? `\n${options.context}` : ''

    // thinkingBudget 0: transcription needs no reasoning, and letting the
    // thinking model reason consumes the output budget (observed: 62k thought
    // tokens, 1 output token).
    const baseConfig = {
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    } as Record<string, unknown>

    const transcribeChunk = async (chunk: AudioChunk & { part?: Part }, index: number, previousTail: string): Promise<string> => {
      const part: Part =
        chunk.part ?? { inlineData: { mimeType: chunk.mimeType, data: chunk.data.toString('base64') } }
      const positionNote =
        chunks.length > 1
          ? `\nThis is segment ${index + 1} of ${chunks.length} of a longer recording.` +
            (previousTail
              ? `\nThe previous segment ended with:\n«${previousTail}»\nKeep the Speaker N numbering consistent with it.`
              : '')
          : ''
      const prompt = `Transcribe this audio recording.
The audio may be in Spanish or English - transcribe in the original language.
Format the transcription as one line per speaker turn, using EXACTLY this format:
[MM:SS] Speaker N: what the speaker said
- [MM:SS] is the time of the turn relative to the START of THIS audio segment (it starts at 00:00).
- "Speaker N" is a stable label per distinct voice (Speaker 1, Speaker 2, ...); reuse the same number for the same voice.
- Put every speaker turn on its own line. Do not merge different speakers onto one line.
Transcribe ALL speech through to the very end of the audio, including brief closings and goodbyes.${positionNote}${contextSection}
Return ONLY the transcription lines, no additional commentary.`

      const attempt = async (config: Record<string, unknown>) => {
        const result = await modelInstance.generateContentStream({
          contents: [{ role: 'user', parts: [part, { text: prompt }] }],
          generationConfig: config as never,
        })
        let out = ''
        for await (const streamChunk of result.stream) {
          out += streamChunk.text()
        }
        const response = await result.response
        return { text: out.trim(), finishReason: response.candidates?.[0]?.finishReason as string | undefined }
      }

      let res
      try {
        res = await attempt(baseConfig)
      } catch (err) {
        // If the model rejects thinkingConfig or the token cap, retry plain.
        if (String(err).includes('INVALID_ARGUMENT') || String(err).includes('thinking')) {
          res = await attempt({})
        } else {
          throw err
        }
      }

      // MAX_TOKENS on a ~10-minute chunk is unexpected (a chunk can't hold 8k
      // tokens of real speech). Retry once with a larger cap, KEEPING
      // thinkingBudget 0 (the previous code dropped it, which re-enabled
      // thinking and returned ~1 token). If the retry is clean and longer, use it.
      if (res.finishReason === 'MAX_TOKENS') {
        try {
          const retry = await attempt({ maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } })
          if (retry.text && retry.finishReason !== 'MAX_TOKENS') res = retry
        } catch {
          // Ignore retry failure; the truncation check below surfaces it.
        }
      }

      if (!res.text) {
        throw new Error(`Gemini returned an empty transcription for segment ${index + 1}/${chunks.length}`)
      }
      // A still-truncated chunk must NOT be silently stored as complete.
      if (res.finishReason === 'MAX_TOKENS') {
        throw new Error(
          `Gemini truncated segment ${index + 1}/${chunks.length} (MAX_TOKENS); transcript would be incomplete`
        )
      }
      return res.text
    }

    const onProgress = (options as { onProgress?: (done: number, total: number) => void }).onProgress
    let previousTail = ''
    let producedAny = false
    for (let i = 0; i < chunks.length; i++) {
      const text = await transcribeChunk(chunks[i], i, previousTail)
      const turns = parseTurns(text, chunks[i].startSec, defaultSpeaker, options.source)
      for (const turn of turns) {
        producedAny = true
        yield turn
      }
      previousTail = turns.length > 0 ? turns[turns.length - 1].text.slice(-300) : previousTail
      onProgress?.(i + 1, chunks.length)
    }

    // No turns at all across every chunk — an empty transcript is a failure.
    if (!producedAny) {
      throw new Error('Gemini produced no transcription')
    }
  }
}
