import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

import { spawn } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { VibeVoiceEngine } from '../src/engines/vibevoice-engine.js'

const oneSecond = Buffer.alloc(16000 * 2)

function createMockProcess(stdout: string, exitCode: number, stderr = '') {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = null
  proc.stdio = ['ignore', proc.stdout, proc.stderr]
  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
    proc.emit('close', exitCode)
  }, 5)
  return proc
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iter) result.push(item)
  return result
}

describe('VibeVoiceEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isStreaming is false', () => {
    expect(new VibeVoiceEngine().isStreaming).toBe(false)
  })

  it('isLocal is true', () => {
    expect(new VibeVoiceEngine().isLocal).toBe(true)
  })

  it('invokes the CLI with --backend vibevoice', async () => {
    const jsonOutput = JSON.stringify({
      segments: [{ text: 'hi', start: 0, end: 1, speaker: 'Speaker 0' }],
    })
    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))

    const engine = new VibeVoiceEngine()
    await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args).toContain('--backend')
    expect(args).toContain('vibevoice')
  })

  it('preserves VibeVoice speaker labels (does NOT remap to you/them)', async () => {
    const jsonOutput = JSON.stringify({
      segments: [
        { text: 'Hello world', start: 0, end: 1.5, speaker: 'Speaker 0' },
        { text: 'How are you', start: 1.5, end: 3.0, speaker: 'Speaker 1' },
      ],
    })
    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))

    const engine = new VibeVoiceEngine()
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(segments).toHaveLength(2)
    expect(segments[0].speaker).toBe('Speaker 0')
    expect(segments[1].speaker).toBe('Speaker 1')
    expect(segments[0].text).toBe('Hello world')
    expect(segments[0].startTime).toBe(0)
    expect(segments[0].endTime).toBe(1.5)
    expect(segments[0].source).toBe('mic')
  })

  it('defaults language to auto but passes an explicit language when given', async () => {
    const jsonOutput = JSON.stringify({ segments: [{ text: 'x', start: 0, end: 1, speaker: 'Speaker 0' }] })

    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))
    const engine = new VibeVoiceEngine()
    await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    let args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args).toContain('auto')

    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))
    await collect(engine.transcribe(oneSecond, { source: 'mic', language: 'es' }))
    args = vi.mocked(spawn).mock.calls[1][1] as string[]
    expect(args).toContain('es')
  })

  it('respects timeOffset option', async () => {
    const jsonOutput = JSON.stringify({
      segments: [{ text: 'test', start: 1, end: 2, speaker: 'Speaker 0' }],
    })
    vi.mocked(spawn).mockReturnValue(createMockProcess(jsonOutput, 0))

    const engine = new VibeVoiceEngine()
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic', timeOffset: 10 }))

    expect(segments[0].startTime).toBe(11)
    expect(segments[0].endTime).toBe(12)
  })

  it('throws on Python process failure', async () => {
    vi.mocked(spawn).mockReturnValue(createMockProcess('', 1, 'boom'))
    const engine = new VibeVoiceEngine()
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(
      /asr_mcp\.cli exited with code 1/,
    )
  })

  it('cleans up the temp file even on error', async () => {
    vi.mocked(spawn).mockReturnValue(createMockProcess('', 1, 'error'))
    const engine = new VibeVoiceEngine()
    try {
      await collect(engine.transcribe(oneSecond, { source: 'mic' }))
    } catch {
      // expected
    }
    expect(unlink).toHaveBeenCalled()
  })

  it('isAvailable returns true when CLI responds with code 0', async () => {
    vi.mocked(spawn).mockReturnValue(createMockProcess('', 0))
    expect(await new VibeVoiceEngine().isAvailable()).toBe(true)
  })
})
