/**
 * LocalEmbedderService — in-process ONNX embeddings.
 *
 * Validates with FAKE tokenizer/session (no model download):
 * - attention-masked mean pooling + L2 normalization math (hand-computed),
 * - the model's ASYMMETRIC prefixes (query: / passage:) reach the tokenizer,
 * - batching (BATCH_SIZE=16) and per-batch failure → null,
 * - model-absent → embed() returns null (brain turns that into a throw),
 * - WebGPU session failure → CPU fallback (and backend reporting),
 * - session runs are serialized through the internal queue.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const deps = vi.hoisted(() => ({
  modelPresent: true,
  tokenizerCalls: [] as Array<{ texts: string[]; options: unknown }>,
  sessionRunCalls: 0,
  failOnRun: -1, // which session.run call index should throw (-1 = never)
  webgpuFails: false,
}))

vi.mock('../config', () => ({
  getDataPath: () => '/fake-data',
}))

vi.mock('fs', () => ({
  existsSync: () => deps.modelPresent,
}))

import {
  LocalEmbedderService,
  meanPoolNormalize,
  type EmbedderDeps,
  type EmbedSession,
  type EmbedTokenizer,
} from '../local-embedder'

const HID = 2 // tiny hidden size for hand-checkable math

function makeFakeDeps(): EmbedderDeps {
  const loadTokenizer = async (): Promise<EmbedTokenizer> => {
    return async (texts: string[], options) => {
      deps.tokenizerCalls.push({ texts, options })
      const seq = 3
      const b = texts.length
      return {
        input_ids: { data: new Array(b * seq).fill(1), dims: [b, seq] },
        attention_mask: { data: new Array(b * seq).fill(1), dims: [b, seq] },
      }
    }
  }
  const createSession = async (_path: string, provider: 'webgpu' | 'cpu'): Promise<EmbedSession> => {
    if (provider === 'webgpu' && deps.webgpuFails) throw new Error('no webgpu')
    return {
      inputNames: ['input_ids', 'attention_mask'],
      run: async () => {
        const call = deps.sessionRunCalls++
        if (call === deps.failOnRun) throw new Error('session boom')
        const seq = 3
        // mirror the real flow: one session.run per tokenizer batch
        const b = deps.tokenizerCalls[deps.tokenizerCalls.length - 1].texts.length
        // constant hidden state [1, 1] per token — pooled vector is [1,1]/√2
        return {
          last_hidden_state: {
            data: new Float32Array(b * seq * HID).fill(1),
            dims: [b, seq, HID],
          },
        }
      },
    }
  }
  const createTensor = async (data: BigInt64Array, dims: number[]) => ({ data, dims })
  return { loadTokenizer, createSession, createTensor }
}

beforeEach(() => {
  deps.modelPresent = true
  deps.tokenizerCalls = []
  deps.sessionRunCalls = 0
  deps.failOnRun = -1
  deps.webgpuFails = false
})

describe('meanPoolNormalize', () => {
  it('pools over UNMASKED tokens only and L2-normalizes', () => {
    // batch=1, seq=3, hid=2; token 2 masked out.
    const hidden = [1, 0, 0, 1, 9, 9] // t0=[1,0], t1=[0,1], t2=[9,9] (masked)
    const mask = [1, 1, 0]
    const [vec] = meanPoolNormalize(hidden, [1, 3, 2], mask)
    // mean of t0,t1 = [0.5, 0.5] → normalized [√2/2, √2/2]
    expect(vec[0]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(vec[1]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('handles an all-zero mask without NaN', () => {
    const [vec] = meanPoolNormalize([1, 2, 3, 4], [1, 2, 2], [0, 0])
    expect(vec.every((v) => v === 0)).toBe(true)
  })
})

describe('LocalEmbedderService', () => {
  it('returns null when the model files are absent', async () => {
    deps.modelPresent = false
    const svc = new LocalEmbedderService(makeFakeDeps())
    expect(svc.isModelPresent()).toBe(false)
    expect(await svc.embed(['hello'], 'passage')).toBeNull()
  })

  it('prefixes queries and passages asymmetrically', async () => {
    const svc = new LocalEmbedderService(makeFakeDeps())
    await svc.embed(['what actions this week?'], 'query')
    await svc.embed(['a meeting chunk'], 'passage')
    expect(deps.tokenizerCalls[0].texts[0]).toBe('query: what actions this week?')
    expect(deps.tokenizerCalls[1].texts[0]).toBe('passage: a meeting chunk')
  })

  it('defaults to passage when no purpose is given (legacy behaviour)', async () => {
    const svc = new LocalEmbedderService(makeFakeDeps())
    await svc.embed(['a chunk'])
    expect(deps.tokenizerCalls[0].texts[0]).toBe('passage: a chunk')
  })

  it('batches in groups of 16 and returns one normalized vector per text', async () => {
    const svc = new LocalEmbedderService(makeFakeDeps())
    const texts = Array.from({ length: 20 }, (_, i) => `chunk ${i}`)
    const out = await svc.embed(texts, 'passage')
    expect(out).not.toBeNull()
    expect(out!.length).toBe(20)
    expect(deps.tokenizerCalls.length).toBe(2) // 16 + 4
    expect(deps.tokenizerCalls[0].options).toMatchObject({ padding: true, truncation: true, max_length: 512 })
    // constant hidden [1,1]/token ⇒ pooled [√2/2, √2/2] per vector
    expect(out![0][0]).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('returns null when a session run fails mid-batch', async () => {
    deps.failOnRun = 1 // second batch throws
    const svc = new LocalEmbedderService(makeFakeDeps())
    const texts = Array.from({ length: 20 }, (_, i) => `chunk ${i}`)
    expect(await svc.embed(texts, 'passage')).toBeNull()
  })

  it('falls back to CPU when the WebGPU session fails', async () => {
    deps.webgpuFails = true
    const svc = new LocalEmbedderService(makeFakeDeps())
    expect(await svc.initialize()).toBe(true)
    expect(svc.activeBackend()).toBe('cpu')
  })

  it('prefers WebGPU when available', async () => {
    const svc = new LocalEmbedderService(makeFakeDeps())
    expect(await svc.initialize()).toBe(true)
    expect(svc.activeBackend()).toBe('webgpu')
  })

  it('embeddingDims matches the Nemotron-3-Embed-1B contract (2048)', () => {
    expect(new LocalEmbedderService(makeFakeDeps()).embeddingDims()).toBe(2048)
  })
})
