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

  async embed(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return []
    try {
      const ollama = getOllamaService()
      if (await ollama.isAvailable()) {
        return await ollama.generateEmbeddings(texts)
      }
    } catch (e) {
      console.error('[OllamaBrain] embed failed:', e)
    }
    return texts.map(() => null)
  }
}
