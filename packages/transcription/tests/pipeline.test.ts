import { describe, it, expect, vi } from 'vitest'
import { TranscriptionPipeline } from '../src/pipeline.js'
import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from '../src/engines/engine-interface.js'

const oneSecond = Buffer.alloc(16000 * 2)

function makeMockEngine(
  overrides: Partial<TranscriptionEngine> & { segments?: TranscriptSegment[] } = {},
): TranscriptionEngine {
  const segments = overrides.segments ?? [
    {
      speaker: '',
      text: 'hello',
      startTime: 0,
      endTime: 1,
      confidence: 1,
      source: 'mic' as const,
    },
  ]

  return {
    isStreaming: overrides.isStreaming ?? false,
    isLocal: overrides.isLocal ?? true,
    isAvailable: overrides.isAvailable,
    async *transcribe(_audio: Buffer, options: TranscribeOptions) {
      for (const seg of segments) {
        yield { ...seg, source: options.source }
      }
    },
    ...overrides,
  } as TranscriptionEngine
}

function makeFailingEngine(error: string, isLocal = true): TranscriptionEngine {
  return {
    isStreaming: false,
    isLocal,
    async *transcribe() {
      throw new Error(error)
    },
  }
}

describe('TranscriptionPipeline', () => {
  it('works with a single engine (backward compat)', async () => {
    const engine = makeMockEngine()
    const pipeline = new TranscriptionPipeline(engine)
    const segments = await pipeline.collect(oneSecond, { source: 'mic' })

    expect(segments.length).toBeGreaterThan(0)
    expect(segments[0].speaker).toBe('you')
  })

  it('applies diarization by default (mic -> you)', async () => {
    const pipeline = new TranscriptionPipeline(makeMockEngine())
    const segments = await pipeline.collect(oneSecond, { source: 'mic' })

    expect(segments[0].speaker).toBe('you')
  })

  it('applies diarization by default (system -> them)', async () => {
    const pipeline = new TranscriptionPipeline(makeMockEngine())
    const segments = await pipeline.collect(oneSecond, { source: 'system' })

    expect(segments[0].speaker).toBe('them')
  })

  it('applies vocabulary corrections', async () => {
    const engine = makeMockEngine({
      segments: [{ speaker: '', text: 'hi dock', startTime: 0, endTime: 1, confidence: 1, source: 'mic' }],
    })
    const pipeline = new TranscriptionPipeline(engine, {
      vocabulary: { 'hi dock': 'HiDock' },
    })
    const segments = await pipeline.collect(oneSecond, { source: 'mic' })

    expect(segments[0].text).toBe('HiDock')
  })

  it('run() yields same segments as collect()', async () => {
    const pipeline = new TranscriptionPipeline(makeMockEngine())
    const fromCollect = await pipeline.collect(oneSecond, { source: 'mic' })
    const fromRun: TranscriptSegment[] = []
    for await (const s of pipeline.run(oneSecond, { source: 'mic' })) {
      fromRun.push(s)
    }
    expect(fromRun).toHaveLength(fromCollect.length)
  })

  it('emits segment events', async () => {
    const pipeline = new TranscriptionPipeline(makeMockEngine())
    const emitted: TranscriptSegment[] = []
    pipeline.on('segment', (s) => emitted.push(s))

    await pipeline.collect(oneSecond, { source: 'mic' })

    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted[0].speaker).toBe('you')
  })
})

describe('TranscriptionPipeline engine selection', () => {
  it('prefers local engine over cloud engine', async () => {
    const localEngine = makeMockEngine({
      isLocal: true,
      isAvailable: vi.fn().mockResolvedValue(true),
      segments: [{ speaker: '', text: 'local', startTime: 0, endTime: 1, confidence: 1, source: 'mic' }],
    })
    const cloudEngine = makeMockEngine({
      isLocal: false,
      isAvailable: vi.fn().mockResolvedValue(true),
      segments: [{ speaker: '', text: 'cloud', startTime: 0, endTime: 1, confidence: 1, source: 'mic' }],
    })

    const pipeline = new TranscriptionPipeline([localEngine, cloudEngine])
    const selected = await pipeline.selectEngine()

    expect(selected).toBe(localEngine)
  })

  it('selects cloud engine when local is unavailable', async () => {
    const localEngine = makeMockEngine({
      isLocal: true,
      isAvailable: vi.fn().mockResolvedValue(false),
    })
    const cloudEngine = makeMockEngine({
      isLocal: false,
      isAvailable: vi.fn().mockResolvedValue(true),
      segments: [{ speaker: '', text: 'cloud', startTime: 0, endTime: 1, confidence: 1, source: 'mic' }],
    })

    const pipeline = new TranscriptionPipeline([localEngine, cloudEngine])
    const selected = await pipeline.selectEngine()

    expect(selected).toBe(cloudEngine)
  })

  it('emits engine-status events during selection', async () => {
    const engine = makeMockEngine({
      isAvailable: vi.fn().mockResolvedValue(true),
    })

    const pipeline = new TranscriptionPipeline([engine])
    const statuses: Array<[string, boolean]> = []
    pipeline.on('engine-status', (name, avail) => statuses.push([name, avail]))

    await pipeline.selectEngine()

    expect(statuses.length).toBeGreaterThan(0)
  })
})

describe('TranscriptionPipeline engine fallback', () => {
  it('falls back to second engine when first throws', async () => {
    const failEngine = makeFailingEngine('local failed', true)
    const okEngine = makeMockEngine({
      isLocal: false,
      segments: [{ speaker: '', text: 'fallback worked', startTime: 0, endTime: 1, confidence: 1, source: 'mic' }],
    })

    const pipeline = new TranscriptionPipeline([failEngine, okEngine])
    const switches: Array<[string, string]> = []
    pipeline.on('engine-switch', (from, to) => switches.push([from, to]))

    const segments = await pipeline.collect(oneSecond, { source: 'mic' })

    expect(segments[0].text).toBe('fallback worked')
    expect(switches.length).toBe(1)
  })

  it('emits error event when primary engine fails', async () => {
    const failEngine = makeFailingEngine('boom', true)
    const okEngine = makeMockEngine({ isLocal: false })

    const pipeline = new TranscriptionPipeline([failEngine, okEngine])
    const errors: Error[] = []
    pipeline.on('error', (e) => errors.push(e))

    await pipeline.collect(oneSecond, { source: 'mic' })

    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0].message).toBe('boom')
  })

  it('throws when all engines fail', async () => {
    const fail1 = makeFailingEngine('engine 1 failed', true)
    const fail2 = makeFailingEngine('engine 2 failed', false)

    const pipeline = new TranscriptionPipeline([fail1, fail2])

    await expect(pipeline.collect(oneSecond, { source: 'mic' })).rejects.toThrow('engine 1 failed')
  })
})
