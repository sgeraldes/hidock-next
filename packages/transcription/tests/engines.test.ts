import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TranscriptSegment } from '../src/engines/engine-interface.js'

// ── CohereEngine tests ──

// We need to mock child_process and fs before importing CohereEngine
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

import { spawn } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { CohereEngine } from '../src/engines/cohere-engine.js'
import { Chirp3Engine } from '../src/engines/chirp3-engine.js'
import { EventEmitter } from 'node:events'

const oneSecond = Buffer.alloc(16000 * 2)

function createMockProcess(stdout: string, exitCode: number, stderr = '') {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = null
  proc.stdio = ['ignore', proc.stdout, proc.stderr]

  // Emit data and close asynchronously
  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
    proc.emit('close', exitCode)
  }, 5)

  return proc
}

describe('CohereEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isStreaming is false', () => {
    expect(new CohereEngine().isStreaming).toBe(false)
  })

  it('isLocal is true', () => {
    expect(new CohereEngine().isLocal).toBe(true)
  })

  it('yields segments from diarized JSON output', async () => {
    const jsonOutput = JSON.stringify({
      segments: [
        { text: 'Hello world', start: 0, end: 1.5, speaker: 'SPEAKER_00' },
        { text: 'How are you', start: 1.5, end: 3.0, speaker: 'SPEAKER_01' },
      ],
    })

    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))

    const engine = new CohereEngine()
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe('Hello world')
    expect(segments[0].speaker).toBe('you')
    expect(segments[0].startTime).toBe(0)
    expect(segments[0].endTime).toBe(1.5)
    expect(segments[0].source).toBe('mic')
    expect(segments[1].text).toBe('How are you')
  })

  it('yields segments from non-diarized JSON output (text field)', async () => {
    const jsonOutput = JSON.stringify({ text: 'Just a plain text output' })

    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))

    const engine = new CohereEngine()
    const segments = await collect(engine.transcribe(oneSecond, { source: 'system' }))

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Just a plain text output')
    expect(segments[0].speaker).toBe('them')
    expect(segments[0].source).toBe('system')
  })

  it('maps system source to "them"', async () => {
    const jsonOutput = JSON.stringify({
      segments: [{ text: 'test', start: 0, end: 1 }],
    })

    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))

    const engine = new CohereEngine()
    const segments = await collect(engine.transcribe(oneSecond, { source: 'system' }))

    expect(segments[0].speaker).toBe('them')
  })

  it('respects timeOffset option', async () => {
    const jsonOutput = JSON.stringify({
      segments: [{ text: 'test', start: 1, end: 2 }],
    })

    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))

    const engine = new CohereEngine()
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic', timeOffset: 10 }))

    expect(segments[0].startTime).toBe(11)
    expect(segments[0].endTime).toBe(12)
  })

  it('throws on Python process failure', async () => {
    vi.mocked(spawn).mockReturnValue(createMockProcess('', 1, 'Python error'))

    const engine = new CohereEngine()
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(
      /asr_mcp\.cli exited with code 1/,
    )
  })

  it('throws on invalid JSON output', async () => {
    vi.mocked(spawn).mockReturnValue(createMockProcess('not valid json', 0))

    const engine = new CohereEngine()
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow()
  })

  it('cleans up temp file even on error', async () => {
    vi.mocked(spawn).mockReturnValue(createMockProcess('', 1, 'error'))

    const engine = new CohereEngine()
    try {
      await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    } catch {
      // expected
    }

    expect(unlink).toHaveBeenCalled()
  })

  it('isAvailable returns true when CLI responds with code 0', async () => {
    vi.mocked(spawn).mockReturnValue(createMockProcess('', 0))

    const engine = new CohereEngine()
    const result = await engine.isAvailable()

    expect(result).toBe(true)
  })

  it('isAvailable returns false when CLI fails', async () => {
    vi.mocked(spawn).mockReturnValue(createMockProcess('', 1))

    const engine = new CohereEngine()
    const result = await engine.isAvailable()

    expect(result).toBe(false)
  })
})

// ── Chirp3Engine tests ──

describe('Chirp3Engine', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('isStreaming is true', () => {
    expect(new Chirp3Engine().isStreaming).toBe(true)
  })

  it('isLocal is false', () => {
    expect(new Chirp3Engine().isLocal).toBe(false)
  })

  it('isAvailable returns true when apiKey is set', async () => {
    const engine = new Chirp3Engine({ apiKey: 'test-key' })
    expect(await engine.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when apiKey is not set', async () => {
    const engine = new Chirp3Engine()
    expect(await engine.isAvailable()).toBe(false)
  })

  it('throws when no API key is provided', async () => {
    const engine = new Chirp3Engine()
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(
      'Chirp3Engine requires an API key',
    )
  })

  it('yields segments from successful API response', async () => {
    const apiResponse: any = {
      results: [
        {
          alternatives: [
            {
              transcript: 'Hello from cloud',
              confidence: 0.95,
              words: [
                { word: 'Hello', startTime: '0s', endTime: '0.5s' },
                { word: 'from', startTime: '0.5s', endTime: '0.8s' },
                { word: 'cloud', startTime: '0.8s', endTime: '1.2s' },
              ],
            },
          ],
        },
      ],
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(apiResponse),
      }),
    )

    const engine = new Chirp3Engine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Hello from cloud')
    expect(segments[0].speaker).toBe('you')
    expect(segments[0].startTime).toBe(0)
    expect(segments[0].endTime).toBe(1.2)
    expect(segments[0].confidence).toBe(0.95)
    expect(segments[0].source).toBe('mic')
  })

  it('maps system source to "them"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ alternatives: [{ transcript: 'test', confidence: 0.9, words: [] }] }],
          }),
      }),
    )

    const engine = new Chirp3Engine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'system' }))

    expect(segments[0].speaker).toBe('them')
  })

  it('respects timeOffset option', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              {
                alternatives: [
                  {
                    transcript: 'test',
                    confidence: 0.9,
                    words: [
                      { word: 'test', startTime: '1s', endTime: '2s' },
                    ],
                  },
                ],
              },
            ],
          }),
      }),
    )

    const engine = new Chirp3Engine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic', timeOffset: 5 }))

    expect(segments[0].startTime).toBe(6)
    expect(segments[0].endTime).toBe(7)
  })

  it('throws on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      }),
    )

    const engine = new Chirp3Engine({ apiKey: 'bad-key' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(
      /Google Speech API error \(403\)/,
    )
  })

  it('yields nothing for empty results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      }),
    )

    const engine = new Chirp3Engine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(segments).toHaveLength(0)
  })
})

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iter) result.push(item)
  return result
}
