/**
 * config brains defaults + Gemini-key ↔ credential-store reconcile/migration (H10).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}))

// Stateful credential-store mock. `storeState` mirrors the on-disk secret map so
// getSecret/setSecret behave like the real store, and `setSecretShouldFail`
// simulates a persistence failure (setSecret returns false WITHOUT mutating
// state) so we can exercise the self-healing / reconcile paths.
let storeState: Record<string, string | null> = {}
let setSecretShouldFail = false
const mockGetSecret = vi.fn((_brainId: string, key: string) => storeState[key] ?? null)
const mockHasSecret = vi.fn((_brainId: string, key: string) => (storeState[key] ?? null) !== null)
const mockSetSecret = vi.fn((_brainId: string, key: string, value: string | null): boolean => {
  if (setSecretShouldFail) return false // persistence failed → state unchanged
  if (value === null || value === '') delete storeState[key]
  else storeState[key] = value
  return true
})
vi.mock('../brains/brain-credential-store', () => ({
  getBrainCredentialStore: () => ({
    hasSecret: mockHasSecret,
    getSecret: mockGetSecret,
    setSecret: mockSetSecret,
  }),
}))

import { getConfig, updateConfig, migrateGeminiKeyToCredentialStore } from '../config'
import type { AppConfig } from '../config'

function cfgWith(geminiApiKey: string, geminiEnabled = true): AppConfig {
  return {
    transcription: { geminiApiKey },
    brains: {
      enabled: {
        'gemini-api': geminiEnabled,
        ollama: true,
        'claude-code': false,
        codex: false,
        'gemini-cli': false,
      },
      defaultBrain: 'gemini-api',
      taskRouting: {},
      models: {},
    },
  } as unknown as AppConfig
}

function resetStore(): void {
  storeState = {}
  setSecretShouldFail = false
  vi.clearAllMocks()
}

describe('config.brains defaults', () => {
  it('ships gemini-api + ollama enabled, gemini-api as default, empty routing', () => {
    const brains = getConfig().brains
    expect(brains.defaultBrain).toBe('gemini-api')
    expect(brains.enabled['gemini-api']).toBe(true)
    expect(brains.enabled.ollama).toBe(true)
    expect(brains.enabled['claude-code']).toBe(false)
    expect(brains.enabled.codex).toBe(false)
    expect(brains.enabled['gemini-cli']).toBe(false)
    expect(brains.taskRouting).toEqual({})
  })
})

describe('migrateGeminiKeyToCredentialStore (boot reconciliation)', () => {
  beforeEach(resetStore)

  it('copies the plaintext key into the credential store when none is stored', () => {
    migrateGeminiKeyToCredentialStore(cfgWith('sk-plain')) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-plain')
    expect(storeState.apiKey).toBe('sk-plain')
  })

  it('leaves the plaintext config value in place (belt-and-suspenders)', () => {
    const cfg = cfgWith('sk-plain') // pragma: allowlist secret
    migrateGeminiKeyToCredentialStore(cfg)
    expect(cfg.transcription.geminiApiKey).toBe('sk-plain')
  })

  it('is idempotent — skips when the store already holds the same key', () => {
    storeState.apiKey = 'sk-plain' // pragma: allowlist secret
    const changed = migrateGeminiKeyToCredentialStore(cfgWith('sk-plain')) // pragma: allowlist secret
    expect(mockSetSecret).not.toHaveBeenCalled()
    expect(changed).toBe(false)
  })

  it('does nothing when there is no plaintext key', () => {
    const changed = migrateGeminiKeyToCredentialStore(cfgWith(''))
    expect(mockSetSecret).not.toHaveBeenCalled()
    expect(changed).toBe(false)
  })

  it('enables the gemini-api brain when it was disabled (and reports a change)', () => {
    const cfg = cfgWith('sk-plain', false) // pragma: allowlist secret
    const changed = migrateGeminiKeyToCredentialStore(cfg)
    expect(cfg.brains.enabled['gemini-api']).toBe(true)
    expect(changed).toBe(true)
  })

  // (e) Boot reconciliation heals a store that fell behind the plaintext key —
  // e.g. an earlier rotation whose store write failed left brains.json stale.
  it('reconciles a store that fell behind the plaintext key (split-brain repair)', () => {
    storeState.apiKey = 'sk-stale' // pragma: allowlist secret
    migrateGeminiKeyToCredentialStore(cfgWith('sk-current')) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-current')
    expect(storeState.apiKey).toBe('sk-current')
  })
})

/**
 * H10 FIX: Settings only writes the PLAINTEXT geminiApiKey, but
 * resolveGeminiApiKey() prefers the credential store. saveConfig/updateConfig
 * therefore reconcile the store against the desired plaintext value on EVERY
 * save (compare-then-write, not diff-gated) — so rotation/clearing in Settings
 * actually takes effect AND a save whose store write failed self-heals on the
 * next save.
 */
describe('Gemini key ↔ credential-store sync (updateConfig)', () => {
  beforeEach(resetStore)

  it('mirrors a newly set key into the credential store', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-new' }) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-new')
    expect(storeState.apiKey).toBe('sk-new')
  })

  it('rotates the stored secret when the key changes', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-old' }) // pragma: allowlist secret
    mockSetSecret.mockClear()
    await updateConfig('transcription', { geminiApiKey: 'sk-rotated' }) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-rotated')
    expect(storeState.apiKey).toBe('sk-rotated')
  })

  it('deletes the stored secret when the key is cleared to empty', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-temp' }) // pragma: allowlist secret
    mockSetSecret.mockClear()
    await updateConfig('transcription', { geminiApiKey: '' })
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', null)
    expect(storeState.apiKey).toBeUndefined()
  })

  it('does not touch the store when the Gemini key already matches (idempotent)', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-stable' }) // pragma: allowlist secret
    mockSetSecret.mockClear()
    await updateConfig('ui', { theme: 'dark' })
    expect(mockSetSecret).not.toHaveBeenCalled()
  })
})

/**
 * HIGH-4 — failure injection. The whole point of the fix: a credential-store
 * write that fails during a KEY CHANGE must NOT be reported as a successful save
 * while the stale key stays active (resolveGeminiApiKey prefers the store). The
 * save must FAIL and the geminiApiKey change must be ROLLED BACK so plaintext and
 * store stay consistent (config never ahead of the store). Unrelated saves are
 * never blocked by a background reconcile.
 */
describe('Gemini key ↔ credential-store sync — failure injection (HIGH-4 rollback)', () => {
  // Establish a known baseline each test: config's in-memory geminiApiKey is
  // cleared to '' and the store emptied, so rollback assertions are absolute
  // (the module-level config persists across tests otherwise).
  beforeEach(async () => {
    setSecretShouldFail = false
    storeState = {}
    vi.clearAllMocks()
    await updateConfig('transcription', { geminiApiKey: '' })
    storeState = {}
    vi.clearAllMocks()
  })

  it('rejects the save and rolls the key back when the store write fails on a key change', async () => {
    setSecretShouldFail = true
    await expect(updateConfig('transcription', { geminiApiKey: 'sk-a' })).rejects.toThrow(/credential store/i) // pragma: allowlist secret
    // The store write was attempted but the change did NOT take effect anywhere:
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-a')
    expect(storeState.apiKey).toBeUndefined() // store unchanged
    expect(getConfig().transcription.geminiApiKey).toBe('') // plaintext rolled back → no stale key active
  })

  it('takes effect once the store is writable again (retry after a failed key change)', async () => {
    setSecretShouldFail = true
    await expect(updateConfig('transcription', { geminiApiKey: 'sk-b' })).rejects.toThrow() // pragma: allowlist secret
    expect(getConfig().transcription.geminiApiKey).toBe('') // rolled back

    setSecretShouldFail = false
    mockSetSecret.mockClear()
    await updateConfig('transcription', { geminiApiKey: 'sk-b' }) // pragma: allowlist secret — now succeeds
    expect(storeState.apiKey).toBe('sk-b')
    expect(getConfig().transcription.geminiApiKey).toBe('sk-b')
  })

  it('a failed key CLEAR rejects and leaves the old key consistent in both config and store', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-old' }) // pragma: allowlist secret
    expect(storeState.apiKey).toBe('sk-old')

    setSecretShouldFail = true
    await expect(updateConfig('transcription', { geminiApiKey: '' })).rejects.toThrow()
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', null)
    expect(storeState.apiKey).toBe('sk-old') // store unchanged
    expect(getConfig().transcription.geminiApiKey).toBe('sk-old') // rolled back → consistent with store

    setSecretShouldFail = false
    mockSetSecret.mockClear()
    await updateConfig('transcription', { geminiApiKey: '' }) // real clear
    expect(storeState.apiKey).toBeUndefined()
    expect(getConfig().transcription.geminiApiKey).toBe('')
  })

  it('does NOT block an unrelated save when a background reconcile write fails (no key change)', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-x' }) // pragma: allowlist secret — config + store = sk-x
    expect(storeState.apiKey).toBe('sk-x')

    // Store drifts behind out-of-band; a later UNRELATED save reconciles it and
    // the reconcile write fails — but since the KEY did not change in this save,
    // the unrelated save must still succeed (rollback is scoped to key changes).
    storeState.apiKey = 'sk-drift' // pragma: allowlist secret
    setSecretShouldFail = true
    mockSetSecret.mockClear()
    await expect(updateConfig('ui', { theme: 'dark' })).resolves.toBeUndefined()
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-x') // reconcile attempted
    expect(getConfig().transcription.geminiApiKey).toBe('sk-x') // key unchanged, not rolled back
  })
})
