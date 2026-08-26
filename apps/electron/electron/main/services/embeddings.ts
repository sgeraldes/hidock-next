/**
 * Embeddings Service
 *
 * Provider-routing for text embeddings used by the vector store / RAG:
 * - Gemini `gemini-embedding-001` (same API key as transcription) — primary.
 *   Verified live: 3072-dim vectors, batch endpoint supported.
 * - Local Nemotron-3-Embed (in-process ONNX, `local-onnx-embed` brain) —
 *   2048-dim, no network; asymmetric `query:`/`passage:` prefixes.
 * - Ollama (local) — fallback when no Gemini key is configured.
 *
 * The previous implementation was Ollama-only, so on machines without Ollama
 * every transcript indexed 0 chunks and the assistant had no memory.
 *
 * ASYMMETRIC RETRIEVAL — `purpose`: retrieval-trained models embed queries
 * and documents differently (Nemotron prefixes, Gemini task types). Indexing
 * passes 'passage', searching passes 'query'. The vector store partitions
 * chunks by the provider that embedded them (embed_provider column) and
 * searches only the ACTIVE provider's partition — a provider switch never
 * silently zeroes retrieval (the 2026-07 defaultBrain=codex incident), it
 * just changes which partition serves.
 */

import { getConfig } from './config'
import { getBrainRouter } from './brains'
import type { BrainId } from './brains'

/**
 * Per-provider RAG relevance gate (used by rag.ts). Cosine SCORE SCALES are
 * model-specific, not comparable across providers: with Gemini embeddings
 * relevant chunks score ~0.4-0.8, while Nemotron-3 relevant chunks score
 * ~0.15-0.3 (measured on the real 110k-chunk corpus 2026-07-19: top-of-120
 * random chunks = 0.273). A single 0.3 gate silently drops EVERY Nemotron
 * result — the gate must follow the ACTIVE embedding provider.
 */
const RELEVANCE_THRESHOLDS: Partial<Record<BrainId, number>> = {
  'gemini-api': 0.3,
  ollama: 0.3,
  'local-onnx-embed': 0.12,
}
const DEFAULT_RELEVANCE_THRESHOLD = 0.3

class EmbeddingsService {
  /** Which provider is currently active ('gemini' | 'ollama' | 'none'). */
  provider(): 'gemini' | 'ollama' | 'none' {
    if (getConfig().transcription.geminiApiKey) return 'gemini'
    return 'ollama'
  }

  /**
   * The brain that would serve an embed call right now — the vector store's
   * partition label for indexing (write path) and searching (read path).
   * Null when no embed provider is usable.
   */
  async activeProviderId(): Promise<BrainId | null> {
    return getBrainRouter().activeEmbedBrainId()
  }

  /** Relevance gate for the ACTIVE provider (see RELEVANCE_THRESHOLDS). */
  async relevanceThreshold(): Promise<number> {
    const id = await this.activeProviderId()
    return (id && RELEVANCE_THRESHOLDS[id]) ?? DEFAULT_RELEVANCE_THRESHOLD
  }

  async generateEmbedding(
    text: string,
    opts: { shouldGenerate?: () => boolean; purpose?: 'query' | 'passage' } = {}
  ): Promise<number[] | null> {
    const results = await this.generateEmbeddings([text], opts)
    return results[0] ?? null
  }

  async generateEmbeddings(
    texts: string[],
    opts: { shouldGenerate?: () => boolean; purpose?: 'query' | 'passage' } = {}
  ): Promise<(number[] | null)[]> {
    // Delegate to the BrainRouter: Gemini `gemini-embedding-001` first (when a
    // key is configured), else Ollama — the same routing as before, now shared
    // with chat-llm.ts and output-generator.ts via the brain seam.
    // ADV42-2 (round-44) — forward shouldGenerate so the router re-checks
    // eligibility before the PRIMARY and the Ollama FALLBACK embed attempts (the
    // vector/image backfill's per-row snapshot cannot see an exclusion committed
    // while the Gemini attempt is pending/failing — the router recheck can).
    return getBrainRouter().embed(texts, opts)
  }
}

let instance: EmbeddingsService | null = null

export function getEmbeddingsService(): EmbeddingsService {
  if (!instance) instance = new EmbeddingsService()
  return instance
}
