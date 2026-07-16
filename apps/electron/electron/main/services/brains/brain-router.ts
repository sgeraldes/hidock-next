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
import { eligibleToGenerate } from './eligibility'
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
 * gemini-api → ollama only (the agentic brains cannot embed).
 *
 * `chat` lists the agentic brains AFTER gemini-api/ollama: an explicit
 * defaultBrain/taskRouting choice is honoured because selection tries the
 * configured brain FIRST (see chatCandidateOrder), while the *implicit* fallback
 * order stays legacy-first (gemini → ollama) so a default config is unchanged.
 */
const FALLBACK_CHAINS: Record<BrainCapability, BrainId[]> = {
  generate: ['gemini-api', 'ollama'],
  chat: ['gemini-api', 'ollama', 'claude-code', 'codex', 'gemini-cli'],
  embed: ['gemini-api', 'ollama'],
  analyzeAudio: ['gemini-api'],
  agentic: ['claude-code', 'codex', 'gemini-cli'],
}

/** Brains enabled by default when config.brains (or a specific flag) is unset. */
const DEFAULT_ENABLED = new Set<BrainId>(['gemini-api', 'ollama'])
const DEFAULT_BRAIN: BrainId = 'gemini-api'

const NO_EXCLUDES: ReadonlySet<BrainId> = new Set()

/**
 * The terminal failed attempt of a chat() call that returned null.
 * `kind: 'threw'` — the brain's chat() rejected (non-abort);
 * `kind: 'null'`  — the brain answered but returned null (e.g. unreachable Ollama).
 */
export interface ChatFailure {
  brainId: BrainId
  kind: 'threw' | 'null'
}

export class BrainRouter {
  /**
   * Terminal failure of the most recent chat() on THIS router instance (null
   * after a success, an abort, or when no brain was usable at all). Set only
   * when chat() returns null after actually attempting >=1 brain. Last-call-wins
   * per instance: the assistant chat is single-flight in practice, and consumers
   * read it synchronously right after the null return.
   */
  private lastChatFailure: ChatFailure | null = null

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
   * The brain-id preference order for a chat task: the configured primary
   * (taskRouting[task] → defaultBrain → DEFAULT_BRAIN) FIRST, then the
   * capability fallback chain. Deduped so an explicit choice that also appears
   * in the chain is only weighed once. This is where an explicit default/route
   * (e.g. claude-code) gets honoured ahead of the legacy-first chain.
   */
  private chatCandidateOrder(task: BrainTask): BrainId[] {
    const cfg = this.brainsConfig()
    const order: BrainId[] = []
    const push = (id?: BrainId | null) => {
      if (id && !order.includes(id)) order.push(id)
    }
    push(cfg?.taskRouting?.[task])
    push(cfg?.defaultBrain ?? DEFAULT_BRAIN)
    for (const id of FALLBACK_CHAINS.chat) push(id)
    return order
  }

  /**
   * Network-free chat resolution: the first enabled, chat-capable brain in
   * chatCandidateOrder, skipping `exclude`. Mirrors resolve()'s
   * taskRouting→defaultBrain→chain semantics, with ONE deliberate deviation —
   * Ollama is accepted on enabled + capability alone (NO authStatus call) so its
   * network availability probe never enters the selection path (FIX 3/4); it
   * serves directly and self-reports null when unreachable. Every non-Ollama
   * brain (gemini-api + the agentic CLIs) has a cheap, local authStatus and MUST
   * be `configured`, so an unconfigured brain is never handed back.
   */
  private async selectChatBrain(task: BrainTask, exclude: ReadonlySet<BrainId>): Promise<AIBrain | null> {
    for (const id of this.chatCandidateOrder(task)) {
      if (exclude.has(id)) continue
      const brain = this.registry.get(id)
      if (!brain) continue
      if (!this.isEnabled(id)) continue
      if (!brain.capabilities().has('chat')) continue
      if (id === 'ollama') return brain // serve directly; no availability preflight
      try {
        if ((await brain.authStatus()).configured) return brain
      } catch {
        // treat an authStatus failure as unconfigured; try the next candidate
      }
    }
    return null
  }

  /**
   * The brain id chat() will invoke FIRST under the current config — the brain
   * that will ACTUALLY serve the turn — honouring taskRouting.chat → defaultBrain
   * → capability chain with the SAME enabled+configured checks as chat()'s own
   * selection and NO Ollama network probe. Consumers (e.g. rag.ts's per-brain
   * graph-fact token budget) key off this so their tuning matches who really
   * answers, instead of reading config independently and diverging under
   * fallback. Falls back to the configured primary id when nothing is currently
   * usable (best-effort budget key; the turn itself would return null).
   *
   * ⚠️ ASYNC — returns `Promise<BrainId>`, NOT a `BrainId`. Callers MUST
   * `await` it (auth statuses are consulted). Using the un-awaited return value
   * as a string key (e.g. `BUDGETS[router.resolvePrimaryChatBrainId()]`) will
   * silently index by "[object Promise]" and always miss. The contract is pinned
   * by a type-level test (expectTypeOf) in brain-router.test.ts.
   */
  async resolvePrimaryChatBrainId(task: BrainTask = 'chat'): Promise<BrainId> {
    const brain = await this.selectChatBrain(task, NO_EXCLUDES)
    if (brain) return brain.id
    const cfg = this.brainsConfig()
    return cfg?.taskRouting?.[task] ?? cfg?.defaultBrain ?? DEFAULT_BRAIN
  }

  /**
   * Terminal failed attempt of the most recent chat() that returned null on this
   * router — {brainId, kind} of the LAST brain actually tried ('threw' = rejected
   * non-abort, 'null' = answered null, e.g. unreachable Ollama). Null after a
   * success, after an abort (user cancel is not a brain failure), or when no
   * brain was usable at all. Lets error surfaces (rag.ts) name the brain that
   * terminally failed WITHOUT re-resolving — re-resolution names the primary
   * even when the terminal failure was a fallback.
   */
  getLastChatFailure(): ChatFailure | null {
    return this.lastChatFailure
  }

  /**
   * Multi-turn chat. Selects brains through selectChatBrain (same semantics as
   * resolve('…','chat') minus Ollama's preflight probe), so an explicit
   * default/route — Gemini, Ollama, OR an agentic brain (claude-code / codex /
   * gemini-cli) — is honoured. Walks the WHOLE candidate chain: on a non-abort
   * error OR a null answer from one brain, the next enabled+capable candidate is
   * tried, until one answers or the chain is exhausted (a Gemini throw followed
   * by an unreachable-Ollama null still reaches a configured agentic brain).
   * AbortError terminates immediately with null (no fallback). Legacy behaviour
   * is preserved exactly for a default config: Gemini-first when a key exists,
   * else Ollama — agentic brains are not DEFAULT_ENABLED, so a default config
   * never consults them. opts (incl. opts.signal) is forwarded to each brain's
   * chat() — the agentic adapters fold history and hand the signal to runCli, so
   * cancellation still works. On a null return (non-abort), the terminal attempt
   * is exposed via getLastChatFailure().
   */
  async chat(task: BrainTask, messages: BrainMessage[], opts: GenerateOptions = {}): Promise<string | null> {
    this.lastChatFailure = null
    const tried = new Set<BrainId>()
    let lastFailure: ChatFailure | null = null

    for (;;) {
      const brain = await this.selectChatBrain(task, tried)
      if (!brain) break
      tried.add(brain.id)

      // ADV42-2 (round-44) — FAIL-CLOSED eligibility recheck immediately before
      // THIS provider attempt (the primary AND every fallback). selectChatBrain
      // above awaited authStatus, so the source could have been trashed / marked
      // personal / value-excluded during that await; re-check synchronously,
      // adjacent to the call, and ABORT the whole chat (attempt no further
      // candidate) rather than send the now-excluded content to this brain.
      // Returns null — the same signal the AbortError path uses — so no fallback
      // provider ever receives content after the source became ineligible.
      if (!eligibleToGenerate(opts.shouldGenerate)) {
        console.warn(`[BrainRouter] chat aborted before ${brain.id}: source no longer eligible (fail closed)`)
        return null
      }

      try {
        const answer = await brain.chat(messages, opts)
        if (answer != null) return answer
        lastFailure = { brainId: brain.id, kind: 'null' }
        console.warn(`[BrainRouter] ${brain.id} chat returned null, trying next candidate`)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          console.log('[BrainRouter] chat request was cancelled')
          return null
        }
        lastFailure = { brainId: brain.id, kind: 'threw' }
        console.error(`[BrainRouter] ${brain.id} chat failed, trying next candidate:`, e)
      }
    }

    this.lastChatFailure = lastFailure
    return null
  }

  /**
   * Text embeddings. Replicates embeddings.ts: Gemini first when a key exists;
   * on error fall back to Ollama (which returns nulls when unavailable). Ollama's
   * single availability probe lives inside its adapter's embed() — this wrapper
   * adds none, so a transient probe never yields spurious null vectors (FIX 4).
   */
  async embed(
    texts: string[],
    opts: { shouldGenerate?: () => boolean } = {}
  ): Promise<(number[] | null)[]> {
    if (texts.length === 0) return []

    // ADV42-2 (round-44) — INELIGIBLE result: the null-vector shape callers
    // already treat as "no embedding available" (same as no provider), so an
    // aborted embed is indistinguishable from an unconfigured one and persists
    // nothing.
    const ineligible = (): (number[] | null)[] => texts.map(() => null)

    // Recheck before the PRIMARY provider attempt.
    if (!eligibleToGenerate(opts.shouldGenerate)) return ineligible()

    const primary = await this.geminiPrimary('embed', 'embed')
    if (primary?.embed) {
      // Recheck AGAIN after the geminiPrimary await, immediately before the call.
      if (!eligibleToGenerate(opts.shouldGenerate)) return ineligible()
      try {
        // ADV43-2 (round-45) — thread shouldGenerate INTO the adapter so it
        // re-checks before EACH internal batch (GeminiApiBrain.embed loops over
        // 100-text batches with an await between them); the router's single
        // pre-attempt check cannot see an exclusion committed mid-batch.
        return await primary.embed(texts, opts)
      } catch (e) {
        console.error('[BrainRouter] Gemini embedding failed, trying Ollama fallback:', e)
      }
    }

    // ADV42-2 (round-44) — recheck before the FALLBACK provider attempt: an
    // exclusion committed while the primary embed was pending or failing must
    // NOT reach the Ollama fallback.
    if (!eligibleToGenerate(opts.shouldGenerate)) return ineligible()

    const fallback = this.capabilityFallback('embed', 'gemini-api')
    // ADV43-2 (round-45) — the Ollama adapter emits one request per text; thread
    // shouldGenerate so it re-checks before EACH per-text request too.
    return fallback?.embed ? fallback.embed(texts, opts) : ineligible()
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
