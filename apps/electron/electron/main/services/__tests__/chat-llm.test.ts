/**
 * Chat LLM Service Tests
 *
 * Verifies Gemini-first routing with Ollama fallback for the RAG assistant:
 *   - Gemini key configured        → Gemini is used, backend = 'gemini'
 *   - No key, Ollama reachable      → Ollama is used, backend = 'ollama'
 *   - No key, Ollama unreachable    → backend = 'none', generate() returns null
 *
 * @vitest-environment node
 */

// Mocks must be defined before importing the module under test.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- config mock (mutable geminiApiKey / chat model) ---
const mockConfig = {
  transcription: { geminiApiKey: '' as string },
  chat: { geminiModel: 'gemini-3.5-flash' as string }
}
vi.mock('../config', () => ({
  getConfig: () => mockConfig
}))

// --- Ollama mock ---
const mockOllamaIsAvailable = vi.fn()
const mockOllamaChat = vi.fn()
vi.mock('../ollama', () => ({
  getOllamaService: () => ({
    isAvailable: mockOllamaIsAvailable,
    chat: mockOllamaChat
  })
}))

// --- Gemini SDK mock ---
const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({ generateContent: mockGenerateContent }))
// Vitest 4 requires a `function` (not an arrow) for a mock used with `new` —
// GoogleGenerativeAI is constructed via `new GoogleGenerativeAI(apiKey)`.
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function () {
    return { getGenerativeModel: mockGetGenerativeModel }
  })
}))

import { getChatLLMService, resetChatLLMService } from '../chat-llm'

describe('ChatLLMService routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChatLLMService()
    mockConfig.transcription.geminiApiKey = ''
    mockConfig.chat.geminiModel = 'gemini-3.5-flash'
    mockOllamaIsAvailable.mockResolvedValue(false)
    mockOllamaChat.mockResolvedValue(null)
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'gemini answer' } })
  })

  describe('getStatus', () => {
    it('reports gemini when an API key is configured (regardless of Ollama)', async () => {
      mockConfig.transcription.geminiApiKey = 'key-123' // pragma: allowlist secret
      mockOllamaIsAvailable.mockResolvedValue(false)

      const status = await getChatLLMService().getStatus()
      expect(status).toEqual({ backend: 'gemini', geminiConfigured: true, ollamaAvailable: false })
    })

    it('reports ollama when no key but Ollama is reachable', async () => {
      mockConfig.transcription.geminiApiKey = ''
      mockOllamaIsAvailable.mockResolvedValue(true)

      const status = await getChatLLMService().getStatus()
      expect(status).toEqual({ backend: 'ollama', geminiConfigured: false, ollamaAvailable: true })
    })

    it('reports none when neither backend is available', async () => {
      mockConfig.transcription.geminiApiKey = ''
      mockOllamaIsAvailable.mockResolvedValue(false)

      const status = await getChatLLMService().getStatus()
      expect(status).toEqual({ backend: 'none', geminiConfigured: false, ollamaAvailable: false })
    })
  })

  describe('generate', () => {
    it('uses Gemini when a key is configured and does not touch Ollama', async () => {
      mockConfig.transcription.geminiApiKey = 'key-123' // pragma: allowlist secret

      const answer = await getChatLLMService().generate(
        [{ role: 'user', content: 'hello' }],
        { systemPrompt: 'be brief' }
      )

      expect(answer).toBe('gemini answer')
      expect(mockGenerateContent).toHaveBeenCalledTimes(1)
      expect(mockOllamaChat).not.toHaveBeenCalled()
      // Model resolved from config.chat.geminiModel with system instruction wired in.
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-3.5-flash', systemInstruction: 'be brief' })
      )
    })

    it('maps assistant turns to Gemini "model" role and strips leading model turns', async () => {
      mockConfig.transcription.geminiApiKey = 'key-123' // pragma: allowlist secret

      await getChatLLMService().generate([
        { role: 'assistant', content: 'earlier reply' }, // leading model turn — must be dropped
        { role: 'user', content: 'question' }
      ])

      const req = mockGenerateContent.mock.calls[0][0]
      expect(req.contents).toEqual([{ role: 'user', parts: [{ text: 'question' }] }])
    })

    it('falls back to Ollama when no Gemini key is set', async () => {
      mockConfig.transcription.geminiApiKey = ''
      mockOllamaIsAvailable.mockResolvedValue(true)
      mockOllamaChat.mockResolvedValue('ollama answer')

      const answer = await getChatLLMService().generate([{ role: 'user', content: 'hi' }])

      expect(answer).toBe('ollama answer')
      expect(mockGenerateContent).not.toHaveBeenCalled()
      expect(mockOllamaChat).toHaveBeenCalledTimes(1)
    })

    it('falls back to Ollama when the Gemini call throws', async () => {
      mockConfig.transcription.geminiApiKey = 'key-123' // pragma: allowlist secret
      mockGenerateContent.mockRejectedValue(new Error('rate limit'))
      mockOllamaChat.mockResolvedValue('ollama answer')

      const answer = await getChatLLMService().generate([{ role: 'user', content: 'hi' }])

      expect(answer).toBe('ollama answer')
      expect(mockOllamaChat).toHaveBeenCalledTimes(1)
    })

    it('returns null when neither backend can answer', async () => {
      mockConfig.transcription.geminiApiKey = ''
      mockOllamaIsAvailable.mockResolvedValue(false)
      mockOllamaChat.mockResolvedValue(null)

      const answer = await getChatLLMService().generate([{ role: 'user', content: 'hi' }])
      expect(answer).toBeNull()
    })

    it('passes an abort signal through to Gemini', async () => {
      mockConfig.transcription.geminiApiKey = 'key-123' // pragma: allowlist secret
      const controller = new AbortController()

      await getChatLLMService().generate([{ role: 'user', content: 'hi' }], {
        signal: controller.signal
      })

      const requestOptions = mockGenerateContent.mock.calls[0][1]
      expect(requestOptions).toEqual({ signal: controller.signal })
    })
  })
})
