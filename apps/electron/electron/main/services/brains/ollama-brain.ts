/**
 * Ollama (local) brain — wraps the existing OllamaService.
 *
 * Preserves the exact fallback behaviour the three routers relied on:
 *   - chat/generate return null when Ollama is unreachable (OllamaService
 *     already swallows errors and returns null).
 *   - embed returns an all-null array when Ollama is unavailable, matching
 *     embeddings.ts's previous "isAvailable() ? generateEmbeddings : nulls".
 *
 * Capabilities: generate, chat, embed. No audio, no agentic.
 */
import { getOllamaService } from '../ollama'
import type {
  AIBrain,
  BrainAuthStatus,
  BrainCapability,
  BrainMessage,
  EmbedOptions,
  GenerateOptions,
} from './types'

const CAPABILITIES: ReadonlySet<BrainCapability> = new Set<BrainCapability>([
  'generate',
  'chat',
  'embed',
])

export class OllamaBrain implements AIBrain {
  readonly id = 'ollama' as const
  readonly label = 'Ollama (local)'

  capabilities(): ReadonlySet<BrainCapability> {
    return CAPABILITIES
  }

  async authStatus(): Promise<BrainAuthStatus> {
    let available = false
    try {
      available = await getOllamaService().isAvailable()
    } catch {
      available = false
    }
    return {
      configured: available,
      method: available ? 'cli-login' : 'none',
      detail: available ? 'running' : 'not reachable',
    }
  }

  async generate(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const prompt = messages
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n\n')
    const systemPrompt = opts.systemPrompt ?? messages.find((m) => m.role === 'system')?.content
    return getOllamaService().generate(prompt, systemPrompt)
  }

  async chat(messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    return getOllamaService().chat(messages, {
      systemPrompt: opts.systemPrompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    })
  }

  /**
   * ADV43-2 (round-45) — Ollama emits ONE request per text (generateEmbeddings
   * loops over generateEmbedding). `opts.shouldGenerate` is threaded into that
   * loop and re-evaluated fail-closed before EACH per-text request, so an owner
   * exclusion committed while an earlier request is pending stops every later
   * request; already-fetched vectors are kept and the remaining texts return
   * `null` (the "no embedding available" shape callers persist as nothing).
   */
  async embed(texts: string[], opts: EmbedOptions = {}): Promise<(number[] | null)[]> {
    if (texts.length === 0) return []
    try {
      const ollama = getOllamaService()
      if (await ollama.isAvailable()) {
        return await ollama.generateEmbeddings(texts, { shouldGenerate: opts.shouldGenerate })
      }
    } catch (e) {
      console.error('[OllamaBrain] embed failed:', e)
    }
    return texts.map(() => null)
  }
}
