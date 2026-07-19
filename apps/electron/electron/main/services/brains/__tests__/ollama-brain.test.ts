/**
 * OllamaBrain tests — verifies it wraps OllamaService and preserves the exact
 * fallback semantics the routers relied on (null when unreachable; all-null
 * embeddings when unavailable).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsAvailable = vi.fn()
const mockChat = vi.fn()
const mockGenerate = vi.fn()
const mockGenerateEmbeddings = vi.fn()
vi.mock('../../ollama', () => ({
  getOllamaService: () => ({
    isAvailable: mockIsAvailable,
    chat: mockChat,
    generate: mockGenerate,
    generateEmbeddings: mockGenerateEmbeddings,
  }),
}))

import { OllamaBrain } from '../ollama-brain'

describe('OllamaBrain', () => {
  let brain: OllamaBrain

  beforeEach(() => {
    vi.clearAllMocks()
    brain = new OllamaBrain()
    mockIsAvailable.mockResolvedValue(true)
    mockChat.mockResolvedValue('ollama chat')
    mockGenerate.mockResolvedValue('ollama gen')
    mockGenerateEmbeddings.mockResolvedValue([[9, 9]])
  })

  it('advertises generate/chat/embed only', () => {
    expect([...brain.capabilities()].sort()).toEqual(['chat', 'embed', 'generate'])
  })

  it('authStatus reflects Ollama reachability', async () => {
    mockIsAvailable.mockResolvedValue(true)
    expect((await brain.authStatus()).configured).toBe(true)
    mockIsAvailable.mockResolvedValue(false)
    expect((await brain.authStatus()).configured).toBe(false)
  })

  it('generate() forwards a single-prompt + systemPrompt to OllamaService.generate', async () => {
    const out = await brain.generate([{ role: 'user', content: 'the prompt' }], { systemPrompt: 'sys' })
    expect(out).toBe('ollama gen')
    expect(mockGenerate).toHaveBeenCalledWith('the prompt', 'sys')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('chat() forwards to OllamaService.chat with options', async () => {
    const signal = new AbortController().signal
    const out = await brain.chat([{ role: 'user', content: 'hi' }], {
      systemPrompt: 'sys',
      temperature: 0.2,
      maxTokens: 50,
      signal,
    })
    expect(out).toBe('ollama chat')
    expect(mockChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hi' }],
      { systemPrompt: 'sys', temperature: 0.2, maxTokens: 50, signal }
    )
  })

  it('embed() returns vectors when Ollama is available', async () => {
    const out = await brain.embed(['a'])
    expect(out).toEqual([[9, 9]])
    // ADV43-2 (round-45) — forwards the shouldGenerate gate into the per-text loop.
    expect(mockGenerateEmbeddings).toHaveBeenCalledWith(['a'], { shouldGenerate: undefined })
  })

  it('embed() forwards shouldGenerate to OllamaService.generateEmbeddings (round-45 ADV43-2)', async () => {
    const shouldGenerate = () => true
    await brain.embed(['a', 'b'], { shouldGenerate })
    expect(mockGenerateEmbeddings).toHaveBeenCalledWith(['a', 'b'], { shouldGenerate })
  })

  it('embed() returns all-null when Ollama is unavailable', async () => {
    mockIsAvailable.mockResolvedValue(false)
    const out = await brain.embed(['a', 'b'])
    expect(out).toEqual([null, null])
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
  })

  it('embed([]) short-circuits to []', async () => {
    expect(await brain.embed([])).toEqual([])
  })
})
