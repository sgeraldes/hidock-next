/**
 * GeminiApiBrain tests — verifies it wraps @google/generative-ai identically to
 * the code it replaced (chat-llm.geminiChat, embeddings.geminiBatch, the
 * output-generator/ detectActionables generate calls) and resolves its key from
 * the credential store first, then the legacy plaintext config field.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockConfig = {
  transcription: { geminiApiKey: '' as string, geminiModel: 'gemini-3.5-flash', language: 'es' },
  chat: { geminiModel: 'gemini-chat-model' as string },
}
vi.mock('../../config', () => ({ getConfig: () => mockConfig }))

const mockGetSecret = vi.fn<(id: string, key: string) => string | null>()
vi.mock('../brain-credential-store', () => ({
  getBrainCredentialStore: () => ({ getSecret: mockGetSecret }),
}))

const mockGenerateContent = vi.fn()
const mockBatchEmbedContents = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
  batchEmbedContents: mockBatchEmbedContents,
}))
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function () {
    return { getGenerativeModel: mockGetGenerativeModel }
  }),
}))

import { GeminiApiBrain, resolveGeminiApiKey } from '../gemini-api-brain'

describe('GeminiApiBrain', () => {
  let brain: GeminiApiBrain

  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.transcription.geminiApiKey = ''
    mockConfig.transcription.geminiModel = 'gemini-3.5-flash'
    mockConfig.chat.geminiModel = 'gemini-chat-model'
    mockGetSecret.mockReturnValue(null)
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'gemini text' } })
    mockBatchEmbedContents.mockResolvedValue({ embeddings: [{ values: [1, 2, 3] }] })
    brain = new GeminiApiBrain()
  })

  describe('key resolution', () => {
    it('prefers the credential-store secret over the plaintext config key', () => {
      mockGetSecret.mockReturnValue('store-key')
      mockConfig.transcription.geminiApiKey = 'config-key'
      expect(resolveGeminiApiKey()).toBe('store-key')
    })

    it('falls back to the plaintext config key when no secret is stored', () => {
      mockGetSecret.mockReturnValue(null)
      mockConfig.transcription.geminiApiKey = 'config-key'
      expect(resolveGeminiApiKey()).toBe('config-key')
    })

    it('returns empty string when neither is set', () => {
      mockGetSecret.mockReturnValue(null)
      mockConfig.transcription.geminiApiKey = ''
      expect(resolveGeminiApiKey()).toBe('')
    })

    // FIX 1: a store-only key (empty plaintext field) must resolve truthy so the
    // transcription availability gates — which now all read resolveGeminiApiKey()
    // — treat it as configured everywhere identically.
    it('resolves a store-only key even when the plaintext config field is empty', () => {
      mockGetSecret.mockReturnValue('store-only')
      mockConfig.transcription.geminiApiKey = ''
      expect(resolveGeminiApiKey()).toBe('store-only')
    })
  })

  describe('capabilities + authStatus', () => {
    it('advertises generate/chat/analyzeAudio/embed', () => {
      const caps = brain.capabilities()
      expect([...caps].sort()).toEqual(['analyzeAudio', 'chat', 'embed', 'generate'])
    })

    it('is configured only when a key resolves', async () => {
      mockConfig.transcription.geminiApiKey = ''
      expect((await brain.authStatus()).configured).toBe(false)
      mockConfig.transcription.geminiApiKey = 'key-1'
      expect((await brain.authStatus()).configured).toBe(true)
    })
  })

  describe('generate', () => {
    beforeEach(() => {
      mockConfig.transcription.geminiApiKey = 'key-1'
    })

    it('throws when no key is configured', async () => {
      mockConfig.transcription.geminiApiKey = ''
      await expect(brain.generate([{ role: 'user', content: 'hi' }])).rejects.toThrow(/not configured/)
    })

    it('uses the transcription model by default and omits generationConfig when no opts', async () => {
      await brain.generate([{ role: 'user', content: 'hi' }], { systemPrompt: 'sys' })
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-3.5-flash', systemInstruction: 'sys' })
      )
      const req = mockGenerateContent.mock.calls[0][0]
      expect(req.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
      expect(req.generationConfig).toBeUndefined()
    })

    it('builds JSON + disabled-thinking generationConfig from opts (detectActionables shape)', async () => {
      await brain.generate([{ role: 'user', content: 'p' }], {
        maxTokens: 8192,
        json: true,
        disableThinking: true,
      })
      const req = mockGenerateContent.mock.calls[0][0]
      expect(req.generationConfig).toEqual({
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      })
    })
  })

  describe('chat', () => {
    beforeEach(() => {
      mockConfig.transcription.geminiApiKey = 'key-1'
    })

    it('uses config.chat.geminiModel, maps assistant→model and strips leading model turns', async () => {
      await brain.chat([
        { role: 'assistant', content: 'earlier' },
        { role: 'user', content: 'q' },
      ])
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-chat-model' })
      )
      const req = mockGenerateContent.mock.calls[0][0]
      expect(req.contents).toEqual([{ role: 'user', parts: [{ text: 'q' }] }])
      expect(req.generationConfig).toMatchObject({
        temperature: 0.7,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      })
    })

    it('passes an abort signal through as request options', async () => {
      const controller = new AbortController()
      await brain.chat([{ role: 'user', content: 'q' }], { signal: controller.signal })
      expect(mockGenerateContent.mock.calls[0][1]).toEqual({ signal: controller.signal })
    })
  })

  describe('embed', () => {
    it('returns [] for empty input without calling the SDK', async () => {
      const out = await brain.embed([])
      expect(out).toEqual([])
      expect(mockBatchEmbedContents).not.toHaveBeenCalled()
    })

    it('batch-embeds with gemini-embedding-001 and maps values', async () => {
      mockConfig.transcription.geminiApiKey = 'key-1'
      const out = await brain.embed(['a'])
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-embedding-001' })
      expect(out).toEqual([[1, 2, 3]])
    })
  })
})
