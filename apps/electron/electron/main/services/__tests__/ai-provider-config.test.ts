/**
 * ai-provider-config.test.ts — getProviderConfigFromSettings()
 *
 * Pure unit tests (no DB, no network) for the provider-config resolver
 * extracted from knowledge-graph-service.ts (spec-001 step 9). Must return the
 * identical ProviderConfig|null as the former inline providerConfigFromSettings
 * for the gemini-configured and no-key cases (design-review ruling 3).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetConfig = vi.fn()

vi.mock('../config', () => ({
  getConfig: () => mockGetConfig()
}))

describe('getProviderConfigFromSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a google ProviderConfig when chat.provider is gemini and a geminiApiKey is set', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'gemini', geminiModel: 'gemini-3.5-flash' },
      transcription: { geminiApiKey: 'test-key-123' } // pragma: allowlist secret
    })

    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    const config = getProviderConfigFromSettings()

    expect(config).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash',
      apiKey: 'test-key-123' // pragma: allowlist secret
    })
  })

  it('falls back to the gemini-3.5-flash default when chat.geminiModel is empty', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'gemini', geminiModel: '' },
      transcription: { geminiApiKey: 'test-key-123' } // pragma: allowlist secret
    })

    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    const config = getProviderConfigFromSettings()

    expect(config).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash',
      apiKey: 'test-key-123' // pragma: allowlist secret
    })
  })

  it('honours a custom chat.geminiModel', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'gemini', geminiModel: 'gemini-custom-model' },
      transcription: { geminiApiKey: 'test-key-123' } // pragma: allowlist secret
    })

    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    const config = getProviderConfigFromSettings()

    expect(config?.model).toBe('gemini-custom-model')
  })

  it('returns null when no geminiApiKey is set', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'gemini', geminiModel: 'gemini-3.5-flash' },
      transcription: { geminiApiKey: '' }
    })

    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    expect(getProviderConfigFromSettings()).toBeNull()
  })

  it('returns an Ollama ProviderConfig for the configured local model', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'ollama', geminiModel: 'gemini-3.5-flash', ollamaModel: 'llama3.2' },
      transcription: { geminiApiKey: 'test-key-123' }, // pragma: allowlist secret
      embeddings: { ollamaBaseUrl: 'http://localhost:11434/' },
    })

    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    expect(getProviderConfigFromSettings()).toEqual({
      provider: 'ollama',
      model: 'llama3.2',
      baseURL: 'http://localhost:11434/api',
    })
  })

  it('returns null when Ollama has no configured chat model', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'ollama', ollamaModel: '' },
      transcription: { geminiApiKey: '' },
      embeddings: { ollamaBaseUrl: 'http://localhost:11434' },
    })

    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    expect(getProviderConfigFromSettings()).toBeNull()
  })
})

describe('getExtractionProviderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('overrides the Ollama model with chat.extractionOllamaModel', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'ollama', ollamaModel: 'llama3.2', extractionOllamaModel: 'gemma3:12b' },
      transcription: { geminiApiKey: '' },
      embeddings: { ollamaBaseUrl: 'http://localhost:11434' },
    })
    const { getExtractionProviderConfig } = await import('../ai-provider-config')
    expect(getExtractionProviderConfig()).toEqual({
      provider: 'ollama',
      model: 'gemma3:12b',            // extraction model, NOT the chat model
      baseURL: 'http://localhost:11434/api',
    })
  })

  it('falls back to chat.ollamaModel when no extraction model is set', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'ollama', ollamaModel: 'llama3.2' },  // no extractionOllamaModel
      transcription: { geminiApiKey: '' },
      embeddings: { ollamaBaseUrl: 'http://localhost:11434' },
    })
    const { getExtractionProviderConfig } = await import('../ai-provider-config')
    expect(getExtractionProviderConfig()?.model).toBe('llama3.2')
  })

  it('leaves the Gemini path unchanged (no extraction override on cloud)', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'gemini', geminiModel: 'gemini-3.5-flash', extractionOllamaModel: 'gemma3:12b' },
      transcription: { geminiApiKey: 'test-key-123' }, // pragma: allowlist secret
    })
    const { getExtractionProviderConfig } = await import('../ai-provider-config')
    expect(getExtractionProviderConfig()).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash',
      apiKey: 'test-key-123', // pragma: allowlist secret
    })
  })

  it('returns null when no provider is configured', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'ollama', ollamaModel: '' },
      transcription: { geminiApiKey: '' },
      embeddings: { ollamaBaseUrl: 'http://localhost:11434' },
    })
    const { getExtractionProviderConfig } = await import('../ai-provider-config')
    expect(getExtractionProviderConfig()).toBeNull()
  })
})

/**
 * Model isolation (Req 6): extraction and chat resolve from separate keys, so
 * changing one never affects the other, and the value-classification path keeps
 * using the base (chat) resolver.
 */
describe('model isolation between extraction and chat/value-classification (Req 6.2, 6.3, 6.4, 6.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('changing chat.extractionOllamaModel does not change the chat model (Req 6.5)', async () => {
    const { getProviderConfigFromSettings, getExtractionProviderConfig } = await import('../ai-provider-config')

    const baseChat = {
      chat: { provider: 'ollama', ollamaModel: 'llama3.2' },
      transcription: { geminiApiKey: '' },
      embeddings: { ollamaBaseUrl: 'http://localhost:11434' },
    }

    // Extraction model A → chat still resolves llama3.2.
    mockGetConfig.mockReturnValue({
      ...baseChat,
      chat: { ...baseChat.chat, extractionOllamaModel: 'gemma3:12b' },
    })
    expect(getExtractionProviderConfig()?.model).toBe('gemma3:12b')
    expect(getProviderConfigFromSettings()?.model).toBe('llama3.2')

    // Extraction model B → chat is STILL llama3.2, extraction tracks the new key.
    mockGetConfig.mockReturnValue({
      ...baseChat,
      chat: { ...baseChat.chat, extractionOllamaModel: 'qwen2.5:14b' },
    })
    expect(getExtractionProviderConfig()?.model).toBe('qwen2.5:14b')
    expect(getProviderConfigFromSettings()?.model).toBe('llama3.2')
  })

  it('the value-classification / chat resolver ignores chat.extractionOllamaModel (Req 6.3, 6.4)', async () => {
    // The value classifier and assistant chat both call getProviderConfigFromSettings().
    // It must resolve chat.ollamaModel regardless of any extraction override.
    mockGetConfig.mockReturnValue({
      chat: { provider: 'ollama', ollamaModel: 'llama3.2', extractionOllamaModel: 'gemma3:12b' },
      transcription: { geminiApiKey: '' },
      embeddings: { ollamaBaseUrl: 'http://localhost:11434' },
    })
    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    expect(getProviderConfigFromSettings()).toEqual({
      provider: 'ollama',
      model: 'llama3.2',           // NOT the extraction model
      baseURL: 'http://localhost:11434/api',
    })
  })

  it('extraction falls back to chat.ollamaModel when the key is blank/whitespace (Req 6.6)', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'ollama', ollamaModel: 'llama3.2', extractionOllamaModel: '   ' },
      transcription: { geminiApiKey: '' },
      embeddings: { ollamaBaseUrl: 'http://localhost:11434' },
    })
    const { getExtractionProviderConfig } = await import('../ai-provider-config')
    expect(getExtractionProviderConfig()?.model).toBe('llama3.2')
  })

  it('changing chat.ollamaModel does not leak into the Gemini extraction branch (Req 6.7)', async () => {
    // On the Gemini path, extraction returns the base cloud config unchanged even
    // when an extraction Ollama key is present.
    mockGetConfig.mockReturnValue({
      chat: {
        provider: 'gemini',
        geminiModel: 'gemini-3.5-flash',
        ollamaModel: 'llama3.2',
        extractionOllamaModel: 'gemma3:12b',
      },
      transcription: { geminiApiKey: 'test-key-123' }, // pragma: allowlist secret
    })
    const { getExtractionProviderConfig } = await import('../ai-provider-config')
    expect(getExtractionProviderConfig()).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash',
      apiKey: 'test-key-123', // pragma: allowlist secret
    })
  })
})
