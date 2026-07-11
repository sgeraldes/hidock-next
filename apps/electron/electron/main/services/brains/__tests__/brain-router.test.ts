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

// Real OllamaBrain (used by the probe-count / no-preflight tests) delegates to
// getOllamaService(); these hoisted spies let us count availability probes and
// route chat/embed without a live Ollama.
const { mockIsAvailable, mockGenerateEmbeddings, mockOllamaChat } = vi.hoisted(() => ({
  mockIsAvailable: vi.fn(async () => true),
  mockGenerateEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => [7])),
  mockOllamaChat: vi.fn(async () => 'ollama:chat'),
}))
vi.mock('../../ollama', () => ({
  getOllamaService: () => ({
    isAvailable: mockIsAvailable,
    generateEmbeddings: mockGenerateEmbeddings,
    chat: mockOllamaChat,
    generate: vi.fn(async () => 'ollama:gen'),
  }),
}))

import { BrainRouter } from '../brain-router'
import { OllamaBrain } from '../ollama-brain'

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

  // FIX 5: after a Gemini error the fallback must honour the enabled toggle.
  it('does NOT fall back to a disabled Ollama after a Gemini chat error', async () => {
    mockBrainsConfig = { defaultBrain: 'gemini-api', enabled: { 'gemini-api': true, ollama: false } }
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], true)
    ;(gemini.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('rate limit'))
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBeNull()
    expect(ollama.chat).not.toHaveBeenCalled()
  })

  // FIX 3: the no-Gemini path calls Ollama directly with the caller's signal —
  // it must NOT block on an uncancellable /api/tags availability preflight.
  it('calls Ollama chat directly with NO availability preflight probe (no-Gemini path)', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], false) // no key
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama: new OllamaBrain() }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('ollama:chat')
    expect(mockOllamaChat).toHaveBeenCalledTimes(1)
    expect(mockIsAvailable).not.toHaveBeenCalled() // no preflight isAvailable() probe
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

  // FIX 4: the no-Gemini embed path must probe Ollama availability exactly ONCE
  // (only the adapter's internal probe) — no extra resolve()-time probe that
  // could disagree and yield spurious null vectors.
  it('probes Ollama availability exactly once (no double-probe) on the embed path', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], false) // no key
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama: new OllamaBrain() }))
    const out = await router.embed(['a', 'b'])
    expect(out).toEqual([[7], [7]])
    expect(mockIsAvailable).toHaveBeenCalledTimes(1)
    expect(mockGenerateEmbeddings).toHaveBeenCalledTimes(1)
  })

  // FIX 5: embed fallback must honour the enabled toggle after a Gemini error.
  it('does NOT fall back to a disabled Ollama after a Gemini embed error', async () => {
    mockBrainsConfig = { defaultBrain: 'gemini-api', enabled: { 'gemini-api': true, ollama: false } }
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], true)
    ;(gemini.embed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    expect(await router.embed(['a'])).toEqual([null])
    expect(ollama.embed).not.toHaveBeenCalled()
  })

  // Embed audit: a non-Gemini but EMBED-CAPABLE default (ollama) must be
  // honoured even when Gemini is configured — embeddings must NOT silently
  // prefer Gemini over the user's chosen default.
  it('honours a non-gemini embed-capable default (ollama) even when gemini has a key', async () => {
    mockBrainsConfig = { defaultBrain: 'ollama', enabled: { 'gemini-api': true, ollama: true } }
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], true)
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama }))
    expect(await router.embed(['a'])).toEqual([[1]])
    expect(gemini.embed).not.toHaveBeenCalled()
    expect(ollama.embed).toHaveBeenCalledTimes(1)
  })
})

describe('BrainRouter.chat (agentic default / routing)', () => {
  beforeEach(() => {
    mockBrainsConfig = undefined
  })

  const enableAll = { 'gemini-api': true, ollama: true, 'claude-code': true, codex: true }

  it('routes chat to the claude-code brain when it is the default (gemini NOT called)', async () => {
    mockBrainsConfig = { defaultBrain: 'claude-code', enabled: enableAll }
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], true)
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const claude = makeBrain('claude-code', ['generate', 'chat', 'agentic'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama, 'claude-code': claude }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('claude-code:chat')
    expect(claude.chat).toHaveBeenCalledTimes(1)
    expect(gemini.chat).not.toHaveBeenCalled()
    expect(ollama.chat).not.toHaveBeenCalled()
  })

  it('lets taskRouting.chat=codex win over defaultBrain=gemini-api', async () => {
    mockBrainsConfig = {
      defaultBrain: 'gemini-api',
      enabled: enableAll,
      taskRouting: { chat: 'codex' },
    }
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], true)
    const codex = makeBrain('codex', ['generate', 'chat', 'agentic'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, codex }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('codex:chat')
    expect(codex.chat).toHaveBeenCalledTimes(1)
    expect(gemini.chat).not.toHaveBeenCalled()
  })

  // Legacy regression: a DEFAULT config must stay Gemini-first and never consult
  // an agentic brain, even when one is registered (byte-identical to the old
  // Gemini-first path the earlier tests pin).
  it('default config stays Gemini-first and never consults an agentic brain', async () => {
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed', 'analyzeAudio'], true)
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const claude = makeBrain('claude-code', ['generate', 'chat', 'agentic'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama, 'claude-code': claude }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('gemini-api:chat')
    expect(claude.chat).not.toHaveBeenCalled()
    expect(ollama.chat).not.toHaveBeenCalled()
  })

  it('falls through the capability chain when a disabled agentic brain is the default', async () => {
    mockBrainsConfig = {
      defaultBrain: 'claude-code',
      enabled: { 'claude-code': false, 'gemini-api': true, ollama: true },
    }
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], true)
    const ollama = makeBrain('ollama', ['generate', 'chat', 'embed'], true)
    const claude = makeBrain('claude-code', ['generate', 'chat', 'agentic'], true)
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, ollama, 'claude-code': claude }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('gemini-api:chat')
    expect(claude.chat).not.toHaveBeenCalled()
  })

  it('returns null (no fallback) when an agentic chat is aborted', async () => {
    mockBrainsConfig = { defaultBrain: 'claude-code', enabled: enableAll }
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], true)
    const claude = makeBrain('claude-code', ['generate', 'chat', 'agentic'], true)
    ;(claude.chat as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('cancelled', 'AbortError')
    )
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, 'claude-code': claude }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBeNull()
    expect(gemini.chat).not.toHaveBeenCalled()
  })

  it('falls back capability-aware after a failed agentic primary', async () => {
    mockBrainsConfig = { defaultBrain: 'claude-code', enabled: enableAll }
    const gemini = makeBrain('gemini-api', ['generate', 'chat', 'embed'], true)
    const claude = makeBrain('claude-code', ['generate', 'chat', 'agentic'], true)
    ;(claude.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cli crashed'))
    const router = new BrainRouter(makeRegistry({ 'gemini-api': gemini, 'claude-code': claude }))
    expect(await router.chat('chat', [{ role: 'user', content: 'hi' }])).toBe('gemini-api:chat')
    expect(claude.chat).toHaveBeenCalledTimes(1)
    expect(gemini.chat).toHaveBeenCalledTimes(1)
  })

  it('forwards opts (incl. signal) to the agentic brain chat', async () => {
    mockBrainsConfig = { defaultBrain: 'claude-code', enabled: enableAll }
    const claude = makeBrain('claude-code', ['generate', 'chat', 'agentic'], true)
    const router = new BrainRouter(makeRegistry({ 'claude-code': claude }))
    const signal = new AbortController().signal
    const msgs = [{ role: 'user' as const, content: 'hi' }]
    await router.chat('chat', msgs, { signal })
    expect(claude.chat).toHaveBeenCalledWith(msgs, expect.objectContaining({ signal }))
  })
})

describe('BrainRouter.resolvePrimaryChatBrainId', () => {
  beforeEach(() => {
    mockBrainsConfig = undefined
  })

  // The helper MUST return the brain chat() actually invokes FIRST — this is the
  // contract rag.ts's per-brain token budget relies on. Parametrized across the
  // default / routing / disabled / no-cloud cases.
  const cases: Array<{
    name: string
    config: unknown
    brains: () => Partial<Record<BrainId, AIBrain>>
    expected: BrainId
  }> = [
    {
      name: 'default config → gemini-api',
      config: undefined,
      brains: () => ({
        'gemini-api': makeBrain('gemini-api', ['generate', 'chat', 'embed'], true),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      }),
      expected: 'gemini-api',
    },
    {
      name: 'taskRouting.chat=codex → codex',
      config: { defaultBrain: 'gemini-api', enabled: { 'gemini-api': true, codex: true }, taskRouting: { chat: 'codex' } },
      brains: () => ({
        'gemini-api': makeBrain('gemini-api', ['generate', 'chat', 'embed'], true),
        codex: makeBrain('codex', ['generate', 'chat', 'agentic'], true),
      }),
      expected: 'codex',
    },
    {
      name: 'disabled agentic default → falls through to gemini-api',
      config: { defaultBrain: 'claude-code', enabled: { 'claude-code': false, 'gemini-api': true, ollama: true } },
      brains: () => ({
        'gemini-api': makeBrain('gemini-api', ['generate', 'chat', 'embed'], true),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
        'claude-code': makeBrain('claude-code', ['generate', 'chat', 'agentic'], true),
      }),
      expected: 'gemini-api',
    },
    {
      name: 'no cloud key → ollama',
      config: undefined,
      brains: () => ({
        'gemini-api': makeBrain('gemini-api', ['generate', 'chat', 'embed'], false),
        ollama: makeBrain('ollama', ['generate', 'chat', 'embed'], true),
      }),
      expected: 'ollama',
    },
  ]

  it.each(cases)('agrees with chat()\'s first-invoked brain: $name', async ({ config, brains, expected }) => {
    mockBrainsConfig = config
    const registry = brains()
    const router = new BrainRouter(makeRegistry(registry))

    const id = await router.resolvePrimaryChatBrainId()
    expect(id).toBe(expected)

    await router.chat('chat', [{ role: 'user', content: 'hi' }])
    // The helper's id is exactly the brain whose chat() ran first.
    expect(registry[expected]!.chat).toHaveBeenCalledTimes(1)
    for (const [bid, brain] of Object.entries(registry)) {
      if (bid !== expected) expect(brain.chat).not.toHaveBeenCalled()
    }
  })
})
