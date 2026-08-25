import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @google/genai BEFORE importing GeminiEngine. The current SDK returns
// an async generator directly from models.generateContentStream().
const mockGenerateContentStream = vi.fn()
const mockInteractionsCreate = vi.fn()
const mockFilesUpload = vi.fn()
const mockFilesGet = vi.fn()
const mockFilesDelete = vi.fn()

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = { generateContentStream: mockGenerateContentStream }
    interactions = { create: mockInteractionsCreate }
    files = { upload: mockFilesUpload, get: mockFilesGet, delete: mockFilesDelete }
  }
  return {
    GoogleGenAI,
    FileState: { PROCESSING: 'PROCESSING', ACTIVE: 'ACTIVE', FAILED: 'FAILED' },
    ThinkingLevel: { MINIMAL: 'MINIMAL' },
    Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN' },
  }
})

import {
  GeminiEngine,
  splitWavIntoChunks,
  splitMp3IntoChunks,
  parseTurns,
  detectAudioMimeType,
  hasReliableTurnTiming,
  hasReliableTurnStructure,
  normalizeGeminiTranscriptResponse,
} from '../src/engines/gemini-engine.js'
import { NoSpeechDetectedError, TranscriptionCancelledError } from '../src/engines/engine-interface.js'

const oneSecond = Buffer.alloc(16000 * 2)

/** Queue a streamed response: text is chunked, finishReason optional. */
function streamResponse(text: string, finishReason = 'STOP') {
  return (async function* () {
    yield { text, candidates: [{ finishReason }] }
  })()
}

function interactionResponse(
  value: unknown,
  id: string,
  status: 'completed' | 'incomplete' = 'completed'
) {
  return {
    id,
    status,
    steps: status === 'completed'
      ? [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(value) }] }]
      : [],
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
    mockFilesDelete.mockResolvedValue(undefined)
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

  it('maps the provider no-speech sentinel to a terminal content outcome', async () => {
    mockGenerateContentStream.mockResolvedValue(streamResponse('[NO_SPEECH]'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toBeInstanceOf(
      NoSpeechDetectedError,
    )
  })

  it('tells Gemini that meeting context is never evidence of speech', async () => {
    mockGenerateContentStream.mockResolvedValue(streamResponse('[00:00] Speaker 1: Hola'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await collect(engine.transcribe(oneSecond, { source: 'mic', context: 'Meeting: Secret project' }))

    const request = mockGenerateContentStream.mock.calls[0][0]
    const prompt = request.contents[0].parts[1].text
    expect(prompt).toContain('Never infer or invent speech from that context')
    expect(prompt).toContain('set hasSpeech to false')
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
    expect(mockGenerateContentStream.mock.calls[0][0].model).toBe('gemini-3.5-flash')
  })

  it('requests a schema-constrained transcript with the full Gemini 3.5 output budget', async () => {
    const engine = new GeminiEngine({ apiKey: 'test-key', model: 'gemini-3.5-flash' })
    await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    const config = mockGenerateContentStream.mock.calls[0][0].config
    expect(config).toMatchObject({
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
      responseSchema: {
        type: 'OBJECT',
        required: ['hasSpeech', 'segments']
      }
    })
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

  it('uses the current SDK Files API for recordings above the inline limit', async () => {
    mockFilesUpload.mockResolvedValue({
      name: 'files/recording-1',
      state: 'ACTIVE',
      mimeType: 'audio/mp3',
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/recording-1',
    })
    mockGenerateContentStream.mockResolvedValue(streamResponse('[00:00] Speaker 1: Hola'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const audioBuffer = Buffer.alloc(GeminiEngine.INLINE_LIMIT_BYTES + 1)

    await collect(engine.transcribe(audioBuffer, { source: 'mic', filePath: 'recording.hda' }))

    expect(mockFilesUpload).toHaveBeenCalledWith({
      file: 'recording.hda',
      config: { mimeType: 'audio/mp3' },
    })
    expect(mockGenerateContentStream.mock.calls[0][0].contents[0].parts[0]).toEqual({
      fileData: {
        mimeType: 'audio/mp3',
        fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/recording-1',
      },
    })
  })

  it('chains bounded Interactions ranges for recordings over twenty minutes', async () => {
    const audioBuffer = buildWav(1201, 1)
    mockFilesUpload.mockResolvedValue({
      name: 'files/long-recording',
      state: 'ACTIVE',
      mimeType: 'audio/wav',
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/long-recording',
    })
    mockInteractionsCreate
      .mockResolvedValueOnce(interactionResponse({
        hasSpeech: true,
        segments: [
          { timestamp: '00:00', speaker: 'Speaker 1', content: 'primera parte' },
          // Reaches the end of the requested range; a range whose turns stop
          // far short of it is now re-requested as truncated.
          { timestamp: '19:50', speaker: 'Speaker 2', content: 'cierre de la primera parte' },
        ],
      }, 'interaction-1'))
      .mockResolvedValueOnce(interactionResponse({
        hasSpeech: true,
        segments: [{ timestamp: '20:00', speaker: 'Speaker 1', content: 'segunda parte' }],
      }, 'interaction-2'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })

    const segments = await collect(engine.transcribe(audioBuffer, {
      source: 'mic',
      filePath: 'long-recording.wav',
      durationSeconds: 1201,
    }))

    expect(mockGenerateContentStream).not.toHaveBeenCalled()
    expect(mockInteractionsCreate).toHaveBeenCalledTimes(2)
    expect(segments.map((segment) => segment.text)).toEqual([
      'primera parte',
      'cierre de la primera parte',
      'segunda parte',
    ])
    expect(segments.map((segment) => segment.startTime)).toEqual([0, 1190, 1200])
    expect(mockInteractionsCreate.mock.calls[0][0].input[0]).toMatchObject({
      type: 'audio',
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/long-recording',
    })
    expect(mockInteractionsCreate.mock.calls[1][0]).toMatchObject({
      previous_interaction_id: 'interaction-1',
    })
    expect(mockInteractionsCreate.mock.calls[1][0].input).toHaveLength(1)
    expect(mockInteractionsCreate.mock.calls[1][0].input[0].text).toContain('20:00 through 20:01')
    expect(mockInteractionsCreate).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      {
        timeout: GeminiEngine.INTERACTION_REQUEST_TIMEOUT_MS,
        maxRetries: 0,
      },
    )
    expect(GeminiEngine.INTERACTION_REQUEST_TIMEOUT_MS).toBe(10 * 60 * 1000)
    expect(mockFilesDelete).toHaveBeenCalledWith({ name: 'files/long-recording' })
  })

  it('subdivides an incomplete max-token range instead of saving a cut-off transcript', async () => {
    mockFilesUpload.mockResolvedValue({
      name: 'files/long-recording',
      state: 'ACTIVE',
      mimeType: 'audio/wav',
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/long-recording',
    })
    mockInteractionsCreate
      .mockResolvedValueOnce(interactionResponse({}, 'incomplete-range', 'incomplete'))
      .mockResolvedValueOnce(interactionResponse({
        hasSpeech: true,
        segments: [
          { timestamp: '00:00', speaker: 'Speaker 1', content: 'parte uno' },
          { timestamp: '09:50', speaker: 'Speaker 2', content: 'fin de parte uno' },
        ],
      }, 'range-a'))
      .mockResolvedValueOnce(interactionResponse({
        hasSpeech: true,
        segments: [
          { timestamp: '10:00', speaker: 'Speaker 2', content: 'parte dos' },
          { timestamp: '19:50', speaker: 'Speaker 1', content: 'fin de parte dos' },
        ],
      }, 'range-b'))
      .mockResolvedValueOnce(interactionResponse({
        hasSpeech: true,
        segments: [{ timestamp: '20:00', speaker: 'Speaker 1', content: 'final' }],
      }, 'range-c'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })

    const segments = await collect(engine.transcribe(buildWav(1201, 1), {
      source: 'mic',
      filePath: 'long-recording.wav',
      durationSeconds: 1201,
    }))

    expect(segments.map((segment) => segment.text)).toEqual([
      'parte uno',
      'fin de parte uno',
      'parte dos',
      'fin de parte dos',
      'final',
    ])
    expect(segments.map((segment) => segment.startTime)).toEqual([0, 590, 600, 1190, 1200])
    expect(mockInteractionsCreate).toHaveBeenCalledTimes(4)
    expect(mockInteractionsCreate.mock.calls[2][0].previous_interaction_id).toBe('range-a')
    expect(mockInteractionsCreate.mock.calls[3][0].previous_interaction_id).toBe('range-b')
  })

  it('propagates errors thrown by generateContentStream', async () => {
    mockGenerateContentStream.mockRejectedValue(new Error('Rate limit exceeded'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(
      'Rate limit exceeded',
    )
  })
})

// ADV43-1 (round-45) — the fail-closed shouldGenerate gate must be re-checked
// SYNCHRONOUSLY inside the engine immediately before EVERY concrete provider
// call (upload, each chunk generation, each retry). A false return or a throw
// aborts the pipeline with TranscriptionCancelledError and issues NO further
// provider call.
describe('GeminiEngine shouldGenerate gate (round-45 ADV43-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateContentStream.mockResolvedValue(streamResponse('[00:00] Speaker 1: hola'))
  })

  it('false up front ⇒ aborts before ANY provider call', async () => {
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(
      collect(engine.transcribe(oneSecond, { source: 'mic', shouldGenerate: () => false }))
    ).rejects.toThrow(TranscriptionCancelledError)
    expect(mockGenerateContentStream).not.toHaveBeenCalled()
  })

  it('a shouldGenerate that THROWS is fail-closed ⇒ no provider call', async () => {
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(
      collect(
        engine.transcribe(oneSecond, {
          source: 'mic',
          shouldGenerate: () => {
            throw new Error('eligibility lookup failed')
          },
        })
      )
    ).rejects.toThrow(TranscriptionCancelledError)
    expect(mockGenerateContentStream).not.toHaveBeenCalled()
  })

  it('exclusion committed after the first attempt ⇒ MAX_TOKENS retry is NOT called', async () => {
    let excluded = false
    mockGenerateContentStream.mockImplementation(async () => {
      // The provider "returned" — simulate the owner excluding the recording
      // while this response was in flight; the retry must not fire.
      excluded = true
      return streamResponse('partial cut off', 'MAX_TOKENS')
    })
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(
      collect(engine.transcribe(oneSecond, { source: 'mic', shouldGenerate: () => !excluded }))
    ).rejects.toThrow(TranscriptionCancelledError)
    // Exactly ONE call (the first attempt); the MAX_TOKENS retry was gated out.
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
  })

  it('exclusion committed between chunks ⇒ the next chunk is NOT sent to the provider', async () => {
    // A >600s MP3 splits into multiple ~10-minute chunks. Exclude after chunk 0
    // generates; chunk 1 must never reach generateContentStream.
    const frames = 20000 // 20000 * 0.036s ≈ 720s ⇒ 2 chunks at the 600s target
    const mp3 = buildMp3(frames)
    // Sanity: this really splits into more than one chunk.
    expect(splitMp3IntoChunks(mp3)!.length).toBeGreaterThan(1)

    let excluded = false
    mockGenerateContentStream.mockImplementation(async () => {
      excluded = true // exclude while chunk 0's response is in flight
      return streamResponse('[00:00] Speaker 1: primer segmento')
    })
    // Legacy configured models retain the old chunked request path. Gemini 3.5
    // keeps ordinary recordings whole for cross-recording speaker context.
    const engine = new GeminiEngine({ apiKey: 'test-key', model: 'gemini-2.5-flash' })
    await expect(
      collect(engine.transcribe(mp3, { source: 'mic', shouldGenerate: () => !excluded }))
    ).rejects.toThrow(TranscriptionCancelledError)
    // Only chunk 0 was generated; the between-chunks recheck aborted chunk 1.
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
  })

  it('control: a gate that stays true transcribes normally', async () => {
    mockGenerateContentStream.mockResolvedValue(streamResponse('[00:03] Speaker 1: hola'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(
      engine.transcribe(oneSecond, { source: 'mic', shouldGenerate: () => true })
    )
    expect(segments).toHaveLength(1)
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
  })

  it('no gate configured (undefined) ⇒ unchanged legacy behaviour', async () => {
    mockGenerateContentStream.mockResolvedValue(streamResponse('[00:03] Speaker 1: hola'))
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(segments).toHaveLength(1)
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
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

  it('recovers Gemini trailing timestamps without creating a bogus default-speaker turn', () => {
    const malformed = [
      '00:00',
      'Speaker 1: Hello. 00:09',
      'Speaker 1: Hello, ¿me escuchás? 00:11',
      'Speaker 2: Yo no te escucho, ¿me escuchás? 00:13',
      'Speaker 1: Ahí sí, ¿cómo va? 00:15'
    ].join('\n')
    const segs = parseTurns(malformed, 0, 'you', 'mic')

    expect(segs).toHaveLength(4)
    expect(segs.map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 1', 'Speaker 2', 'Speaker 1'])
    expect(segs.map((s) => s.startTime)).toEqual([0, 9, 11, 13])
    expect(segs.map((s) => s.endTime)).toEqual([9, 11, 13, 15])
    expect(segs.map((s) => s.text)).toEqual([
      'Hello.',
      'Hello, ¿me escuchás?',
      'Yo no te escucho, ¿me escuchás?',
      'Ahí sí, ¿cómo va?'
    ])
    expect(segs.some((s) => s.speaker === 'you')).toBe(false)
  })

  it('offsets recovered trailing timestamps by the audio chunk start', () => {
    const segs = parseTurns('00:00 Speaker 1: uno 00:05 Speaker 2: dos 00:08', 1200, 'you', 'mic')
    expect(segs.map((s) => s.startTime)).toEqual([1200, 1205])
    expect(segs.map((s) => s.endTime)).toEqual([1205, 1208])
  })

  it('does not mistake a single spoken clock reference for timestamp metadata', () => {
    const segs = parseTurns('Speaker 1: nos vemos a las 10:00 Speaker 2: perfecto', 0, 'you', 'mic')
    expect(segs.map((s) => s.text)).toEqual(['nos vemos a las 10:00', 'perfecto'])
  })

  it('rejects a multi-turn response whose timestamps all collapse to the chunk boundary', () => {
    expect(hasReliableTurnTiming('Speaker 1: uno Speaker 2: dos Speaker 1: tres')).toBe(false)
    expect(hasReliableTurnTiming('[00:01] Speaker 1: uno [00:04] Speaker 2: dos')).toBe(true)
  })

  it('rejects an oversized speaker wall even when its timestamp is valid', () => {
    const collapsedConversation = `[00:22] Speaker 1: ${Array.from({ length: 1130 }, () => 'palabra').join(' ')}`
    expect(hasReliableTurnTiming(collapsedConversation)).toBe(true)
    expect(hasReliableTurnStructure(collapsedConversation)).toBe(false)
    expect(hasReliableTurnStructure('[00:22] Speaker 1: una respuesta breve')).toBe(true)
  })

  it('normalizes schema-constrained JSON into canonical timed speaker turns', () => {
    const normalized = normalizeGeminiTranscriptResponse(JSON.stringify({
      hasSpeech: true,
      segments: [
        { timestamp: '00:03', speaker: 'Speaker 1', content: 'Hola' },
        { timestamp: '00:07', speaker: 'Speaker 2', content: 'Qué tal' }
      ]
    }))

    expect(normalized).toBe('[00:03] Speaker 1: Hola\n[00:07] Speaker 2: Qué tal')
    expect(parseTurns(normalized, 0, 'you', 'mic')).toHaveLength(2)
    expect(normalizeGeminiTranscriptResponse('{"hasSpeech":false,"segments":[]}')).toBe('[NO_SPEECH]')
  })

  it('uses the start clock when Gemini returns timestamp ranges', () => {
    const normalized = normalizeGeminiTranscriptResponse(JSON.stringify({
      hasSpeech: true,
      segments: [
        { timestamp: '00:00 - 00:01', speaker: 'Speaker 1', content: 'Hola' },
        { timestamp: '00:01 - 00:07', speaker: 'Speaker 2', content: 'Buenos días' },
        { timestamp: '00:07–00:13', speaker: 'Speaker 1', content: 'Comencemos' }
      ]
    }))

    expect(normalized).toBe(
      '[00:00] Speaker 1: Hola\n[00:01] Speaker 2: Buenos días\n[00:07] Speaker 1: Comencemos'
    )
    expect(hasReliableTurnTiming(normalized)).toBe(true)
    expect(parseTurns(normalized, 0, 'you', 'mic').map((turn) => turn.startTime)).toEqual([0, 1, 7])
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
    expect(capturedPrompt).toContain('formatted MM:SS')
    expect(capturedPrompt).toContain('NEVER return the whole recording as one item or one speaker block')
  })

  it('retries a no-timestamp diarized blob and yields only the repaired timed turns', async () => {
    mockGenerateContentStream
      .mockResolvedValueOnce(
        streamResponse('Speaker 1: buenos días a todos Speaker 2: gracias, empecemos Speaker 1: perfecto')
      )
      .mockResolvedValueOnce(
        streamResponse('[00:00] Speaker 1: buenos días a todos [00:02] Speaker 2: gracias, empecemos [00:04] Speaker 1: perfecto')
      )
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(segments).toHaveLength(3)
    expect(segments.map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1'])
    expect(segments.map((s) => s.startTime)).toEqual([0, 2, 4])
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the format retry still has no reliable timestamps', async () => {
    mockGenerateContentStream.mockResolvedValue(
      streamResponse('Speaker 1: uno Speaker 2: dos Speaker 1: tres')
    )
    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' })))
      .rejects.toThrow(/without reliable speaker-turn timing and structure/)
  })

  it('retries an oversized speaker wall and keeps only the repaired diarized turns', async () => {
    const wall = `[00:22] Speaker 1: ${Array.from({ length: 1130 }, () => 'palabra').join(' ')}`
    mockGenerateContentStream
      .mockResolvedValueOnce(streamResponse(wall))
      .mockResolvedValueOnce(streamResponse(
        '[00:22] Speaker 1: primera intervención [00:28] Speaker 2: respuesta [00:32] Speaker 1: seguimiento'
      ))

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(mockGenerateContentStream).toHaveBeenCalledTimes(2)
    expect(segments.map((segment) => segment.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1'])
    expect(segments.map((segment) => segment.startTime)).toEqual([22, 28, 32])
  })
})
