/**
 * BrainRegistry tests — the registry must expose all six brains: the two
 * current-provider brains (gemini-api, ollama) and the four agentic CLI brains
 * (claude-code, codex, gemini-cli, kiro). Constructing them must not spawn anything.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

// The registry constructs the real GeminiApiBrain, which imports ../../config
// (that reads electron's app.getPath at module load). Stub it — construction
// alone never reads config values, so an empty object is sufficient.
vi.mock('../../config', () => ({ getConfig: () => ({}) }))
vi.mock('../../ollama', () => ({ getOllamaService: () => ({ isAvailable: async () => false }) }))

import { getBrainRegistry, resetBrainRegistry } from '../brain-registry'

describe('BrainRegistry', () => {
  afterEach(() => resetBrainRegistry())

  it('registers all six brains by id', () => {
    const registry = getBrainRegistry()
    const ids = registry.list().map((b) => b.id).sort()
    expect(ids).toEqual(['claude-code', 'codex', 'gemini-api', 'gemini-cli', 'kiro', 'ollama'])
  })

  it('resolves each new agentic brain and its capabilities', () => {
    const registry = getBrainRegistry()
    for (const id of ['claude-code', 'codex', 'gemini-cli', 'kiro'] as const) {
      const brain = registry.get(id)
      expect(brain, `${id} should be registered`).not.toBeNull()
      const caps = [...brain!.capabilities()].sort()
      expect(caps).toEqual(['agentic', 'chat', 'generate'])
    }
  })

  it('agentic brains advertise neither audio nor embed', () => {
    const registry = getBrainRegistry()
    for (const id of ['claude-code', 'codex', 'gemini-cli', 'kiro'] as const) {
      const caps = registry.get(id)!.capabilities()
      expect(caps.has('analyzeAudio')).toBe(false)
      expect(caps.has('embed')).toBe(false)
    }
  })
})
