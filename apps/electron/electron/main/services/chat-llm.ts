/**
 * Chat LLM Service
 *
 * Provider-routing for conversational generation used by the RAG assistant:
 * - Gemini (same API key as transcription, model from config.chat.geminiModel) — primary.
 * - Ollama (local) — fallback when no Gemini key is configured.
 *
 * The RAG chat pipeline was previously Ollama-only, so on machines without
 * Ollama the assistant was completely unusable even when a Gemini key was set.
 * This mirrors the Gemini-first routing already used by embeddings.ts and
 * output-generator.ts.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { getConfig } from './config'
import { getOllamaService, OllamaChatMessage } from './ollama'

export type ChatBackend = 'gemini' | 'ollama' | 'none'

export interface ChatBackendStatus {
  /** Backend that will actually serve requests right now. */
  backend: ChatBackend
  geminiConfigured: boolean
  ollamaAvailable: boolean
}

export interface ChatGenerateOptions {
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

class ChatLLMService {
  /** Gemini API key — shared with transcription (same credentials). */
  private geminiKey(): string {
    return getConfig().transcription.geminiApiKey || ''
  }

  /**
   * Resolve which backend will serve chat requests right now.
   * Gemini wins when a key is configured; otherwise Ollama if it is reachable;
   * otherwise 'none' (chat unavailable).
   */
  async getStatus(): Promise<ChatBackendStatus> {
    const geminiConfigured = !!this.geminiKey()

    let ollamaAvailable = false
    try {
      ollamaAvailable = await getOllamaService().isAvailable()
    } catch {
      ollamaAvailable = false
    }

    const backend: ChatBackend = geminiConfigured
      ? 'gemini'
      : ollamaAvailable
        ? 'ollama'
        : 'none'

    return { backend, geminiConfigured, ollamaAvailable }
  }

  /**
   * Generate a chat completion. Gemini-first, falling back to local Ollama when
   * no key is set (or when the Gemini call fails). Returns null on failure or
   * cancellation, mirroring OllamaService.chat.
   */
  async generate(messages: OllamaChatMessage[], options: ChatGenerateOptions = {}): Promise<string | null> {
    const apiKey = this.geminiKey()

    if (apiKey) {
      try {
        return await this.geminiChat(apiKey, messages, options)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          console.log('[ChatLLM] Gemini request was cancelled')
          return null
        }
        console.error('[ChatLLM] Gemini chat failed, trying Ollama fallback:', e)
      }
    }

    // Ollama fallback (local, optional). Returns null if unreachable.
    return getOllamaService().chat(messages, options)
  }

  /** Convenience: single-prompt generation (mirrors OllamaService.generate). */
  async generateText(prompt: string, systemPrompt?: string): Promise<string | null> {
    return this.generate([{ role: 'user', content: prompt }], { systemPrompt })
  }

  private async geminiChat(
    apiKey: string,
    messages: OllamaChatMessage[],
    options: ChatGenerateOptions
  ): Promise<string | null> {
    const config = getConfig()
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: config.chat.geminiModel || 'gemini-3.5-flash',
      ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {})
    })

    // Map chat history to Gemini's content format: 'assistant' → 'model'.
    // Any 'system' turns are dropped here (handled via systemInstruction).
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

    // Gemini requires the first turn to be a user turn. Token-based history
    // trimming can leave a leading 'model' turn — strip those defensively.
    while (contents.length > 0 && contents[0].role === 'model') {
      contents.shift()
    }

    const result = await model.generateContent(
      {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens ?? 1024,
          thinkingConfig: { thinkingBudget: 0 }
        } as never
      },
      options.signal ? { signal: options.signal } : {}
    )

    return result.response.text()
  }
}

let instance: ChatLLMService | null = null

export function getChatLLMService(): ChatLLMService {
  if (!instance) instance = new ChatLLMService()
  return instance
}

export function resetChatLLMService(): void {
  instance = null
}

export { ChatLLMService }
