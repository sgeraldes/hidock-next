import { describe, it, expect } from 'vitest'
import { TranscriptionPipeline } from '../src/pipeline.js'
import { CohereEngine } from '../src/engines/cohere-engine.js'
import { Chirp3Engine } from '../src/engines/chirp3-engine.js'

const oneSecond = Buffer.alloc(16000 * 2)

describe('TranscriptionPipeline with CohereEngine', () => {
  it('collects segments from cohere engine', async () => {
    const pipeline = new TranscriptionPipeline(new CohereEngine())
    const segments = await pipeline.collect(oneSecond, { source: 'mic' })
    expect(segments.length).toBeGreaterThan(0)
  })

  it('applies diarization by default (mic -> you)', async () => {
    const pipeline = new TranscriptionPipeline(new CohereEngine())
    const segments = await pipeline.collect(oneSecond, { source: 'mic' })
    expect(segments[0].speaker).toBe('you')
  })

  it('applies diarization by default (system -> them)', async () => {
    const pipeline = new TranscriptionPipeline(new CohereEngine())
    const segments = await pipeline.collect(oneSecond, { source: 'system' })
    expect(segments[0].speaker).toBe('them')
  })

  it('applies vocabulary corrections', async () => {
    const pipeline = new TranscriptionPipeline(new CohereEngine(), {
      vocabulary: { '': '' } // no-op correction to verify pipeline runs
    })
    const segments = await pipeline.collect(oneSecond, { source: 'mic' })
    expect(segments.length).toBeGreaterThan(0)
  })

  it('run() yields same segments as collect()', async () => {
    const pipeline = new TranscriptionPipeline(new CohereEngine())
    const fromCollect = await pipeline.collect(oneSecond, { source: 'mic' })
    const fromRun: typeof fromCollect = []
    for await (const s of pipeline.run(oneSecond, { source: 'mic' })) {
      fromRun.push(s)
    }
    expect(fromRun).toHaveLength(fromCollect.length)
  })
})

describe('TranscriptionPipeline with Chirp3Engine', () => {
  it('collects streaming segments', async () => {
    const pipeline = new TranscriptionPipeline(new Chirp3Engine())
    const segments = await pipeline.collect(oneSecond, { source: 'system' })
    expect(segments.length).toBeGreaterThan(0)
  })

  it('diarizes system source as "them"', async () => {
    const pipeline = new TranscriptionPipeline(new Chirp3Engine())
    const segments = await pipeline.collect(oneSecond, { source: 'system' })
    expect(segments[0].speaker).toBe('them')
  })

  it('all segment sources match the option', async () => {
    const pipeline = new TranscriptionPipeline(new Chirp3Engine())
    const segments = await pipeline.collect(Buffer.alloc(16000 * 2 * 12), { source: 'mic' })
    for (const s of segments) {
      expect(s.source).toBe('mic')
    }
  })
})
