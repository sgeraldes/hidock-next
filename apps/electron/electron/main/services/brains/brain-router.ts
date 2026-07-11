/**
 * Brain router — resolves a task to a brain and enforces capability-aware
 * fallback so audio and embeddings NEVER route to a brain that can't do them.
 *
 * Resolution order for `resolve(task, need)` (spec §C.1):
 *   1. config.brains.taskRouting[task] — if enabled, configured, and it
 *      advertises `need`.
 *   2. config.brains.defaultBrain — if enabled, configured, and advertises `need`.
 *   3. capability fallback chain for `need` — first enabled + configured brain.
 *   4. null → caller surfaces its existing "no backend available" behaviour.
 *
 * When `config.brains` is unset (defaults), this resolves to the exact legacy
 * behaviour: gemini-api when a Gemini key exists, else Ollama — identical to the
 * three routers this replaces.
 */
import { getConfig } from '../config'
import { getBrainRegistry, BrainRegistry } from './brain-registry'
import type {
  AIBrain,
  AudioAnalyzeInput,
  BrainCapability,
  BrainId,
  BrainMessage,
  BrainTask,
  GenerateOptions,
} from './types'

/**
 * Capability fallback chains (spec §B.4). Ordering is the preference order used
 * when neither taskRouting nor defaultBrain resolves. Audio is gemini-api only
 * (local ASR lives outside the router, in transcription.ts). Embeddings are
 * gemini-api → ollama only. Agentic brains arrive in later phases.
 */
const FALLBACK_CHAINS: Record<BrainCapability, BrainId[]> = {
  generate: ['gemini-api', 'ollama'],
  chat: ['gemini-api', 'ollama'],
  embed: ['gemini-api', 'ollama'],
  analyzeAudio: ['gemini-api'],
  agentic: ['claude-code', 'codex', 'gemini-cli'],
}

/** Brains enabled by default when config.brains (or a specific flag) is unset. */
const DEFAULT_ENABLED = new Set<BrainId>(['gemini-api', 'ollama'])
const DEFAULT_BRAIN: BrainId = 'gemini-api'

export class BrainRouter {
  constructor(private readonly registry: BrainRegistry = getBrainRegistry()) {}

  private brainsConfig() {
    return getConfig().brains
  }

  private isEnabled(id: BrainId): boolean {
    const enabled = this.brainsConfig()?.enabled
    if (enabled && Object.prototype.hasOwnProperty.call(enabled, id)) return !!enabled[id]
    return DEFAULT_ENABLED.has(id)
  }

  private async isUsable(brain: AIBrain | null, need: BrainCapability): Promise<boolean> {
    if (!brain) return false
    if (!this.isEnabled(brain.id)) return false
    if (!brain.capabilities().has(need)) return false
    try {
      return (await brain.authStatus()).configured
    } catch {
      return false
    }
  }

  /** Resolve the brain for a task, or null if none can serve `need`. */
  async resolve(task: BrainTask, need: BrainCapability): Promise<AIBrain | null> {
    const cfg = this.brainsConfig()

    // 1. Per-task override.
    const routed = cfg?.taskRouting?.[task]
    if (routed) {
      const brain = this.registry.get(routed)
      if (await this.isUsable(brain, need)) return brain
    }

    // 2. Global default.
    const def = cfg?.defaultBrain ?? DEFAULT_BRAIN
    const defBrain = this.registry.get(def)
    if (await this.isUsable(defBrain, need)) return defBrain

    // 3. Capability fallback chain.
    for (const id of FALLBACK_CHAINS[need]) {
      if (id === def) continue // already tried
      const brain = this.registry.get(id)
      if (await this.isUsable(brain, need)) return brain
    }

    return null
  }

  // ── Convenience wrappers (preserve the legacy fallback semantics) ──────────

  /**
   * Multi-turn chat. Replicates chat-llm's behaviour: primary (Gemini when a key
   * is configured) first; on a non-abort error fall back to Ollama; on cancel
   * return null; when no cloud brain is configured, Ollama serves directly.
   */
  async chat(task: BrainTask, messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const primary = await this.resolve(task, 'chat')

    if (primary && primary.id === 'gemini-api') {
      try {
        return await primary.chat(messages, opts)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          console.log('[BrainRouter] chat request was cancelled')
          return null
        }
        console.error('[BrainRouter] primary chat failed, trying Ollama fallback:', e)
      }
    } else if (primary) {
      return primary.chat(messages, opts)
    }

    // No cloud primary (or it threw): Ollama serves directly (null if unreachable).
    const ollama = this.registry.get('ollama')
    return ollama ? ollama.chat(messages, opts) : null
  }

  /**
   * Text embeddings. Replicates embeddings.ts: Gemini first when a key exists;
   * on error fall back to Ollama (which returns nulls when unavailable).
   */
  async embed(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return []

    const primary = await this.resolve('embed', 'embed')
    if (primary && primary.id === 'gemini-api' && primary.embed) {
      try {
        return await primary.embed(texts)
      } catch (e) {
        console.error('[BrainRouter] Gemini embedding failed, trying Ollama fallback:', e)
      }
    } else if (primary && primary.id !== 'gemini-api' && primary.embed) {
      return primary.embed(texts)
    }

    const ollama = this.registry.get('ollama')
    return ollama?.embed ? ollama.embed(texts) : texts.map(() => null)
  }

  /**
   * Native audio → text. Resolves to a brain that advertises analyzeAudio
   * (gemini-api only in Phase 1). Returns null when none is configured — the
   * caller then uses the local-ASR path.
   */
  async analyzeAudio(input: AudioAnalyzeInput): Promise<string | null> {
    const brain = await this.resolve('transcribeAnalyze', 'analyzeAudio')
    if (!brain || !brain.analyzeAudio) return null
    return brain.analyzeAudio(input)
  }
}

let singleton: BrainRouter | null = null

export function getBrainRouter(): BrainRouter {
  if (!singleton) singleton = new BrainRouter()
  return singleton
}

/** Test helper: drop the singleton so a fresh router is built next call. */
export function resetBrainRouter(): void {
  singleton = null
}
