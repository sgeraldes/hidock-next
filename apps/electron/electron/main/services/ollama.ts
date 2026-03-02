/**
 * Ollama Service
 * Handles embedding generation and LLM inference via local Ollama instance
 */

// AI-07 FIX: These are now fallback defaults only - actual values come from config
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text'
const DEFAULT_CHAT_MODEL = 'llama3.2'

interface OllamaEmbeddingResponse {
  embedding: number[]
}

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

  async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text
        })
      })

      if (!response.ok) {
        console.error('Ollama embedding error:', response.statusText)
        return null
      }

      const data: OllamaEmbeddingResponse = await response.json()
      return data.embedding
    } catch (error) {
      console.error('Failed to generate embedding:', error)
      return null
    }
  }

  async generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
    const embeddings: (number[] | null)[] = []
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text)
      embeddings.push(embedding)
    }
    return embeddings
  }

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
      // AI-07 FIX: Read config values properly from the config service
      const { getConfig } = require('./config')
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
