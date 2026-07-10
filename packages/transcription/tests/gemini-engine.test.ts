import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @google/generative-ai BEFORE importing GeminiEngine. The engine uses
// generateContentStream (streaming), so the mock returns an async `stream`
// plus a `response` promise carrying the finishReason.
const mockGenerateContentStream = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({ generateContentStream: mockGenerateContentStream }))

vi.mock('@google/generative-ai', () => {
  function GoogleGenerativeAI(_apiKey: string) {
    return { getGenerativeModel: mockGetGenerativeModel }
  }
  return { GoogleGenerativeAI }
})

import {
  GeminiEngine,
  splitWavIntoChunks,
  splitMp3IntoChunks,
  parseTurns,
  detectAudioMimeType,
} from '../src/engines/gemini-engine.js'

const oneSecond = Buffer.alloc(16000 * 2)

/** Queue a streamed response: text is chunked, finishReason optional. */
function streamResponse(text: string, finishReason = 'STOP') {
  return {
    stream: (async function* () {
      yield { text: () => text }
    })(),
    response: Promise.resolve({ candidates: [{ finishReason }] }),
  }
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iter) result.push(item)
  return result
}

// --- pure WAV builder for chunk-coverage tests -----------------------------
function buildWav(dataSize: number, byteRate: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + dataSize, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(byteRate, 24) // sampleRate == byteRate for 8-bit mono
  h.writeUInt32LE(byteRate, 28)
  h.writeUInt16LE(1, 32) // blockAlign
  h.writeUInt16LE(8, 34) // bitsPerSample
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(dataSize, 40)
  return Buffer.concat([h, Buffer.alloc(dataSize, 1)])
}

// --- pure MP3 builder (MPEG2 Layer III, 64kbps, 16kHz — the HiDock format) --
function buildMp3Frame(): Buffer {
  const frame = Buffer.alloc(288, 0)
  frame[0] = 0xff
  frame[1] = 0xf3 // MPEG2, Layer III
  frame[2] = 0x88 // bitrate index 8 (64k V2), samplerate index 2 (16000), no padding
  frame[3] = 0xc4
  return frame
}
function buildMp3(frameCount: number): Buffer {
  return Buffer.concat(Array.from({ length: frameCount }, buildMp3Frame))
}
const MP3_FRAME_DUR = 576 / 16000 // 0.036s

describe('GeminiEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateContentStream.mockResolvedValue(streamResponse('Hello world'))
  })

  it('isStreaming is false', () => {
    expect(new GeminiEngine({ apiKey: 'k' }).isStreaming).toBe(false)
  })

  it('isLocal is false', () => {
    expect(new GeminiEngine({ apiKey: 'k' }).isLocal).toBe(false)
  })

  it('isAvailable returns true when apiKey is non-empty', async () => {
    expect(await new GeminiEngine({ apiKey: 'my-key' }).isAvailable()).toBe(true)
  })

  it('isAvailable returns false when apiKey is empty', async () => {
    expect(await new GeminiEngine({ apiKey: '' }).isAvailable()).toBe(false)
  })

  it('throws when apiKey is empty and transcribe is called', async () => {
    const engine = new GeminiEngine({ apiKey: '' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(
      'Gemini API key not configured',
    )
  })

  it('yields a single segment with the transcript text', async () => {
    mockGenerateContentStream.mockResolvedValue(streamResponse('Hello world'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Hello world')
    expect(segments[0].speaker).toBe('you')
    expect(segments[0].source).toBe('mic')
    expect(segments[0].confidence).toBe(1)
  })

  it('maps system source to "them" default speaker', async () => {
    mockGenerateContentStream.mockResolvedValue(streamResponse('System audio text'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'system' }))
    expect(segments[0].speaker).toBe('them')
    expect(segments[0].source).toBe('system')
  })

  it('parses [MM:SS] Speaker N: turns into structured segments', async () => {
    mockGenerateContentStream.mockResolvedValue(
      streamResponse('[00:03] Speaker 1: Hola\n[00:07] Speaker 2: Qué tal'),
    )
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ speaker: 'Speaker 1', text: 'Hola', startTime: 3 })
    expect(segments[1]).toMatchObject({ speaker: 'Speaker 2', text: 'Qué tal', startTime: 7 })
  })

  it('throws (does not silently drop) when Gemini returns empty text', async () => {
    mockGenerateContentStream.mockResolvedValue(streamResponse('   '))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(/empty/i)
  })

  it('throws when a chunk stays truncated at MAX_TOKENS after retry', async () => {
    mockGenerateContentStream.mockResolvedValue(streamResponse('partial cut off here', 'MAX_TOKENS'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(/MAX_TOKENS/)
  })

  it('recovers when the MAX_TOKENS retry returns clean, longer text', async () => {
    mockGenerateContentStream
      .mockResolvedValueOnce(streamResponse('short', 'MAX_TOKENS'))
      .mockResolvedValueOnce(streamResponse('a much longer complete transcription', 'STOP'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(segments[0].text).toBe('a much longer complete transcription')
  })

  it('uses the configured model name', async () => {
    const engine = new GeminiEngine({ apiKey: 'test-key', model: 'gemini-3.5-flash' })
    await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-3.5-flash' })
  })

  it('includes context in the prompt when options.context is provided', async () => {
    let capturedPrompt = ''
    mockGenerateContentStream.mockImplementation(async (req: any) => {
      capturedPrompt = req.contents[0].parts.find((p: any) => p.text)?.text ?? ''
      return streamResponse('Transcript with context')
    })
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await collect(engine.transcribe(oneSecond, { source: 'mic', context: 'MEETING CONTEXT: Weekly standup' }))
    expect(capturedPrompt).toContain('MEETING CONTEXT: Weekly standup')
  })

  it('sends audio as base64 inlineData in the request', async () => {
    let capturedParts: any[] = []
    mockGenerateContentStream.mockImplementation(async (req: any) => {
      capturedParts = req.contents[0].parts
      return streamResponse('result')
    })
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const audioBuffer = Buffer.from('fake audio data')
    await collect(engine.transcribe(audioBuffer, { source: 'mic' }))
    const inlineDataPart = capturedParts.find((p: any) => p.inlineData)
    expect(inlineDataPart).toBeDefined()
    expect(inlineDataPart.inlineData.data).toBe(audioBuffer.toString('base64'))
  })

  it('propagates errors thrown by generateContentStream', async () => {
    mockGenerateContentStream.mockRejectedValue(new Error('Rate limit exceeded'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(
      'Rate limit exceeded',
    )
  })
})

describe('splitWavIntoChunks', () => {
  it('returns null for non-RIFF data', () => {
    expect(splitWavIntoChunks(Buffer.from('not a wav file at all'))).toBeNull()
  })

  it('covers the full data including the trailing partial chunk', () => {
    // byteRate 1000, target 1s => chunkBytes 1000; 3500 bytes => 4 chunks (1000*3 + 500)
    const chunks = splitWavIntoChunks(buildWav(3500, 1000), 1)
    expect(chunks).not.toBeNull()
    expect(chunks!).toHaveLength(4)
    // Total PCM covered equals the data size (each WAV chunk = 44-byte header + slice).
    const covered = chunks!.reduce((sum, c) => sum + (c.data.length - 44), 0)
    expect(covered).toBe(3500)
    // startSec is monotonic and the final chunk is the short remainder.
    expect(chunks![0].startSec).toBe(0)
    expect(chunks![3].data.length - 44).toBe(500)
    expect(chunks![3].startSec).toBeCloseTo(3, 5)
  })

  it('returns null when the data fits in a single chunk', () => {
    expect(splitWavIntoChunks(buildWav(500, 1000), 1)).toBeNull()
  })
})

describe('splitMp3IntoChunks', () => {
  it('returns null for non-MP3 data', () => {
    expect(splitMp3IntoChunks(Buffer.from('this is definitely not mp3 data'))).toBeNull()
  })

  it('splits MPEG2 Layer III frames and covers every frame including the tail', () => {
    const frameCount = 100
    const mp3 = buildMp3(frameCount)
    // target 1s => ~28 frames/chunk (0.036s each)
    const chunks = splitMp3IntoChunks(mp3, 1)
    expect(chunks).not.toBeNull()
    expect(chunks!.length).toBeGreaterThan(1)
    // Every byte of the stream is covered exactly once (no dropped tail).
    const coveredBytes = chunks!.reduce((sum, c) => sum + c.data.length, 0)
    expect(coveredBytes).toBe(mp3.length)
    // Total duration matches frameCount * frame duration.
    const totalDur = chunks!.reduce((sum, c) => sum + c.durationSec, 0)
    expect(totalDur).toBeCloseTo(frameCount * MP3_FRAME_DUR, 5)
    // Chunk start times are contiguous and increasing.
    expect(chunks![0].startSec).toBe(0)
    for (let i = 1; i < chunks!.length; i++) {
      expect(chunks![i].startSec).toBeGreaterThan(chunks![i - 1].startSec)
    }
    expect(chunks![0].mimeType).toBe('audio/mp3')
  })

  it('skips an ID3v2 tag before parsing frames', () => {
    const id3 = Buffer.alloc(10, 0)
    id3.write('ID3', 0, 'ascii')
    id3[6] = 0
    id3[7] = 0
    id3[8] = 0
    id3[9] = 20 // 20-byte tag body
    const withTag = Buffer.concat([id3, Buffer.alloc(20, 0), buildMp3(100)])
    const chunks = splitMp3IntoChunks(withTag, 1)
    expect(chunks).not.toBeNull()
    expect(chunks!.length).toBeGreaterThan(1)
  })
})

describe('parseTurns', () => {
  it('offsets chunk-relative timestamps into absolute recording time', () => {
    const segs = parseTurns('[01:00] Speaker 1: uno\n[01:30] Speaker 2: dos', 600, 'you', 'mic')
    // chunkStartSec 600 + 60s and + 90s
    expect(segs[0].startTime).toBe(660)
    expect(segs[1].startTime).toBe(690)
    expect(segs[0].speaker).toBe('Speaker 1')
  })

  it('treats unlabelled continuation lines as part of the current turn', () => {
    const segs = parseTurns('[00:05] Speaker 1: first part\nsecond part of the same turn', 0, 'you', 'mic')
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('first part second part of the same turn')
  })

  it('falls back to one turn for unstructured prose (no content dropped)', () => {
    const segs = parseTurns('just some running prose with no labels', 120, 'them', 'system')
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('just some running prose with no labels')
    expect(segs[0].speaker).toBe('them')
    expect(segs[0].startTime).toBe(120)
  })

  it('supports HH:MM:SS timestamps', () => {
    const segs = parseTurns('[01:02:03] Speaker 1: late in the call', 0, 'you', 'mic')
    expect(segs[0].startTime).toBe(3723)
  })

  // ISSUE-7: Gemini sometimes returns a whole chunk as one paragraph with the
  // `[MM:SS] Speaker N:` markers inline rather than one per line. Splitting only
  // on line starts glued them into a single 0–600s segment (seen live on Rec43).
  it('splits inline markers embedded in a single paragraph', () => {
    const paragraph =
      '[00:03] Speaker 1: hola qué tal [00:09] Speaker 2: bien y tú ' +
      '[00:12] Speaker 1: todo bien gracias'
    const segs = parseTurns(paragraph, 0, 'you', 'mic')
    expect(segs).toHaveLength(3)
    expect(segs[0]).toMatchObject({ speaker: 'Speaker 1', text: 'hola qué tal', startTime: 3 })
    expect(segs[1]).toMatchObject({ speaker: 'Speaker 2', text: 'bien y tú', startTime: 9 })
    expect(segs[2]).toMatchObject({ speaker: 'Speaker 1', text: 'todo bien gracias', startTime: 12 })
  })

  it('offsets inline-marker timestamps by chunkStartSec', () => {
    const segs = parseTurns('[00:05] Speaker 1: uno [00:20] Speaker 2: dos', 600, 'you', 'mic')
    expect(segs).toHaveLength(2)
    expect(segs[0].startTime).toBe(605)
    expect(segs[1].startTime).toBe(620)
  })

  it('handles a mix of newline-separated and inline markers', () => {
    // First two turns are on their own lines; the third is inline after the second.
    const mixed = '[00:01] Speaker 1: primero\n[00:05] Speaker 2: segundo [00:10] Speaker 1: tercero'
    const segs = parseTurns(mixed, 0, 'you', 'mic')
    expect(segs).toHaveLength(3)
    expect(segs.map((s) => s.text)).toEqual(['primero', 'segundo', 'tercero'])
    expect(segs.map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1'])
    expect(segs.map((s) => s.startTime)).toEqual([1, 5, 10])
  })

  it('inline split collapses continuation newlines within a turn', () => {
    const segs = parseTurns('[00:05] Speaker 1: first part\nsecond part [00:20] Speaker 2: done', 0, 'you', 'mic')
    expect(segs).toHaveLength(2)
    expect(segs[0].text).toBe('first part second part')
    expect(segs[1].text).toBe('done')
  })

  it('supports inline HH:MM:SS markers in a paragraph', () => {
    const segs = parseTurns('[00:00:03] Speaker 1: early [01:02:03] Speaker 2: much later', 0, 'you', 'mic')
    expect(segs).toHaveLength(2)
    expect(segs[0].startTime).toBe(3)
    expect(segs[1].startTime).toBe(3723)
  })

  it('keeps prose before the first inline marker as a leading default-speaker turn', () => {
    const segs = parseTurns('intro sin marca [00:05] Speaker 1: con marca', 0, 'them', 'system')
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ speaker: 'them', text: 'intro sin marca', startTime: 0 })
    expect(segs[1]).toMatchObject({ speaker: 'Speaker 1', text: 'con marca', startTime: 5 })
  })

  it('still splits well-formed line-per-turn output (regression)', () => {
    const segs = parseTurns('[00:03] Speaker 1: Hola\n[00:07] Speaker 2: Qué tal', 0, 'you', 'mic')
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ speaker: 'Speaker 1', text: 'Hola', startTime: 3 })
    expect(segs[1]).toMatchObject({ speaker: 'Speaker 2', text: 'Qué tal', startTime: 7 })
  })

  // The one-speaker-wall bug: Gemini diarized (Speaker 1/2 labels) but dropped
  // the [MM:SS] prefix and returned everything as ONE paragraph. Without the
  // speaker-marker fallback this collapsed into a single first-speaker turn.
  it('recovers distinct speakers from an inline diarized blob with NO timestamps', () => {
    const blob = 'Speaker 1: hola qué tal Speaker 2: bien y tú Speaker 1: todo bien gracias'
    const segs = parseTurns(blob, 0, 'you', 'mic')
    expect(segs).toHaveLength(3)
    expect(segs.map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1'])
    expect(segs.map((s) => s.text)).toEqual(['hola qué tal', 'bien y tú', 'todo bien gracias'])
    // No per-turn time available → all turns anchored at the chunk start (honest,
    // not fabricated) while remaining distinct speaker turns.
    expect(segs.map((s) => s.startTime)).toEqual([0, 0, 0])
  })

  it('keeps prose before the first bare speaker marker as a leading default turn', () => {
    const segs = parseTurns('intro sin marca Speaker 1: primero Speaker 2: segundo', 30, 'them', 'system')
    expect(segs).toHaveLength(3)
    expect(segs[0]).toMatchObject({ speaker: 'them', text: 'intro sin marca', startTime: 30 })
    expect(segs[1]).toMatchObject({ speaker: 'Speaker 1', text: 'primero' })
    expect(segs[2]).toMatchObject({ speaker: 'Speaker 2', text: 'segundo' })
  })

  it('offsets bare-speaker fallback turns by chunkStartSec', () => {
    const segs = parseTurns('Speaker 1: uno Speaker 2: dos', 600, 'you', 'mic')
    expect(segs).toHaveLength(2)
    expect(segs.every((s) => s.startTime === 600)).toBe(true)
  })

  it('does NOT over-split a single-speaker wall (one bare marker stays one turn)', () => {
    const segs = parseTurns('Speaker 1: this is a long single-speaker monologue with no other voices', 0, 'you', 'mic')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ speaker: 'Speaker 1', text: 'this is a long single-speaker monologue with no other voices' })
  })

  it('does NOT fire the speaker-marker split on the word "speaker" in prose', () => {
    // Two occurrences of "speaker" but neither is the "Speaker <number>:" label.
    const segs = parseTurns('the keynote speaker was great and the other speaker agreed', 0, 'them', 'system')
    expect(segs).toHaveLength(1)
    expect(segs[0].speaker).toBe('them')
  })
})

describe('detectAudioMimeType', () => {
  const wav = () => {
    const b = Buffer.alloc(16)
    b.write('RIFF', 0, 'ascii')
    b.write('WAVE', 8, 'ascii')
    return b
  }
  it('detects a real PCM WAV by its RIFF/WAVE header', () => {
    expect(detectAudioMimeType(wav(), '.wav')).toBe('audio/wav')
  })
  it('detects an ID3-tagged MP3 as audio/mp3', () => {
    const b = Buffer.from('ID3  ')
    expect(detectAudioMimeType(b, '.mp3')).toBe('audio/mp3')
  })
  it('detects MP3-in-.wav (MPEG frame sync) as audio/mp3, correcting the extension lie', () => {
    // HiDock's real case: MP3 frame bytes saved with a .wav extension.
    const b = Buffer.from([0xff, 0xfb, 0x90, 0x00])
    expect(detectAudioMimeType(b, '.wav')).toBe('audio/mp3')
  })
  it('detects Ogg and FLAC by signature', () => {
    expect(detectAudioMimeType(Buffer.from('OggS....'), '.ogg')).toBe('audio/ogg')
    expect(detectAudioMimeType(Buffer.from('fLaC....'), '.flac')).toBe('audio/flac')
  })
  it('falls back to the extension map, then audio/wav, for unrecognised content', () => {
    expect(detectAudioMimeType(Buffer.from('unknown bytes'), '.hda')).toBe('audio/mp3')
    expect(detectAudioMimeType(Buffer.from('unknown bytes'), '')).toBe('audio/wav')
  })
})

describe('GeminiEngine diarization prompt + end-to-end recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prompt instructs the model to diarize DISTINCT speakers with per-turn timestamps', async () => {
    let capturedPrompt = ''
    mockGenerateContentStream.mockImplementation(async (req: any) => {
      capturedPrompt = req.contents[0].parts.find((p: any) => p.text)?.text ?? ''
      return streamResponse('[00:00] Speaker 1: hola')
    })
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(capturedPrompt.toLowerCase()).toContain('distinct')
    expect(capturedPrompt).toContain('[MM:SS] Speaker N:')
    expect(capturedPrompt).toContain('NEVER return the whole recording as one line or one speaker block')
  })

  it('yields multiple distinct speakers when the model returns a no-timestamp diarized blob', async () => {
    mockGenerateContentStream.mockResolvedValue(
      streamResponse('Speaker 1: buenos días a todos Speaker 2: gracias, empecemos Speaker 1: perfecto'),
    )
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(segments).toHaveLength(3)
    expect(segments.map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1'])
  })
})
