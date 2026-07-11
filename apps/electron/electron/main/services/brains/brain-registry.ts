/**
 * Brain registry — instantiates and caches the enabled brains and exposes them
 * by id. Phase 1 registers Gemini (API key) and Ollama (local); later phases
 * append Claude Code / Codex / Gemini-CLI via the same registration array.
 */
import { GeminiApiBrain } from './gemini-api-brain'
import { OllamaBrain } from './ollama-brain'
import type { AIBrain, BrainId } from './types'

/**
 * Append-only registration list. Each factory is invoked once and its brain
 * cached. Later phases add their adapters here without colliding with others.
 */
const REGISTRATIONS: Array<() => AIBrain> = [() => new GeminiApiBrain(), () => new OllamaBrain()]

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
