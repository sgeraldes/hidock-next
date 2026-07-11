/**
 * Brain registry — instantiates and caches the enabled brains and exposes them
 * by id. Registers the current-provider brains (Gemini API key, Ollama) plus the
 * three agentic brains that shell out to their installed CLIs (Claude Code,
 * Codex, Gemini CLI).
 */
import { ClaudeCodeBrain } from './claude-code-brain'
import { CodexBrain } from './codex-brain'
import { GeminiApiBrain } from './gemini-api-brain'
import { GeminiCliBrain } from './gemini-cli-brain'
import { OllamaBrain } from './ollama-brain'
import type { AIBrain, BrainId } from './types'

/**
 * Codex-companion setup script (structured auth probe). Version-pinned to the
 * plugin cache layout on this machine; the CodexBrain silently falls back to a
 * plain `codex --version` presence probe when it's absent, so a missing/renamed
 * companion never breaks auth detection.
 */
const CODEX_COMPANION_PATH =
  'C:/Users/Sebastian/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs'

/**
 * Append-only registration list. Each factory is invoked once and its brain
 * cached. Later phases add their adapters here without colliding with others.
 */
const REGISTRATIONS: Array<() => AIBrain> = [
  () => new GeminiApiBrain(),
  () => new OllamaBrain(),
  () => new ClaudeCodeBrain(),
  () => new CodexBrain({ companionPath: CODEX_COMPANION_PATH }),
  () => new GeminiCliBrain(),
]

export class BrainRegistry {
  private brains = new Map<BrainId, AIBrain>()

  constructor() {
    for (const make of REGISTRATIONS) {
      const brain = make()
      this.brains.set(brain.id, brain)
    }
  }

  /** Get a brain by id, or null if not registered. */
  get(id: BrainId): AIBrain | null {
    return this.brains.get(id) ?? null
  }

  /** All registered brains (registration order). */
  list(): AIBrain[] {
    return [...this.brains.values()]
  }

  has(id: BrainId): boolean {
    return this.brains.has(id)
  }
}

let singleton: BrainRegistry | null = null

export function getBrainRegistry(): BrainRegistry {
  if (!singleton) singleton = new BrainRegistry()
  return singleton
}

/** Test helper: drop the singleton so a fresh registry is built next call. */
export function resetBrainRegistry(): void {
  singleton = null
}
