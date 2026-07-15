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
      apiKey: 'test-key-123'
    })
  })

  it('falls back to the gemini-3.5-flash default when chat.geminiModel is empty', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'gemini', geminiModel: '' },
      transcription: { geminiApiKey: 'test-key-123' }
    })

    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    const config = getProviderConfigFromSettings()

    expect(config).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash',
      apiKey: 'test-key-123'
    })
  })

  it('honours a custom chat.geminiModel', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'gemini', geminiModel: 'gemini-custom-model' },
      transcription: { geminiApiKey: 'test-key-123' }
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

  it('returns null when chat.provider is not gemini (e.g. ollama)', async () => {
    mockGetConfig.mockReturnValue({
      chat: { provider: 'ollama', geminiModel: 'gemini-3.5-flash', ollamaModel: 'llama3.2' },
      transcription: { geminiApiKey: 'test-key-123' }
    })

    const { getProviderConfigFromSettings } = await import('../ai-provider-config')
    expect(getProviderConfigFromSettings()).toBeNull()
  })
})
