import { describe, it, expect } from 'vitest'
import { CohereEngine } from '../src/engines/cohere-engine.js'
import { Chirp3Engine } from '../src/engines/chirp3-engine.js'

const oneSecond = Buffer.alloc(16000 * 2) // 1 s of 16 kHz 16-bit mono silence

describe('CohereEngine', () => {
  it('isStreaming is false', () => {
    expect(new CohereEngine().isStreaming).toBe(false)
  })

  it('isLocal is true', () => {
    expect(new CohereEngine().isLocal).toBe(true)
  })

  it('yields segments for mic source', async () => {
    const engine = new CohereEngine()
    const segments = []
    for await (const s of engine.transcribe(oneSecond, { source: 'mic' })) {
      segments.push(s)
    }
    expect(segments.length).toBeGreaterThan(0)
    expect(segments[0].source).toBe('mic')
  })

  it('yields segments for system source', async () => {
    const engine = new CohereEngine()
    const segments = []
    for await (const s of engine.transcribe(oneSecond, { source: 'system' })) {
      segments.push(s)
    }
    expect(segments[0].source).toBe('system')
  })

  it('segment has all required fields', async () => {
    const engine = new CohereEngine()
    const [segment] = await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(typeof segment.speaker).toBe('string')
    expect(typeof segment.text).toBe('string')
    expect(typeof segment.startTime).toBe('number')
    expect(typeof segment.endTime).toBe('number')
    expect(typeof segment.confidence).toBe('number')
    expect(['mic', 'system']).toContain(segment.source)
  })

  it('respects timeOffset option', async () => {
    const engine = new CohereEngine()
    const [segment] = await collect(engine.transcribe(oneSecond, { source: 'mic', timeOffset: 10 }))
    expect(segment.startTime).toBe(10)
    expect(segment.endTime).toBeGreaterThan(10)
  })
})

describe('Chirp3Engine', () => {
  it('isStreaming is true', () => {
    expect(new Chirp3Engine().isStreaming).toBe(true)
  })

  it('isLocal is false', () => {
    expect(new Chirp3Engine().isLocal).toBe(false)
  })

  it('yields at least one segment for a short buffer', async () => {
    const engine = new Chirp3Engine()
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    expect(segments.length).toBeGreaterThan(0)
  })

  it('yields multiple segments for long audio', async () => {
    const tenSeconds = Buffer.alloc(16000 * 2 * 12) // 12 s — spans two 5-s chunks
    const engine = new Chirp3Engine()
    const segments = await collect(engine.transcribe(tenSeconds, { source: 'system' }))
    expect(segments.length).toBeGreaterThanOrEqual(2)
  })

  it('segment source matches option', async () => {
    const engine = new Chirp3Engine()
    const segments = await collect(engine.transcribe(oneSecond, { source: 'system' }))
    expect(segments[0].source).toBe('system')
  })

  it('respects timeOffset option', async () => {
    const engine = new Chirp3Engine()
    const [segment] = await collect(engine.transcribe(oneSecond, { source: 'mic', timeOffset: 5 }))
    expect(segment.startTime).toBe(5)
  })
})

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iter) result.push(item)
  return result
}
