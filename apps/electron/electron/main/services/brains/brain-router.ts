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
   * Is Gemini the usable cloud primary for `task`/`need`? Decided WITHOUT a
   * network probe (Gemini authStatus is a key lookup) so the no-Gemini path can
   * go straight to Ollama with the caller's signal — never blocking on an
   * uncancellable /api/tags preflight (FIX 3) or double-probing Ollama (FIX 4).
   * Mirrors resolve()'s taskRouting→defaultBrain preference, restricted to Gemini.
   */
  private async geminiPrimary(task: BrainTask, need: BrainCapability): Promise<AIBrain | null> {
    const cfg = this.brainsConfig()
    const routed = cfg?.taskRouting?.[task]
    // An explicit non-Gemini task route means Gemini is not the primary.
    if (routed && routed !== 'gemini-api') return null
    const target = routed ?? cfg?.defaultBrain ?? DEFAULT_BRAIN
    if (target !== 'gemini-api') return null
    const gemini = this.registry.get('gemini-api')
    return (await this.isUsable(gemini, need)) ? gemini : null
  }

  /**
   * Capability-aware fallback (FIX 5): the first registered, ENABLED brain that
   * ADVERTISES `need`, excluding `exclude` (the failed/primary Gemini). Unlike
   * resolve(), this does NOT run an availability probe — the brain's own call
   * determines reachability (returning null when unreachable) and honours the
   * caller's abort signal. This keeps chat cancellable (FIX 3) and embeddings to
   * a single probe (FIX 4) while still refusing a disabled or incapable brain.
   */
  private capabilityFallback(need: BrainCapability, exclude: BrainId | null): AIBrain | null {
    for (const id of FALLBACK_CHAINS[need]) {
      if (id === exclude) continue
      const brain = this.registry.get(id)
      if (!brain) continue
      if (!this.isEnabled(id)) continue
      if (!brain.capabilities().has(need)) continue
      return brain
    }
    return null
  }

  /**
   * Multi-turn chat. Replicates chat-llm's behaviour: primary (Gemini when a key
   * is configured) first; on a non-abort error fall back to Ollama; on cancel
   * return null; when no cloud brain is configured, Ollama serves directly — with
   * the caller's signal and no uncancellable preflight probe.
   */
  async chat(task: BrainTask, messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    const primary = await this.geminiPrimary(task, 'chat')

    if (primary) {
      try {
        return await primary.chat(messages, opts)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          console.log('[BrainRouter] chat request was cancelled')
          return null
        }
        console.error('[BrainRouter] primary chat failed, trying Ollama fallback:', e)
      }
    }

    // No Gemini primary (or it threw): the capability-aware fallback (enabled +
    // advertises chat) serves directly with the caller's signal.
    const fallback = this.capabilityFallback('chat', 'gemini-api')
    return fallback ? fallback.chat(messages, opts) : null
  }

  /**
   * Text embeddings. Replicates embeddings.ts: Gemini first when a key exists;
   * on error fall back to Ollama (which returns nulls when unavailable). Ollama's
   * single availability probe lives inside its adapter's embed() — this wrapper
   * adds none, so a transient probe never yields spurious null vectors (FIX 4).
   */
  async embed(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return []

    const primary = await this.geminiPrimary('embed', 'embed')
    if (primary?.embed) {
      try {
        return await primary.embed(texts)
      } catch (e) {
        console.error('[BrainRouter] Gemini embedding failed, trying Ollama fallback:', e)
      }
    }

    const fallback = this.capabilityFallback('embed', 'gemini-api')
    return fallback?.embed ? fallback.embed(texts) : texts.map(() => null)
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
