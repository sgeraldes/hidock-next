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

import { GoogleGenerativeAI } from '@google/generative-ai'
import { getConfig } from './config'
import { getOllamaService } from './ollama'

const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001'
const GEMINI_BATCH_LIMIT = 100

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
    if (texts.length === 0) return []

    const apiKey = getConfig().transcription.geminiApiKey
    if (apiKey) {
      try {
        return await this.geminiBatch(apiKey, texts)
      } catch (e) {
        console.error('[Embeddings] Gemini embedding failed, trying Ollama fallback:', e)
      }
    }

    // Ollama fallback (local, optional)
    try {
      const ollama = getOllamaService()
      if (await ollama.isAvailable()) {
        return await ollama.generateEmbeddings(texts)
      }
    } catch (e) {
      console.error('[Embeddings] Ollama fallback failed:', e)
    }

    return texts.map(() => null)
  }

  private async geminiBatch(apiKey: string, texts: string[]): Promise<(number[] | null)[]> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: GEMINI_EMBEDDING_MODEL })

    const out: (number[] | null)[] = []
    for (let i = 0; i < texts.length; i += GEMINI_BATCH_LIMIT) {
      const slice = texts.slice(i, i + GEMINI_BATCH_LIMIT)
      const res = await model.batchEmbedContents({
        requests: slice.map((t) => ({
          content: { role: 'user', parts: [{ text: t }] }
        }))
      })
      for (const emb of res.embeddings) {
        out.push(emb?.values ?? null)
      }
    }
    return out
  }
}

let instance: EmbeddingsService | null = null

export function getEmbeddingsService(): EmbeddingsService {
  if (!instance) instance = new EmbeddingsService()
  return instance
}
