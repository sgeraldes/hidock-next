/**
 * Embeddings Service
 *
 * Provider-routing for text embeddings used by the vector store / RAG:
 * - Gemini `gemini-embedding-001` (same API key as transcription) — primary.
 *   Verified live: 3072-dim vectors, batch endpoint supported.
 * - Ollama (local) — fallback when no Gemini key is configured.
 *
 * The previous implementation was Ollama-only, so on machines without Ollama
 * every transcript indexed 0 chunks and the assistant had no memory.
 */

import { getConfig } from './config'
import { getBrainRouter } from './brains'

class EmbeddingsService {
  /** Which provider is currently active ('gemini' | 'ollama' | 'none'). */
  provider(): 'gemini' | 'ollama' | 'none' {
    if (getConfig().transcription.geminiApiKey) return 'gemini'
    return 'ollama'
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    const results = await this.generateEmbeddings([text])
    return results[0] ?? null
  }

  async generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
    // Delegate to the BrainRouter: Gemini `gemini-embedding-001` first (when a
    // key is configured), else Ollama — the same routing as before, now shared
    // with chat-llm.ts and output-generator.ts via the brain seam.
    return getBrainRouter().embed(texts)
  }
}

let instance: EmbeddingsService | null = null

export function getEmbeddingsService(): EmbeddingsService {
  if (!instance) instance = new EmbeddingsService()
  return instance
}
