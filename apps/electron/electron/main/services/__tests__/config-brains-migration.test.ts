/**
 * config brains defaults + one-time Gemini-key → credential-store migration (H10).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}))

const mockHasSecret = vi.fn()
const mockSetSecret = vi.fn()
vi.mock('../brains/brain-credential-store', () => ({
  getBrainCredentialStore: () => ({ hasSecret: mockHasSecret, setSecret: mockSetSecret }),
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

describe('migrateGeminiKeyToCredentialStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasSecret.mockReturnValue(false)
  })

  it('copies the plaintext key into the credential store when none is stored', () => {
    migrateGeminiKeyToCredentialStore(cfgWith('sk-plain')) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-plain')
  })

  it('leaves the plaintext config value in place (belt-and-suspenders)', () => {
    const cfg = cfgWith('sk-plain') // pragma: allowlist secret
    migrateGeminiKeyToCredentialStore(cfg)
    expect(cfg.transcription.geminiApiKey).toBe('sk-plain')
  })

  it('is idempotent — skips when a secret already exists', () => {
    mockHasSecret.mockReturnValue(true)
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
})

/**
 * H10 FIX 1: Settings only writes the PLAINTEXT geminiApiKey, but
 * resolveGeminiApiKey() prefers the credential store. saveConfig/updateConfig
 * must therefore keep the store in sync whenever the key CHANGES — set on a
 * non-empty value, delete on clear — so rotation/clearing in Settings actually
 * takes effect instead of silently reusing the stale stored key.
 */
describe('Gemini key ↔ credential-store sync (updateConfig)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasSecret.mockReturnValue(false)
  })

  it('mirrors a newly set key into the credential store', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-new' }) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-new')
  })

  it('rotates the stored secret when the key changes', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-old' }) // pragma: allowlist secret
    mockSetSecret.mockClear()
    await updateConfig('transcription', { geminiApiKey: 'sk-rotated' }) // pragma: allowlist secret
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', 'sk-rotated')
  })

  it('deletes the stored secret when the key is cleared to empty', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-temp' }) // pragma: allowlist secret
    mockSetSecret.mockClear()
    await updateConfig('transcription', { geminiApiKey: '' })
    expect(mockSetSecret).toHaveBeenCalledWith('gemini-api', 'apiKey', null)
  })

  it('does not touch the store when the Gemini key is unchanged', async () => {
    await updateConfig('transcription', { geminiApiKey: 'sk-stable' }) // pragma: allowlist secret
    mockSetSecret.mockClear()
    await updateConfig('ui', { theme: 'dark' })
    expect(mockSetSecret).not.toHaveBeenCalled()
  })
})
