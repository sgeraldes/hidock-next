/**
 * Local ONNX embedding brain (Nemotron-3-Embed, in-process).
 *
 * The first (and only) brain whose inference happens entirely inside the
 * Electron main process — no API key, no CLI, no server, no network. Wraps
 * LocalEmbedderService behind the AIBrain seam so the BrainRouter can route
 * the `embed` task to it (explicit taskRouting.embed, embed-capable
 * defaultBrain, or the capability fallback chain).
 *
 * Semantics the router relies on:
 * - authStatus is a LOCAL fs check (model files present) — no network probe,
 *   so it is safe in selection paths where Ollama's probe is banned.
 * - embed() THROWS when the model is absent/unloadable: a missing model is a
 *   configuration error, NOT an eligibility abort, so the router moves on to
 *   the next fallback. The fail-closed shouldGenerate gate returns nulls
 *   instead (same contract as the other adapters — nulls mean "stop, do not
 *   fall through to another provider").
 * - `purpose` drives the model's asymmetric prefixes via the service.
 */

import { getLocalEmbedder } from '../local-embedder'
import { eligibleToGenerate } from './eligibility'
import type {
  AIBrain,
  BrainAuthStatus,
  BrainCapability,
  BrainMessage,
  EmbedOptions,
  GenerateOptions,
} from './types'

const CAPABILITIES: ReadonlySet<BrainCapability> = new Set<BrainCapability>(['embed'])

export class LocalOnnxEmbedBrain implements AIBrain {
  readonly id = 'local-onnx-embed' as const
  readonly label = 'Local Nemotron Embed (in-process)'

  capabilities(): ReadonlySet<BrainCapability> {
    return CAPABILITIES
  }

  /** Local fs check only — cheap, cached by the caller's standards, never throws. */
  async authStatus(): Promise<BrainAuthStatus> {
    try {
      const present = getLocalEmbedder().isModelPresent()
      return {
        configured: present,
        method: 'none',
        detail: present ? 'model present (in-process ONNX)' : 'model not downloaded — see Settings → Embeddings',
      }
    } catch {
      return { configured: false, method: 'none', detail: 'model check failed' }
    }
  }

  // Text-generation capabilities this brain does not have.
  async generate(_messages: BrainMessage[], _opts?: GenerateOptions): Promise<string | null> {
    return null
  }

  async chat(_messages: BrainMessage[], _opts?: GenerateOptions): Promise<string | null> {
    return null
  }

  async embed(texts: string[], opts: EmbedOptions = {}): Promise<(number[] | null)[]> {
    if (texts.length === 0) return []
    const embedder = getLocalEmbedder()
    if (!embedder.isModelPresent()) {
      // Config error, not an abort — let the router try the next fallback.
      throw new Error('[LocalOnnxEmbed] model files not present')
    }
    if (!eligibleToGenerate(opts.shouldGenerate)) {
      return texts.map(() => null)
    }
    const vectors = await embedder.embed(texts, opts.purpose ?? 'passage')
    if (!vectors) {
      throw new Error('[LocalOnnxEmbed] embedding session failed')
    }
    return vectors
  }
}
