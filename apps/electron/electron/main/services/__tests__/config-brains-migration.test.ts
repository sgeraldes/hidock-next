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
 * Failure-injection — the whole point of the fix. A store write that fails to
 * persist must leave a RECONCILABLE state (never silently-successful-yet-stale),
 * and later saves / boot must self-heal it.
 */
describe('Gemini key ↔ credential-store sync — failure injection (self-healing)', () => {
  beforeEach(resetStore)

  // (a) A failed store write during a key change is reconcilable: the store stays
  //     mismatched and the NEXT save re-attempts (even for an unrelated field).
  it('re-attempts the sync on the next save after a failed store write', async () => {
    setSecretShouldFail = true
    await updateConfig('transcription', { geminiApiKey: 'sk-a' }) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-a')
    expect(storeState.apiKey).toBeUndefined() // write failed → store still empty

    setSecretShouldFail = false
    mockSetSecret.mockClear()
    await updateConfig('ui', { theme: 'dark' }) // unrelated save
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-a')
    expect(storeState.apiKey).toBe('sk-a') // self-healed
  })

  // (b) Retrying the SAME key after a failed sync actually re-attempts. The old
  //     diff-gated code skipped this because the in-memory config already matched.
  it('re-attempts when the SAME key is saved again after a failed sync', async () => {
    setSecretShouldFail = true
    await updateConfig('transcription', { geminiApiKey: 'sk-same' }) // pragma: allowlist secret
    expect(storeState.apiKey).toBeUndefined()

    setSecretShouldFail = false
    mockSetSecret.mockClear()
    await updateConfig('transcription', { geminiApiKey: 'sk-same' }) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-same')
    expect(storeState.apiKey).toBe('sk-same')
  })

  // (d) A failed clear does not leave the old key authoritative forever: a later
  //     successful save reconciles the store to the desired (empty) state.
  it('a failed clear does not leave the old key authoritative after a later successful save', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-old' }) // pragma: allowlist secret
    expect(storeState.apiKey).toBe('sk-old')

    setSecretShouldFail = true
    mockSetSecret.mockClear()
    await updateConfig('transcription', { geminiApiKey: '' })
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', null)
    expect(storeState.apiKey).toBe('sk-old') // stale — clear did not persist

    setSecretShouldFail = false
    mockSetSecret.mockClear()
    await updateConfig('ui', { theme: 'light' }) // later successful save
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', null)
    expect(storeState.apiKey).toBeUndefined() // reconciled → no longer authoritative
  })
})
