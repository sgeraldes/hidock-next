/**
 * Ollama Service
 * Handles embedding generation and LLM inference via local Ollama instance.
 *
 * Migration notes:
 *   - Embeddings: delegated to @hidock/ai-providers embed() (Ollama REST /api/embed)
 *   - Chat/generate: kept as direct Ollama REST calls — the Vercel AI SDK (ai package)
 *     is not a direct electron dependency and would require hoisting. Direct fetch is
 *     simpler and avoids the transitive-module boundary.
 *   - Model management (isAvailable / listModels / hasModel / pullModel / ensureModels):
 *     kept here via direct Ollama REST — the shared package does not expose these.
 *
 * Embedding-dimension safety note:
 *   Stored vectors (vector_embeddings table) were generated with nomic-embed-text.
 *   @hidock/ai-providers uses Ollama's /api/embed endpoint (newer) vs the previous
 *   /api/embeddings endpoint (older). Both return the same 768-dimension output for
 *   nomic-embed-text — the model determines the dimension, not the endpoint. Existing
 *   persisted vectors remain fully compatible.
 */

import { embed } from '@hidock/ai-providers'
import { getConfig } from './config'
import { eligibleToGenerate } from './brains/eligibility'

// AI-07 FIX: These are now fallback defaults only - actual values come from config
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text'
const DEFAULT_CHAT_MODEL = 'llama3.2'

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OllamaChatResponse {
  model: string
  message: OllamaChatMessage
  done: boolean
}

class OllamaService {
  private baseUrl: string
  private embeddingModel: string
  private chatModel: string

  constructor(
    baseUrl = DEFAULT_OLLAMA_BASE_URL,
    embeddingModel = DEFAULT_EMBEDDING_MODEL,
    chatModel = DEFAULT_CHAT_MODEL
  ) {
    this.baseUrl = baseUrl
    this.embeddingModel = embeddingModel
    this.chatModel = chatModel
  }

  // ── Model management (not in @hidock/ai-providers) ───────────────────────

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`)
      if (!response.ok) return []
      const data = await response.json()
      return data.models?.map((m: { name: string }) => m.name) || []
    } catch {
      return []
    }
  }

  async hasModel(modelName: string): Promise<boolean> {
    const models = await this.listModels()
    return models.some((m) => m.startsWith(modelName))
  }

  async pullModel(modelName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: false })
      })
      return response.ok
    } catch {
      return false
    }
  }

  async ensureModels(): Promise<{ embedding: boolean; chat: boolean }> {
    const hasEmbedding = await this.hasModel(this.embeddingModel)
    const hasChat = await this.hasModel(this.chatModel)

    const results = { embedding: hasEmbedding, chat: hasChat }

    if (!hasEmbedding) {
      console.log(`Pulling embedding model: ${this.embeddingModel}`)
      results.embedding = await this.pullModel(this.embeddingModel)
    }

    if (!hasChat) {
      console.log(`Pulling chat model: ${this.chatModel}`)
      results.chat = await this.pullModel(this.chatModel)
    }

    return results
  }

  // ── Embeddings (via @hidock/ai-providers) ────────────────────────────────

  async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const result = await embed(text, {
        provider: 'ollama',
        model: this.embeddingModel,
        baseURL: `${this.baseUrl}/api`
      })
      return result.embedding
    } catch (error) {
      console.error('Failed to generate embedding:', error)
      return null
    }
  }

  async generateEmbeddings(
    texts: string[],
    opts: { shouldGenerate?: () => boolean } = {}
  ): Promise<(number[] | null)[]> {
    const embeddings: (number[] | null)[] = []
    for (const text of texts) {
      // ADV43-2 (round-45) — Ollama does one request per text. Re-evaluate the
      // fail-closed eligibility gate IMMEDIATELY before EACH request: on
      // ineligible (false / throw) stop issuing further requests and fill the
      // remaining texts with null (the "no embedding available" shape callers
      // persist as nothing), so an exclusion committed while an earlier request
      // was pending never sends the later texts to the provider.
      if (!eligibleToGenerate(opts.shouldGenerate)) {
        while (embeddings.length < texts.length) embeddings.push(null)
        return embeddings
      }
      const embedding = await this.generateEmbedding(text)
      embeddings.push(embedding)
    }
    return embeddings
  }

  // ── Chat / generate (direct Ollama REST — avoids hoisting the `ai` SDK) ──

  async chat(
    messages: OllamaChatMessage[],
    options: {
      temperature?: number
      maxTokens?: number
      systemPrompt?: string
      signal?: AbortSignal // B-CHAT-005: Support request cancellation
    } = {}
  ): Promise<string | null> {
    try {
      const fullMessages = [...messages]
      if (options.systemPrompt) {
        fullMessages.unshift({ role: 'system', content: options.systemPrompt })
      }

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel,
          messages: fullMessages,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens ?? 1024
          }
        })
      }

      // B-CHAT-005: Pass abort signal to fetch
      if (options.signal) {
        fetchOptions.signal = options.signal
      }

      const response = await fetch(`${this.baseUrl}/api/chat`, fetchOptions)

      if (!response.ok) {
        console.error('Ollama chat error:', response.statusText)
        return null
      }

      const data: OllamaChatResponse = await response.json()
      return data.message.content
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('[Ollama] Chat request was cancelled')
        return null
      }
      console.error('Failed to chat with Ollama:', error)
      return null
    }
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string | null> {
    return this.chat([{ role: 'user', content: prompt }], { systemPrompt })
  }
}

// Singleton instance
let ollamaInstance: OllamaService | null = null

export function getOllamaService(): OllamaService {
  if (!ollamaInstance) {
    try {
      const config = getConfig()

      // Read from correct config paths (embeddings.ollamaBaseUrl, embeddings.ollamaModel, chat.ollamaModel)
      const baseUrl = config.embeddings?.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL
      const embeddingModel = config.embeddings?.ollamaModel || DEFAULT_EMBEDDING_MODEL
      const chatModel = config.chat?.ollamaModel || DEFAULT_CHAT_MODEL

      console.log(`[Ollama] Initializing with config: baseUrl=${baseUrl}, embeddingModel=${embeddingModel}, chatModel=${chatModel}`)

      ollamaInstance = new OllamaService(baseUrl, embeddingModel, chatModel)
    } catch (error) {
      console.warn('[Ollama] Failed to read config, using defaults:', error)
      // Fall back to defaults if config is not available yet
      ollamaInstance = new OllamaService()
    }
  }
  return ollamaInstance
}

export { OllamaService }
export type { OllamaChatMessage }
