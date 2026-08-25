import {
  FileState,
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type GenerateContentConfig,
  type Part,
} from '@google/genai'
import { extname } from 'node:path'
import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engine-interface.js'
import { NoSpeechDetectedError, TranscriptionCancelledError } from './engine-interface.js'

/**
 * ADV43-1 (round-45) — FAIL-CLOSED evaluation of a `shouldGenerate` gate,
 * invoked SYNCHRONOUSLY immediately before EVERY concrete provider call inside
 * the engine. Eligible ONLY when the callback returns EXACTLY `true`; a `false`
 * return OR any thrown error ⇒ abort the pipeline by throwing
 * TranscriptionCancelledError (never upload / generate further). A missing
 * callback ⇒ eligible (no gate configured — legacy behaviour).
 */
function assertStillEligible(shouldGenerate?: () => boolean): void {
  if (!shouldGenerate) return
  let ok = false
  try {
    ok = shouldGenerate() === true
  } catch {
    ok = false
  }
  if (!ok) throw new TranscriptionCancelledError()
}

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
 * Determine the MIME type to send to Gemini from the audio bytes themselves.
 *
 * HiDock records MP3 but saves it with a `.wav`/`.hda` extension (saveRecording
 * only renames the extension, it does not transcode), so trusting the extension
 * alone sends MP3 bytes labelled `audio/wav` — a container/MIME mismatch that
 * degrades the model's input and hurts diarization. Sniff the leading magic
 * bytes (the same signatures the chunk splitters rely on) and emit the correct,
 * DOCUMENTED Gemini audio MIME type (audio/wav, audio/mp3, audio/ogg,
 * audio/flac per https://ai.google.dev/gemini-api/docs/audio). Falls back to the
 * extension map, then `audio/wav`, when the content is unrecognised.
 */
export function detectAudioMimeType(audio: Buffer, ext: string): string {
  if (
    audio.length >= 12 &&
    audio.toString('ascii', 0, 4) === 'RIFF' &&
    audio.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'audio/wav'
  }
  if (audio.length >= 3 && audio.toString('ascii', 0, 3) === 'ID3') return 'audio/mp3'
  // MPEG audio frame sync (0xFF 0xEx) — HiDock's MP3-in-.wav starts here.
  if (audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) return 'audio/mp3'
  if (audio.length >= 4 && audio.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'
  if (audio.length >= 4 && audio.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac'
  return MIME_TYPES[ext] ?? 'audio/wav'
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

/** `Speaker N:` turn marker WITHOUT a leading timestamp, matched anywhere. The
 * exact "Speaker <number>" label the prompt requests — narrow enough that it
 * won't fire on the word "speaker" appearing in ordinary prose. */
const INLINE_SPEAKER_RE = /(Speaker\s*\d+)\s*:/g

/** A clock token returned by Gemini without the requested square brackets.
 * The model occasionally puts the timestamp at the END of each turn instead
 * of the beginning (`Speaker 1: Hello. 00:09`). */
const BARE_CLOCK_RE = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/
const TRAILING_CLOCK_RE = /(?:^|\s)(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\s*$/

function clockMatchToSeconds(match: RegExpMatchArray): number {
  const first = Number(match[1])
  const second = Number(match[2])
  return match[3] == null ? first * 60 + second : first * 3600 + second * 60 + Number(match[3])
}

function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

const TRANSCRIPT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hasSpeech: {
      type: Type.BOOLEAN,
      description: 'True only when the audio contains intelligible spoken words.'
    },
    segments: {
      type: Type.ARRAY,
      description: 'Chronological speaker turns. Each item covers at most about 30 seconds of speech.',
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: {
            type: Type.STRING,
            description: 'Turn start relative to this audio input, formatted MM:SS or HH:MM:SS.'
          },
          speaker: {
            type: Type.STRING,
            description: 'Stable anonymous voice label such as Speaker 1 or Speaker 2.'
          },
          content: {
            type: Type.STRING,
            description: 'Verbatim speech from this speaker turn only.'
          }
        },
        required: ['timestamp', 'speaker', 'content']
      }
    }
  },
  required: ['hasSpeech', 'segments']
}

// Interactions uses ordinary JSON Schema wire values (lower-case), unlike the
// GenerateContent `Type` enum used above.
const INTERACTIONS_TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    hasSpeech: { type: 'boolean' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string' },
          speaker: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['timestamp', 'speaker', 'content'],
      },
    },
  },
  required: ['hasSpeech', 'segments'],
}

interface StructuredTranscriptResponse {
  hasSpeech?: boolean
  segments?: Array<{ timestamp?: unknown; speaker?: unknown; content?: unknown }>
}

/** Gemini may return the documented timestamp field as either a start clock
 * (`00:07`) or a bounded interval (`00:07 - 00:13`). The transcript model only
 * needs the turn's start time, so preserve the first provider-supplied clock
 * instead of rejecting an otherwise valid diarized response. */
function timestampStartClock(timestamp: string): string {
  return timestamp.match(/\d{1,3}:[0-5]\d(?::[0-5]\d)?/)?.[0] ?? timestamp.replace(/^\[|\]$/g, '')
}

/** Convert schema-constrained Gemini JSON into the canonical text consumed by
 * the existing turn parser. Plain text remains accepted for compatibility with
 * legacy models and tests, but Gemini 3.5 is requested with the schema above. */
export function normalizeGeminiTranscriptResponse(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return trimmed

  try {
    const parsed = JSON.parse(trimmed) as StructuredTranscriptResponse
    if (parsed.hasSpeech === false) return '[NO_SPEECH]'
    if (!Array.isArray(parsed.segments)) return trimmed

    const lines = parsed.segments.flatMap((segment) => {
      const timestamp = typeof segment.timestamp === 'string' ? segment.timestamp.trim() : ''
      const speaker = typeof segment.speaker === 'string' ? segment.speaker.trim() : ''
      const content = typeof segment.content === 'string' ? segment.content.trim() : ''
      if (!timestamp || !speaker || !content) return []
      return [`[${timestampStartClock(timestamp)}] ${speaker}: ${content}`]
    })
    return lines.length > 0 ? lines.join('\n') : trimmed
  } catch {
    return trimmed
  }
}

function trailingClock(raw: string): { body: string; seconds: number } | null {
  const match = raw.trim().match(TRAILING_CLOCK_RE)
  if (!match) return null
  return {
    body: raw.slice(0, raw.trimEnd().length - match[0].length).replace(/\s+/g, ' ').trim(),
    seconds: clockMatchToSeconds(match)
  }
}

/**
 * Fallback splitter for when Gemini diarized the audio (it labelled the turns
 * "Speaker 1", "Speaker 2", …) but dropped the `[MM:SS]` prefix the prompt asks
 * for, returning a run like `Speaker 1: … Speaker 2: … Speaker 1: …`. Without
 * this, `parseInlineTurns` (which requires the timestamp) skips it and the
 * line-based parser cannot split markers that sit mid-line, so the whole thing
 * collapses into a single first-speaker wall — the exact one-speaker-blob
 * symptom. Split on every bare `Speaker N:` marker so the distinct speakers are
 * recovered. No per-turn time is available, so all turns share `chunkStartSec`
 * (nothing is fabricated). Returns null when fewer than two markers are present
 * (a single `Speaker 1:` wall or unlabelled prose is left to the line parser).
 */
function parseInlineSpeakerTurns(
  text: string,
  chunkStartSec: number,
  defaultSpeaker: string,
  source: 'mic' | 'system'
): TranscriptSegment[] | null {
  const markers: Array<{ markerStart: number; contentStart: number; speaker: string }> = []
  INLINE_SPEAKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_SPEAKER_RE.exec(text)) !== null) {
    markers.push({
      markerStart: m.index,
      contentStart: m.index + m[0].length,
      speaker: m[1].replace(/\s+/g, ' ').trim()
    })
  }
  if (markers.length < 2) return null

  const leadingRaw = text.slice(0, markers[0].markerStart).trim()
  const leadingClockMatch = leadingRaw.match(BARE_CLOCK_RE)
  const trailing = markers.map((marker, index) => {
    const contentEnd = index + 1 < markers.length ? markers[index + 1].markerStart : text.length
    return trailingClock(text.slice(marker.contentStart, contentEnd))
  })
  const timedTurnCount = trailing.filter((value) => value !== null).length

  // Gemini's observed malformed format is a standalone initial boundary followed
  // by trailing turn boundaries. Recover those provider-supplied times instead of
  // creating a bogus default-speaker `00:00` turn and anchoring every real turn at
  // the chunk start. Require at least two timed turns so ordinary spoken clock
  // references at the end of one sentence are never stripped as metadata.
  if (timedTurnCount >= 2 && (leadingClockMatch !== null || timedTurnCount === markers.length)) {
    const segments: TranscriptSegment[] = []
    let nextStart = chunkStartSec + (leadingClockMatch ? clockMatchToSeconds(leadingClockMatch) : 0)
    for (let i = 0; i < markers.length; i++) {
      const value = trailing[i]
      const contentEnd = i + 1 < markers.length ? markers[i + 1].markerStart : text.length
      const raw = text.slice(markers[i].contentStart, contentEnd)
      const body = (value?.body ?? raw.replace(/\s+/g, ' ').trim()).trim()
      if (!body) continue
      const suppliedEnd = value ? chunkStartSec + value.seconds : nextStart
      // A malformed/decreasing provider boundary remains visibly invalid and is
      // caught by the quality gate; never fabricate a plausible timestamp.
      const endTime = suppliedEnd >= nextStart ? suppliedEnd : nextStart
      segments.push({
        speaker: markers[i].speaker,
        text: body,
        startTime: nextStart,
        endTime,
        confidence: 1,
        source
      })
      if (value && suppliedEnd >= nextStart) nextStart = suppliedEnd
    }
    return segments.length > 0 ? segments : null
  }

  const segments: TranscriptSegment[] = []
  const push = (speaker: string, raw: string) => {
    const body = raw.replace(/\s+/g, ' ').trim()
    if (body) {
      segments.push({ speaker, text: body, startTime: chunkStartSec, endTime: chunkStartSec, confidence: 1, source })
    }
  }
  // Any text before the first marker is a leading turn with the default speaker.
  push(defaultSpeaker, text.slice(0, markers[0].markerStart))
  for (let i = 0; i < markers.length; i++) {
    const contentEnd = i + 1 < markers.length ? markers[i + 1].markerStart : text.length
    push(markers[i].speaker, text.slice(markers[i].contentStart, contentEnd))
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

  // Second fallback: the model diarized with `Speaker N:` labels but omitted the
  // `[MM:SS]` prefix. Split on the bare speaker markers so a multi-speaker
  // paragraph doesn't collapse into a single first-speaker wall.
  const speakerSegments = parseInlineSpeakerTurns(text, chunkStartSec, defaultSpeaker, source)
  if (speakerSegments) return speakerSegments

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

/** A multi-turn response must carry at least two distinct provider timestamps.
 * Otherwise every line would render at the chunk boundary (0:00, 10:00,
 * 20:00...) and must be retried or rejected rather than persisted as accurate. */
export function hasReliableTurnTiming(text: string): boolean {
  const turns = parseTurns(text, 0, 'you', 'mic')
  if (turns.length < 2) return true
  if (new Set(turns.map((turn) => turn.startTime)).size < 2) return false
  return turns.every((turn, index) => index === 0 || turn.startTime >= turns[index - 1].startTime)
}

/** Gemini occasionally emits valid-looking timing for a handful of turns and
 * then collapses several minutes of a two-person conversation into one giant
 * speaker block. The prompt requires a boundary on every speaker change and at
 * least every ~30 seconds; allow generous model variance, but never accept the
 * 1,130-word / 578-second wall observed in the live Sync Arturo-Seba result. */
export function hasReliableTurnStructure(text: string): boolean {
  const turns = parseTurns(text, 0, 'you', 'mic')
  if (turns.length === 0) return false

  return turns.every((turn) => {
    const body = turn.text.trim()
    const words = body ? body.split(/\s+/u).length : 0
    return words <= 180 && body.length <= 1600
  })
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

  /** The Interactions client defaults to 60 seconds, which is too short for a
   * twenty-minute audio range and surfaces only `Request timed out.`. Bound each
   * range generously, while leaving retries to the app queue so a timed-out
   * interaction POST is not silently duplicated by the SDK. */
  static readonly INTERACTION_REQUEST_TIMEOUT_MS = 10 * 60 * 1000

  /** Rolling request size for stored recordings. Twenty minutes leaves a very
   * wide margin below Gemini's output ceiling, while recent timestamped turns
   * are carried forward to preserve speaker-label and conversational context. */
  static readonly ROLLING_CHUNK_SECONDS = 20 * 60

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

  private async uploadAudioFile(
    genAI: GoogleGenAI,
    filePath: string,
    mimeType: string,
    shouldGenerate?: () => boolean
  ): Promise<{ name: string; uri: string; mimeType: string }> {
    assertStillEligible(shouldGenerate)
    let file = await genAI.files.upload({ file: filePath, config: { mimeType } })
    const deadline = Date.now() + 5 * 60 * 1000
    while (file.state === FileState.PROCESSING) {
      if (Date.now() > deadline) {
        throw new Error('Gemini Files API: timed out waiting for file processing')
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
      assertStillEligible(shouldGenerate)
      if (!file.name) throw new Error('Gemini Files API: uploaded file has no resource name')
      file = await genAI.files.get({ name: file.name })
    }
    if (file.state === FileState.FAILED) {
      throw new Error('Gemini Files API: file processing failed')
    }
    if (!file.name || !file.uri) {
      throw new Error('Gemini Files API: processed file is missing its resource name or URI')
    }
    return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? mimeType }
  }

  /**
   * Upload a large audio file via the Gemini Files API and wait for it to
   * finish server-side processing, returning a fileData Part for
   * generateContent. Required for audio above INLINE_LIMIT_BYTES.
   */
  private async uploadViaFilesApi(
    genAI: GoogleGenAI,
    filePath: string,
    mimeType: string,
    shouldGenerate?: () => boolean
  ): Promise<Part> {
    const file = await this.uploadAudioFile(genAI, filePath, mimeType, shouldGenerate)
    return { fileData: { mimeType: file.mimeType, fileUri: file.uri } }
  }

  /**
   * Build rolling audio requests. Parseable WAV/MP3 recordings longer than
   * twenty minutes are split at valid sample/frame boundaries. Each response is
   * therefore far below the provider output ceiling; the caller carries recent
   * timestamped turns into the following request as rolling context.
   */
  private async buildChunks(
    genAI: GoogleGenAI,
    audio: Buffer,
    filePath: string,
    mimeType: string,
    _durationSeconds?: number,
    shouldGenerate?: () => boolean
  ): Promise<AudioChunk[]> {
    const supportsWholeRecording = /^gemini-(?:3(?:\.|$)|[4-9])/i.test(this.model)
    if (supportsWholeRecording) {
      const rolling =
        splitWavIntoChunks(audio, GeminiEngine.ROLLING_CHUNK_SECONDS) ??
        splitMp3IntoChunks(audio, GeminiEngine.ROLLING_CHUNK_SECONDS)
      if (rolling && rolling.length > 1) return rolling
    } else {
      const split = splitWavIntoChunks(audio) ?? splitMp3IntoChunks(audio)
      if (split && split.length > 1) return split
    }

    // Single call: inline when small, Files API when large (needs a filePath).
    const part =
      audio.length > GeminiEngine.INLINE_LIMIT_BYTES && filePath
        ? await this.uploadViaFilesApi(genAI, filePath, mimeType, shouldGenerate)
        : { inlineData: { mimeType, data: audio.toString('base64') } }
    // startSec/durationSec unknown for a single whole-file part.
    return [{ data: audio, mimeType, startSec: 0, durationSec: 0, part } as AudioChunk & { part: Part }]
  }

  private async transcribeInteractionRange(
    genAI: GoogleGenAI,
    file: { uri: string; mimeType: string },
    startSec: number,
    endSec: number,
    source: 'mic' | 'system',
    previousInteractionId: string | undefined,
    context: string,
    shouldGenerate?: () => boolean,
    repair = false
  ): Promise<{ segments: TranscriptSegment[]; interactionId: string }> {
    const splitRange = async (): Promise<{ segments: TranscriptSegment[]; interactionId: string }> => {
      if (endSec - startSec <= 60) {
        throw new Error(
          `Gemini could not produce a complete, reliable transcript for ${formatTimestamp(startSec)}–${formatTimestamp(endSec)}`
        )
      }
      const midpoint = Math.floor((startSec + endSec) / 2)
      const left = await this.transcribeInteractionRange(
        genAI,
        file,
        startSec,
        midpoint,
        source,
        previousInteractionId,
        context,
        shouldGenerate
      )
      const right = await this.transcribeInteractionRange(
        genAI,
        file,
        midpoint,
        endSec,
        source,
        left.interactionId,
        context,
        shouldGenerate
      )
      return { segments: [...left.segments, ...right.segments], interactionId: right.interactionId }
    }

    assertStillEligible(shouldGenerate)
    const range = `${formatTimestamp(startSec)} through ${formatTimestamp(endSec)}`
    const prompt = `Transcribe ONLY the ${range} interval of the audio in the original language.
Use absolute timestamps from the start of the full recording, not timestamps relative to this interval.
Identify distinct speakers by voice and keep the same Speaker N labels established earlier in this interaction chain.
Return one segment for every speaker change and at least every 30 seconds. Each content value must contain one speaker only and stay under 120 words.
Do not repeat speech before ${formatTimestamp(startSec)} or include speech after ${formatTimestamp(endSec)}.
If this interval has no intelligible speech, set hasSpeech to false and return an empty segments array.
Calendar and meeting context are spelling hints only; never invent speech from them.${context ? `\n${context}` : ''}${
      repair
        ? '\nREPAIR: The prior result for this interval was incomplete or structurally invalid. Re-listen and return truthful, increasing, absolute timestamps with separate speaker turns.'
        : ''
    }`

    const input: Array<Record<string, unknown>> = []
    if (!previousInteractionId) {
      input.push({ type: 'audio', uri: file.uri, mime_type: file.mimeType })
    }
    input.push({ type: 'text', text: prompt })

    // The Interactions wire contract intentionally uses snake_case. @google/genai
    // 2.0.0's TextResponseFormat type incorrectly spells mime_type as mimeType;
    // the live Developer API rejects that spelling, so keep the documented wire
    // name and isolate the SDK typing mismatch at this boundary.
    const interaction = await genAI.interactions.create({
      model: this.model,
      input,
      previous_interaction_id: previousInteractionId,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: INTERACTIONS_TRANSCRIPT_SCHEMA,
      },
      generation_config: {
        max_output_tokens: 16384,
        thinking_level: 'minimal',
      },
    } as never, {
      timeout: GeminiEngine.INTERACTION_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    }) as unknown as {
      id: string
      status: 'in_progress' | 'requires_action' | 'completed' | 'failed' | 'cancelled' | 'incomplete'
      steps?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>
    }

    if (interaction.status === 'incomplete') return splitRange()
    if (interaction.status !== 'completed') {
      throw new Error(`Gemini interaction ${interaction.status} for ${range}`)
    }

    const raw = (interaction.steps ?? [])
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content ?? [])
      .filter((content) => content.type === 'text')
      .map((content) => content.text ?? '')
      .join('')
    const normalized = normalizeGeminiTranscriptResponse(raw)
    if (/^\[?NO[_ ]SPEECH\]?\.?$/i.test(normalized.trim())) {
      return { segments: [], interactionId: interaction.id }
    }

    const defaultSpeaker = source === 'mic' ? 'you' : 'them'
    const segments = parseTurns(normalized, 0, defaultSpeaker, source)
    const reliable =
      raw.length > 0 &&
      hasReliableTurnTiming(normalized) &&
      hasReliableTurnStructure(normalized) &&
      segments.every((segment) => segment.startTime >= startSec && segment.startTime <= endSec)
    if (!reliable) {
      if (!repair) {
        return this.transcribeInteractionRange(
          genAI,
          file,
          startSec,
          endSec,
          source,
          previousInteractionId,
          context,
          shouldGenerate,
          true
        )
      }
      return splitRange()
    }
    return { segments, interactionId: interaction.id }
  }

  private async transcribeLongRecordingWithInteractions(
    genAI: GoogleGenAI,
    filePath: string,
    mimeType: string,
    durationSeconds: number,
    options: TranscribeOptions
  ): Promise<TranscriptSegment[]> {
    const shouldGenerate = options.shouldGenerate
    const uploaded = await this.uploadAudioFile(genAI, filePath, mimeType, shouldGenerate)
    const totalRanges = Math.ceil(durationSeconds / GeminiEngine.ROLLING_CHUNK_SECONDS)
    const allSegments: TranscriptSegment[] = []
    let previousInteractionId: string | undefined
    try {
      for (let index = 0; index < totalRanges; index++) {
        const startSec = index * GeminiEngine.ROLLING_CHUNK_SECONDS
        const endSec = Math.min(durationSeconds, startSec + GeminiEngine.ROLLING_CHUNK_SECONDS)
        const result = await this.transcribeInteractionRange(
          genAI,
          uploaded,
          startSec,
          endSec,
          options.source,
          previousInteractionId,
          options.context ?? '',
          shouldGenerate
        )
        previousInteractionId = result.interactionId
        for (const segment of result.segments) {
          const previous = allSegments[allSegments.length - 1]
          if (
            previous &&
            previous.startTime === segment.startTime &&
            previous.speaker === segment.speaker &&
            previous.text === segment.text
          ) continue
          allSegments.push(segment)
        }
        options.onProgress?.(index + 1, totalRanges)
      }
    } finally {
      try {
        await genAI.files.delete({ name: uploaded.name })
      } catch {
        // Uploaded Gemini files expire automatically; cleanup failure must not
        // turn a successfully validated transcript into an application failure.
      }
    }
    if (allSegments.length === 0) throw new NoSpeechDetectedError()
    return allSegments
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

    // ADV43-1 (round-45) — fail-closed eligibility gate threaded from the caller.
    // Re-checked synchronously before EVERY concrete provider call below (upload,
    // each chunk generation, each retry). The caller already read the file bytes
    // before invoking transcribe, so this first check covers the post-file-read
    // window before any upload/generation happens.
    const shouldGenerate = (options as { shouldGenerate?: () => boolean }).shouldGenerate
    assertStillEligible(shouldGenerate)

    const filePath = (options as { filePath?: string }).filePath ?? ''
    const ext = extname(filePath).toLowerCase()
    // Sniff the actual bytes rather than trusting the extension: HiDock's MP3
    // recordings are saved as `.wav`/`.hda`, and a wrong MIME degrades Gemini's
    // input (and thus diarization). See detectAudioMimeType.
    const mimeType = detectAudioMimeType(audio, ext)

    const genAI = new GoogleGenAI({ apiKey: this.apiKey })

    if (
      /^gemini-(?:3(?:\.|$)|[4-9])/i.test(this.model) &&
      filePath &&
      options.durationSeconds &&
      options.durationSeconds > GeminiEngine.ROLLING_CHUNK_SECONDS
    ) {
      const segments = await this.transcribeLongRecordingWithInteractions(
        genAI,
        filePath,
        mimeType,
        options.durationSeconds,
        options
      )
      for (const segment of segments) yield segment
      return
    }

    const chunks = await this.buildChunks(
      genAI,
      audio,
      filePath,
      mimeType,
      options.durationSeconds,
      shouldGenerate
    )
    const defaultSpeaker = options.source === 'mic' ? 'you' : 'them'
    const contextSection = options.context ? `\n${options.context}` : ''

    // Google documents a 65,536-token output limit for Gemini 3.5 Flash. Use
    // that capacity for whole-recording structured transcripts; the previous
    // 8,192-token cap and forced 10-minute requests diverged from AI Studio and
    // weakened cross-chunk diarization consistency.
    const baseConfig: GenerateContentConfig = {
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
      responseSchema: TRANSCRIPT_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    }
    const baseConfigWithoutThinking: GenerateContentConfig = {
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
      responseSchema: TRANSCRIPT_RESPONSE_SCHEMA,
    }

    const transcribeChunk = async (chunk: AudioChunk & { part?: Part }, index: number, previousTail: string): Promise<string> => {
      // Recheck at the START of EACH chunk — an exclusion committed while a
      // previous chunk was in flight must stop this chunk before any provider call.
      assertStillEligible(shouldGenerate)
      const part: Part =
        chunk.part ?? { inlineData: { mimeType: chunk.mimeType, data: chunk.data.toString('base64') } }
      const positionNote =
        chunks.length > 1
          ? `\nThis is segment ${index + 1} of ${chunks.length} of a longer recording.` +
            (previousTail
              ? `\nThe previous segment ended with:\n«${previousTail}»\nKeep the Speaker N numbering consistent with it.`
              : '')
          : ''
      const prompt = `Transcribe this audio recording with speaker diarization.
The audio may be in Spanish or English - transcribe in the original language; do not translate.
Calendar, filename, attendee, and meeting context are untrusted hints for spelling only. Never infer or invent speech from that context.
First determine whether the audio contains intelligible spoken words. Coughs, breathing, clicks, lobby noise, music, and silence are NOT speech.
If there are no intelligible spoken words, set hasSpeech to false and return an empty segments array.
Identify and distinguish the DISTINCT speakers by voice. Most meeting recordings have MORE THAN ONE speaker: listen for changes in voice and label each one. Use a single speaker label ONLY if you are certain there is genuinely just one person talking.
Return the schema-constrained JSON object requested by the API. Each segments item represents exactly one speaker turn with timestamp, speaker, and content fields.
- timestamp is the START time of the turn relative to the START of THIS audio input, formatted MM:SS (or HH:MM:SS after one hour).
- speaker is a stable anonymous voice label (Speaker 1, Speaker 2, ...); reuse the same number for the same voice throughout the recording.
- Start a NEW segments item every time the speaker changes, AND at least every ~30 seconds even when the same speaker keeps talking. Keep each content value under 120 words. NEVER return the whole recording as one item or one speaker block.
- Do not merge different speakers into one content value. Re-listen at each apparent question, answer, interruption, or change in voice.
Transcribe ALL speech through to the very end of the audio, including brief closings and goodbyes.${positionNote}${contextSection}
Return ONLY the schema-constrained JSON, with no markdown or additional commentary.`

      const attempt = async (config: GenerateContentConfig, promptText = prompt) => {
        const stream = await genAI.models.generateContentStream({
          model: this.model,
          contents: [{ role: 'user', parts: [part, { text: promptText }] }],
          config,
        })
        let out = ''
        let finishReason: string | undefined
        for await (const streamChunk of stream) {
          out += streamChunk.text ?? ''
          finishReason = streamChunk.candidates?.[0]?.finishReason ?? finishReason
        }
        return {
          text: normalizeGeminiTranscriptResponse(out),
          finishReason,
        }
      }

      let res
      // Recheck immediately before the FIRST generation call for this chunk.
      assertStillEligible(shouldGenerate)
      try {
        res = await attempt(baseConfig)
      } catch (err) {
        if (err instanceof TranscriptionCancelledError) throw err
        // If the model rejects thinkingConfig or the token cap, retry plain.
        if (String(err).includes('INVALID_ARGUMENT') || String(err).includes('thinking')) {
          // Recheck before the plain-config RETRY (a fresh provider call).
          assertStillEligible(shouldGenerate)
          res = await attempt(baseConfigWithoutThinking)
        } else {
          throw err
        }
      }

      // MAX_TOKENS is unexpected at the model's documented 65k output limit.
      // Retry once while keeping minimal thinking so reasoning does not consume
      // the transcription output budget. If the retry is clean and longer, use it.
      if (res.finishReason === 'MAX_TOKENS') {
        // Recheck before the MAX_TOKENS RETRY (another fresh provider call).
        assertStillEligible(shouldGenerate)
        try {
          const retry = await attempt(baseConfig)
          if (retry.text && retry.finishReason !== 'MAX_TOKENS') res = retry
        } catch {
          // Ignore retry failure; the truncation check below surfaces it.
        }
      }


      // Repeated timestamps and oversized speaker walls are both unusable.
      // Retry once with an explicit acoustic/format repair, then fail closed
      // instead of saving a confidently wrong transcript as "Transcribed".
      const hasSpeech = res.text && !/^\[?NO[_ ]SPEECH\]?\.?$/i.test(res.text.trim())
      const hasReliableShape = res.text
        ? hasReliableTurnTiming(res.text) && hasReliableTurnStructure(res.text)
        : false
      if (hasSpeech && !hasReliableShape) {
        assertStillEligible(shouldGenerate)
        const repairPrompt = `${prompt}
IMPORTANT TRANSCRIPT REPAIR: Your previous response had missing/repeated timing or collapsed minutes of conversation into an oversized speaker item. Re-listen to the audio. Return truthful increasing timestamps, split every voice change into its own segments item, and split a continuing speaker at least every 30 seconds. No content value may exceed 120 words.`
        const retry = await attempt(
          baseConfig,
          repairPrompt
        )
        if (
          !retry.text ||
          retry.finishReason === 'MAX_TOKENS' ||
          !hasReliableTurnTiming(retry.text) ||
          !hasReliableTurnStructure(retry.text)
        ) {
          throw new Error(
            `Gemini returned audio ${index + 1}/${chunks.length} without reliable speaker-turn timing and structure`
          )
        }
        res = retry
      }

      if (!res.text) {
        throw new Error(`Gemini returned an empty transcription for segment ${index + 1}/${chunks.length}`)
      }
      if (/^\[?NO[_ ]SPEECH\]?\.?$/i.test(res.text.trim())) {
        throw new NoSpeechDetectedError()
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
      if (turns.length > 0) {
        previousTail = turns
          .slice(-6)
          .map((turn) => `[${formatTimestamp(turn.startTime)}] ${turn.speaker}: ${turn.text}`)
          .join('\n')
          .slice(-2000)
      }
      onProgress?.(i + 1, chunks.length)
    }

    // No turns at all across every chunk — an empty transcript is a failure.
    if (!producedAny) {
      throw new Error('Gemini produced no transcription')
    }
  }
}
