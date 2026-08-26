/**
 * OllamaService.generateEmbeddings fail-closed per-request gate (round-45 ADV43-2).
 *
 * Ollama emits ONE embedding request per text. The shouldGenerate gate threaded
 * from the OllamaBrain adapter must be re-evaluated IMMEDIATELY before EACH
 * per-text request: an owner exclusion committed while an earlier request is
 * pending must stop every later request (the remaining texts return null — the
 * "no embedding available" shape callers persist as nothing).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config', () => ({ getConfig: () => ({ embeddings: {}, chat: {} }) }))
vi.mock('@hidock/ai-providers', () => ({ embed: vi.fn(async () => ({ embedding: [1] })) }))

import { OllamaService } from '../ollama'

describe('OllamaService.generateEmbeddings shouldGenerate gate (round-45 ADV43-2)', () => {
  let svc: OllamaService

  beforeEach(() => {
    svc = new OllamaService()
  })

  it('exclusion after the first request ⇒ later per-text requests are NOT made', async () => {
    let excluded = false
    const spy = vi.spyOn(svc, 'generateEmbedding').mockImplementation(async () => {
      // Simulate the owner excluding the recording while this request awaits.
      excluded = true
      return [1, 2, 3]
    })
    const out = await svc.generateEmbeddings(['a', 'b', 'c'], { shouldGenerate: () => !excluded })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(out).toEqual([[1, 2, 3], null, null])
  })

  it('false up front ⇒ NO per-text request is made, all-null', async () => {
    const spy = vi.spyOn(svc, 'generateEmbedding')
    const out = await svc.generateEmbeddings(['a', 'b'], { shouldGenerate: () => false })
    expect(spy).not.toHaveBeenCalled()
    expect(out).toEqual([null, null])
  })

  it('a shouldGenerate that THROWS is fail-closed ⇒ NO request', async () => {
    const spy = vi.spyOn(svc, 'generateEmbedding')
    const out = await svc.generateEmbeddings(['a'], {
      shouldGenerate: () => {
        throw new Error('eligibility lookup failed')
      },
    })
    expect(spy).not.toHaveBeenCalled()
    expect(out).toEqual([null])
  })

  it('control: a gate that stays true makes one request per text', async () => {
    const spy = vi.spyOn(svc, 'generateEmbedding').mockResolvedValue([7])
    const out = await svc.generateEmbeddings(['a', 'b', 'c'], { shouldGenerate: () => true })
    expect(spy).toHaveBeenCalledTimes(3)
    expect(out).toEqual([[7], [7], [7]])
  })

  it('no gate configured ⇒ unchanged legacy behaviour (one request per text)', async () => {
    const spy = vi.spyOn(svc, 'generateEmbedding').mockResolvedValue([5])
    const out = await svc.generateEmbeddings(['a', 'b'])
    expect(spy).toHaveBeenCalledTimes(2)
    expect(out).toEqual([[5], [5]])
  })
})
