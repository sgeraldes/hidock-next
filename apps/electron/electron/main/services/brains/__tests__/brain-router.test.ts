/**
 * BrainRouter tests — task→brain resolution + capability-aware fallback, plus the
 * chat/embed convenience wrappers that preserve the legacy Gemini-first /
 * Ollama-fallback semantics.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIBrain, BrainCapability, BrainId, BrainRegistry } from '../index'

let mockBrainsConfig: unknown
vi.mock('../../config', () => ({ getConfig: () => ({ brains: mockBrainsConfig }) }))

import { BrainRouter } from '../brain-router'

function makeBrain(id: BrainId, caps: BrainCapability[], configured: boolean): AIBrain {
  const set = new Set(caps)
  return {
    id,
    label: id,
    capabilities: () => set,
    authStatus: async () => ({ configured, method: 'api-key' }),
    generate: vi.fn(async () => `${id}:gen`),
    chat: vi.fn(async () => `${id}:chat`),
    embed: set.has('embed') ? vi.fn(async (t: string[]) => t.map(() => [1])) : undefined,
    analyzeAudio: set.has('analyzeAudio') ? vi.fn(async () => `${id}:audio`) : undefined,
  }
}

function makeRegistry(brains: Partial<Record<BrainId, AIBrain>>): BrainRegistry {
  return {
    get: (id: BrainId) => brains[id] ?? null,
    list: () => Object.values(brains) as AIBrain[],
    has: (id: BrainId) => !!brains[id],
  } as unknown as BrainRegistry
}

describe('BrainRouter.resolve', () => {
  beforeEach(() => {
    mockBrainsConfig = undefined
  })

  it('defaults to gemini-api for generate when configured (legacy behaviour)', async () => {
    const router = new BrainRouter(
      makeRegistry({
        'gemini-api': makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], true),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      })
    )
    const b = await router.resolve('chat', 'chat')
    expect(b?.id).toBe('gemini-api')
  })

  it('falls back to ollama for chat when gemini has no key', async () => {
    const router = new BrainRouter(
      makeRegistry({
        'gemini-api': makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], false),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      })
    )
    const b = await router.resolve('chat', 'chat')
    expect(b?.id).toBe('ollama')
  })

  it('routes audio ONLY to a brain that can do it (never ollama)', async () => {
    // Even with ollama as default, audio must resolve to gemini-api.
    mockBrainsConfig = { defaultBrain: 'ollama', enabled: { 'gemini-api': true, ollama: true } }
    const router = new BrainRouter(
      makeRegistry({
        'gemini-api': makeBrain('gemini-api', ['generate', 'analyzeAudio', 'embed'], true),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      })
    )
    const b = await router.resolve('transcribeAnalyze', 'analyzeAudio')
    expect(b?.id).toBe('gemini-api')
  })

  it('returns null for audio when no capable brain is configured', async () => {
    const router = new BrainRouter(
      makeRegistry({
        'gemini-api': makeBrain('gemini-api', ['generate', 'analyzeAudio', 'embed'], false),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      })
    )
    expect(await router.resolve('transcribeAnalyze', 'analyzeAudio')).toBeNull()
  })

  it('embed resolves gemini→ollama, never a non-embed brain', async () => {
    const router = new BrainRouter(
      makeRegistry({
        'gemini-api': makeBrain('gemini-api', ['generate', 'analyzeAudio'], true), // no embed
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      })
    )
    const b = await router.resolve('embed', 'embed')
    expect(b?.id).toBe('ollama')
  })

  it('honours a per-task routing override when it advertises the need', async () => {
    mockBrainsConfig = {
      defaultBrain: 'gemini-api',
      enabled: { 'gemini-api': true, ollama: true },
      taskRouting: { chat: 'ollama' },
    }
    const router = new BrainRouter(
      makeRegistry({
        'gemini-api': makeBrain('gemini-api', ['generate', 'chat'], true),
        ollama: makeBrain('ollama', ['generate', 'chat'], true),
      })
    )
    expect((await router.resolve('chat', 'chat'))?.id).toBe('ollama')
  })

  it('ignores a per-task override that cannot satisfy the need (audio→ollama)', async () => {
    mockBrainsConfig = {
      defaultBrain: 'gemini-api',
      enabled: { 'gemini-api': true, ollama: true },
      taskRouting: { transcribeAnalyze: 'ollama' }, // ollama can't do audio
    }
    const router = new BrainRouter(
      makeRegistry({
        'gemini-api': makeBrain('gemini-api', ['generate', 'analyzeAudio'], true),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      })
    )
    expect((await router.resolve('transcribeAnalyze', 'analyzeAudio'))?.id).toBe('gemini-api')
  })

  it('skips a disabled brain', async () => {
    mockBrainsConfig = { defaultBrain: 'gemini-api', enabled: { 'gemini-api': false, ollama: true } }
    const router = new BrainRouter(
      makeRegistry({
        'gemini-api': makeBrain('gemini-api', ['generate', 'chat', 'embed'], true),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      })
    )
    expect((await router.resolve('chat', 'chat'))?.id).toBe('ollama')
  })
})

describe('BrainRouter.chat (convenience)', () => {
  beforeEach(() => {
    mockBrainsConfig = undefined
  })

  it('uses gemini when configured and does not call ollama', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], true)
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('gemini-api:chat')
    expect(ollama.chat).not.toHaveBeenCalled()
  })

  it('falls back to ollama when the gemini chat throws', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], true)
    ;(gemini.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('rate limit'))
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('ollama:chat')
    expect(ollama.chat).toHaveBeenCalledTimes(1)
  })

  it('returns null (no fallback) when the gemini chat is aborted', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], true)
    ;(gemini.chat as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('cancelled', 'AbortError')
    )
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBeNull()
    expect(ollama.chat).not.toHaveBeenCalled()
  })

  it('uses ollama directly when no cloud key is configured', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], false)
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('ollama:chat')
    expect(gemini.chat).not.toHaveBeenCalled()
  })
})

describe('BrainRouter.embed (convenience)', () => {
  beforeEach(() => {
    mockBrainsConfig = undefined
  })

  it('uses gemini embeddings when configured', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], true)
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    const out = await router.embed(['a'])
    expect(out).toEqual([[1]])
    expect(ollama.embed).not.toHaveBeenCalled()
  })

  it('falls back to ollama embeddings when gemini embed throws', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], true)
    ;(gemini.embed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    const out = await router.embed(['a'])
    expect(out).toEqual([[1]])
    expect(ollama.embed).toHaveBeenCalledTimes(1)
  })

  it('returns [] for empty input', async () => {
    const router = new BrainRouter(makeRegistry({ ollama: makeBrain('ollama', ['embed'], true) }))
    expect(await router.embed([])).toEqual([])
  })
})
