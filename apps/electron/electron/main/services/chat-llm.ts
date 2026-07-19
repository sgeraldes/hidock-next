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

import { getConfig } from './config'
import { getOllamaService, OllamaChatMessage } from './ollama'
import { getBrainRouter } from './brains'

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
  /**
   * ADV42-2 (round-44) — forwarded to BrainRouter.chat so the caller's
   * recording/capture eligibility check is re-run SYNCHRONOUSLY before EVERY
   * provider attempt (primary + each fallback). Fail-closed (false/throw ⇒
   * abort). Callers whose source can be excluded mid-run (RAG chat, meeting
   * summary/action items, self-identification, transcript reformat) pass it.
   */
  shouldGenerate?: () => boolean
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
    // Delegate to the BrainRouter: Gemini-first (config.chat.geminiModel) with
    // Ollama fallback — identical routing to the previous inline implementation,
    // now shared with embeddings.ts and output-generator.ts via the brain seam.
    return getBrainRouter().chat('chat', messages, {
      systemPrompt: options.systemPrompt,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
      shouldGenerate: options.shouldGenerate
    })
  }

  /** Convenience: single-prompt generation (mirrors OllamaService.generate). */
  async generateText(
    prompt: string,
    systemPrompt?: string,
    options: { shouldGenerate?: () => boolean } = {}
  ): Promise<string | null> {
    return this.generate([{ role: 'user', content: prompt }], {
      systemPrompt,
      shouldGenerate: options.shouldGenerate
    })
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
