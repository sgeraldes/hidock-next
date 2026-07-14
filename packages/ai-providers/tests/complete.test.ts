import { describe, it, expect, vi } from 'vitest'

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
})
