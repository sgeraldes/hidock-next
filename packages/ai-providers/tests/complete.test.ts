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

  it('calls Ollama REST directly instead of the incompatible V1 model adapter', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: '{"topics":["Planning"]}' }),
    }))
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
    expect(body).toEqual({ model: 'llama3.2', prompt: 'Extract graph JSON', stream: false })
    expect(createProvider).not.toHaveBeenCalledWith(config)
  })

  it('surfaces an Ollama HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' })))
    await expect(
      complete('test', { provider: 'ollama', model: 'llama3.2' })
    ).rejects.toThrow('Ollama completion request failed: 500 Server Error')
  })
})
