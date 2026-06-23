import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @google/generative-ai BEFORE importing GeminiEngine
const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({ generateContent: mockGenerateContent }))

vi.mock('@google/generative-ai', () => {
  function GoogleGenerativeAI(_apiKey: string) {
    return { getGenerativeModel: mockGetGenerativeModel }
  }
  return { GoogleGenerativeAI }
})

import { GeminiEngine } from '../src/engines/gemini-engine.js'

const oneSecond = Buffer.alloc(16000 * 2)

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iter) result.push(item)
  return result
}

describe('GeminiEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'Hello world' },
    })

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Hello world')
    expect(segments[0].speaker).toBe('you')
    expect(segments[0].source).toBe('mic')
    expect(segments[0].startTime).toBe(0)
    expect(segments[0].endTime).toBe(0)
    expect(segments[0].confidence).toBe(1)
  })

  it('maps system source to "them" speaker', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'System audio text' },
    })

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'system' }))

    expect(segments[0].speaker).toBe('them')
    expect(segments[0].source).toBe('system')
  })

  it('yields nothing when Gemini returns empty text', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '   ' },
    })

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const segments = await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(segments).toHaveLength(0)
  })

  it('uses the configured model name', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'test' },
    })

    const engine = new GeminiEngine({ apiKey: 'test-key', model: 'gemini-2.0-flash' })
    await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-2.0-flash' })
  })

  it('defaults to gemini-2.5-flash when no model is specified', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'test' },
    })

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-2.5-flash' })
  })

  it('includes context in the prompt when options.context is provided', async () => {
    let capturedPrompt = ''
    mockGenerateContent.mockImplementation(async (parts: any[]) => {
      capturedPrompt = parts.find((p: any) => p.text)?.text ?? ''
      return { response: { text: () => 'Transcript with context' } }
    })

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await collect(
      engine.transcribe(oneSecond, {
        source: 'mic',
        context: 'MEETING CONTEXT: Weekly standup',
      }),
    )

    expect(capturedPrompt).toContain('MEETING CONTEXT: Weekly standup')
  })

  it('does not include context section when options.context is undefined', async () => {
    let capturedPrompt = ''
    mockGenerateContent.mockImplementation(async (parts: any[]) => {
      capturedPrompt = parts.find((p: any) => p.text)?.text ?? ''
      return { response: { text: () => 'Plain transcript' } }
    })

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await collect(engine.transcribe(oneSecond, { source: 'mic' }))

    // Should not have any context-related additions beyond the standard prompt
    expect(capturedPrompt).not.toContain('MEETING CONTEXT')
  })

  it('sends audio as base64 inlineData in the request', async () => {
    let capturedParts: any[] = []
    mockGenerateContent.mockImplementation(async (parts: any[]) => {
      capturedParts = parts
      return { response: { text: () => 'result' } }
    })

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    const audioBuffer = Buffer.from('fake audio data')
    await collect(engine.transcribe(audioBuffer, { source: 'mic' }))

    const inlineDataPart = capturedParts.find((p: any) => p.inlineData)
    expect(inlineDataPart).toBeDefined()
    expect(inlineDataPart.inlineData.data).toBe(audioBuffer.toString('base64'))
  })

  it('propagates errors thrown by generateContent', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Rate limit exceeded'))

    const engine = new GeminiEngine({ apiKey: 'test-key' })
    await expect(collect(engine.transcribe(oneSecond, { source: 'mic' }))).rejects.toThrow(
      'Rate limit exceeded',
    )
  })
})
