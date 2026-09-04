import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock the 'ai' module's generateText
vi.mock('ai', () => ({
  generateText: vi.fn()
}))

// Mock each provider so createProvider doesn't actually create real HTTP clients
vi.mock('../src/provider-factory.js', () => ({
  createProvider: vi.fn()
}))

import { generateText } from 'ai'
import { createProvider } from '../src/provider-factory.js'
import { complete } from '../src/complete.js'
import type { ProviderConfig } from '../src/types.js'

/** Build a mock fetch Response whose body streams the given NDJSON lines as
 *  UTF-8 chunks — mirrors Ollama's stream:true response shape. Splitting across
 *  arbitrary chunk boundaries is exercised by grouping lines into chunks. */
function streamingOllamaResponse(chunks: string[], ok = true, status = 200, statusText = 'OK') {
  const enc = new TextEncoder()
  return {
    ok,
    status,
    statusText,
    body: (async function* () {
      for (const c of chunks) yield enc.encode(c)
    })(),
  }
}

describe('complete()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls createProvider with config, calls generateText with the model, and returns result.text', async () => {
    const fakeModel = { modelId: 'fake-model' }
    ;(createProvider as any).mockReturnValue({ model: fakeModel, provider: 'openai' })
    ;(generateText as any).mockResolvedValue({ text: 'Hello from the model' })

    const config: ProviderConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' }
    const result = await complete('Say hello', config)

    expect(createProvider).toHaveBeenCalledWith(config)
    expect(generateText).toHaveBeenCalledWith({ model: fakeModel, prompt: 'Say hello' })
    expect(result).toBe('Hello from the model')
  })

  it('propagates errors thrown by generateText', async () => {
    const fakeModel = { modelId: 'fake-model' }
    ;(createProvider as any).mockReturnValue({ model: fakeModel, provider: 'openai' })
    ;(generateText as any).mockRejectedValue(new Error('API Error'))

    const config: ProviderConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' }
    await expect(complete('test', config)).rejects.toThrow('API Error')
  })

  it('calls Ollama REST directly (streaming) and reassembles the token fragments', async () => {
    // Ollama stream:true emits newline-delimited JSON, one token fragment each,
    // then a final done marker. Fragments here also span chunk boundaries.
    // Build NDJSON via JSON.stringify to avoid hand-escaping errors. The model
    // emits the JSON string {"topics":["Planning"]} one fragment per line.
    const frags = ['{"topics":', '["Planning"]', '}']
    const lines = frags.map((f) => JSON.stringify({ response: f }) + '\n').join('') + JSON.stringify({ done: true }) + '\n'
    const fetchMock = vi.fn(async () => streamingOllamaResponse([lines]))
    vi.stubGlobal('fetch', fetchMock)

    const config: ProviderConfig = {
      provider: 'ollama',
      model: 'llama3.2',
      baseURL: 'http://localhost:11434/api/',
    }
    const result = await complete('Extract graph JSON', config)

    expect(result).toBe('{"topics":["Planning"]}')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toEqual({ model: 'llama3.2', prompt: 'Extract graph JSON', stream: true })
    expect(createProvider).not.toHaveBeenCalledWith(config)
  })

  it('reassembles a fragment split across a chunk boundary and flushes a newline-less tail', async () => {
    const fetchMock = vi.fn(async () =>
      // one JSON object split mid-string across two chunks, and a final line
      // with NO trailing newline (must still be flushed).
      streamingOllamaResponse(['{"respon', 'se":"Hello "}\n{"response":"world"}'])
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await complete('hi', { provider: 'ollama', model: 'llama3.2' })
    expect(result).toBe('Hello world')
  })

  it('surfaces an error object embedded in the Ollama stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamingOllamaResponse(['{"response":"partial "}\n{"error":"model crashed"}\n'])
    ))
    await expect(
      complete('test', { provider: 'ollama', model: 'llama3.2' })
    ).rejects.toThrow('Ollama stream error: model crashed')
  })

  it('surfaces an Ollama HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' })))
    await expect(
      complete('test', { provider: 'ollama', model: 'llama3.2' })
    ).rejects.toThrow('Ollama completion request failed: 500 Server Error')
  })
})
