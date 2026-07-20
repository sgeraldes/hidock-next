/**
 * LocalOnnxEmbedBrain — AIBrain semantics for the in-process embedder.
 *
 * - capabilities: embed only (never resolved for chat/generate/audio).
 * - authStatus: local fs presence, configured ⇔ model present (no probe).
 * - embed(): THROWS when the model is absent (config error ⇒ router tries
 *   the next fallback) — but returns NULLS on a shouldGenerate abort
 *   (fail-closed: an aborted source must NOT reach any further provider).
 * - purpose is threaded into the service (asymmetric prefixes).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const deps = vi.hoisted(() => ({
  modelPresent: true,
  serviceReturnsNull: false,
  embedCalls: [] as Array<{ texts: string[]; purpose: string }>,
}))

vi.mock('../../local-embedder', () => ({
  getLocalEmbedder: () => ({
    isModelPresent: () => deps.modelPresent,
    embed: async (texts: string[], purpose: string) => {
      deps.embedCalls.push({ texts, purpose })
      if (deps.serviceReturnsNull) return null
      return texts.map(() => [0.5, 0.5])
    },
  }),
}))

import { LocalOnnxEmbedBrain } from '../local-onnx-embed-brain'

beforeEach(() => {
  deps.modelPresent = true
  deps.serviceReturnsNull = false
  deps.embedCalls = []
})

describe('LocalOnnxEmbedBrain', () => {
  it('advertises only the embed capability', () => {
    const brain = new LocalOnnxEmbedBrain()
    expect(brain.id).toBe('local-onnx-embed')
    expect(brain.capabilities().has('embed')).toBe(true)
    expect(brain.capabilities().size).toBe(1)
  })

  it('authStatus reflects model presence (local check, no probe)', async () => {
    const brain = new LocalOnnxEmbedBrain()
    expect((await brain.authStatus()).configured).toBe(true)
    deps.modelPresent = false
    const off = await brain.authStatus()
    expect(off.configured).toBe(false)
    expect(off.detail).toContain('not downloaded')
  })

  it('generate/chat are null (embed-only brain)', async () => {
    const brain = new LocalOnnxEmbedBrain()
    expect(await brain.generate([{ role: 'user', content: 'hi' }])).toBeNull()
    expect(await brain.chat([{ role: 'user', content: 'hi' }])).toBeNull()
  })

  it('THROWS when the model is absent (config error → next fallback)', async () => {
    deps.modelPresent = false
    const brain = new LocalOnnxEmbedBrain()
    await expect(brain.embed(['x'])).rejects.toThrow('not present')
  })

  it('returns NULLS on a shouldGenerate abort (fail-closed, no provider fall-through)', async () => {
    const brain = new LocalOnnxEmbedBrain()
    const out = await brain.embed(['a', 'b'], { shouldGenerate: () => false })
    expect(out).toEqual([null, null])
    expect(deps.embedCalls.length).toBe(0) // never reached the model
  })

  it('threads purpose into the service (asymmetric prefixes)', async () => {
    const brain = new LocalOnnxEmbedBrain()
    await brain.embed(['q'], { purpose: 'query' })
    await brain.embed(['d'])
    expect(deps.embedCalls[0].purpose).toBe('query')
    expect(deps.embedCalls[1].purpose).toBe('passage') // default
  })

  it('throws when the embedding session itself fails (router tries next)', async () => {
    deps.serviceReturnsNull = true
    const brain = new LocalOnnxEmbedBrain()
    await expect(brain.embed(['x'])).rejects.toThrow('session failed')
  })

  it('returns one vector per input text on the happy path', async () => {
    const brain = new LocalOnnxEmbedBrain()
    expect(await brain.embed(['a', 'b', 'c'])).toEqual([
      [0.5, 0.5],
      [0.5, 0.5],
      [0.5, 0.5],
    ])
  })
})
