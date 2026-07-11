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

import { getConfig, migrateGeminiKeyToCredentialStore } from '../config'
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
