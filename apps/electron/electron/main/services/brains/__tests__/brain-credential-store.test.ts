/**
 * BrainCredentialStore tests — mirrors the ConnectorStore secret-vault pattern.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, rmSync } from 'fs'

// safeStorage is toggled per-test via these hoisted spies. Default: encryption
// UNAVAILABLE → values are stored/read as plaintext (test-mode fallback,
// matching connector-store / config.ts). Encrypted-mode tests flip
// mockIsEncAvailable to true; the encrypt/decrypt mocks reversibly wrap the
// value so a round-trip is observable, and can be made to throw.
const { mockIsEncAvailable, mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockIsEncAvailable: vi.fn(() => false),
  mockEncrypt: vi.fn((s: string) => Buffer.from(`ENC(${s})`)),
  mockDecrypt: vi.fn((b: Buffer) => b.toString().replace(/^ENC\((.*)\)$/s, '$1')),
}))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => mockIsEncAvailable(),
    encryptString: (s: string) => mockEncrypt(s),
    decryptString: (b: Buffer) => mockDecrypt(b),
  },
}))

import { BrainCredentialStore } from '../brain-credential-store'

describe('BrainCredentialStore', () => {
  let filePath: string
  let store: BrainCredentialStore

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEncAvailable.mockReturnValue(false)
    mockEncrypt.mockImplementation((s: string) => Buffer.from(`ENC(${s})`))
    mockDecrypt.mockImplementation((b: Buffer) => b.toString().replace(/^ENC\((.*)\)$/s, '$1'))
    filePath = join(tmpdir(), `brains-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    store = new BrainCredentialStore(filePath)
    store.load()
  })

  afterEach(() => {
    try {
      if (existsSync(filePath)) rmSync(filePath)
    } catch {
      /* ignore */
    }
  })

  it('returns null for an unset secret', () => {
    expect(store.getSecret('gemini-api', 'apiKey')).toBeNull()
    expect(store.hasSecret('gemini-api', 'apiKey')).toBe(false)
  })

  it('stores and reads a secret round-trip', () => {
    store.setSecret('gemini-api', 'apiKey', 'sk-abc123') // pragma: allowlist secret
    expect(store.hasSecret('gemini-api', 'apiKey')).toBe(true)
    expect(store.getSecret('gemini-api', 'apiKey')).toBe('sk-abc123')
  })

  it('persists across store instances (same file)', () => {
    store.setSecret('codex', 'OPENAI_API_KEY', 'oa-999') // pragma: allowlist secret
    const reopened = new BrainCredentialStore(filePath)
    reopened.load()
    expect(reopened.getSecret('codex', 'OPENAI_API_KEY')).toBe('oa-999')
  })

  it('deletes a secret when set to null or empty', () => {
    store.setSecret('gemini-api', 'apiKey', 'sk-abc123') // pragma: allowlist secret
    store.setSecret('gemini-api', 'apiKey', null)
    expect(store.hasSecret('gemini-api', 'apiKey')).toBe(false)
    expect(store.getSecret('gemini-api', 'apiKey')).toBeNull()
  })

  it('isolates secrets per brain id', () => {
    store.setSecret('gemini-api', 'apiKey', 'gem') // pragma: allowlist secret
    store.setSecret('claude-code', 'ANTHROPIC_API_KEY', 'ant') // pragma: allowlist secret
    expect(store.getSecret('gemini-api', 'apiKey')).toBe('gem')
    expect(store.getSecret('claude-code', 'ANTHROPIC_API_KEY')).toBe('ant')
    expect(store.getSecret('gemini-api', 'ANTHROPIC_API_KEY')).toBeNull()
  })

  describe('encryption at rest', () => {
    it('round-trips an encrypted secret when safeStorage is available', () => {
      mockIsEncAvailable.mockReturnValue(true)
      store.setSecret('gemini-api', 'apiKey', 'sk-secret') // pragma: allowlist secret

      // Persisted form is the __enc__-prefixed ciphertext, not the plaintext.
      const reopened = new BrainCredentialStore(filePath)
      reopened.load()
      expect(reopened.getSecret('gemini-api', 'apiKey')).toBe('sk-secret')
      expect(reopened.hasSecret('gemini-api', 'apiKey')).toBe(true)
      expect(mockEncrypt).toHaveBeenCalledWith('sk-secret')
    })

    it('returns null (not the ciphertext) when the keychain is unavailable at read time', () => {
      // Written while encryption is available…
      mockIsEncAvailable.mockReturnValue(true)
      store.setSecret('gemini-api', 'apiKey', 'sk-secret') // pragma: allowlist secret

      // …then the keychain becomes unavailable: the encrypted bytes can't be
      // read, so getSecret must return null so the plaintext-config fallback wins
      // (NOT the raw __enc__ ciphertext, which a resolver would treat as a key).
      mockIsEncAvailable.mockReturnValue(false)
      const reopened = new BrainCredentialStore(filePath)
      reopened.load()
      expect(reopened.getSecret('gemini-api', 'apiKey')).toBeNull()
      expect(reopened.hasSecret('gemini-api', 'apiKey')).toBe(false)
    })

    it('returns null when decryption throws (corrupt/foreign ciphertext)', () => {
      mockIsEncAvailable.mockReturnValue(true)
      store.setSecret('gemini-api', 'apiKey', 'sk-secret') // pragma: allowlist secret

      mockDecrypt.mockImplementation(() => {
        throw new Error('decrypt failed')
      })
      const reopened = new BrainCredentialStore(filePath)
      reopened.load()
      expect(reopened.getSecret('gemini-api', 'apiKey')).toBeNull()
      expect(reopened.hasSecret('gemini-api', 'apiKey')).toBe(false)
    })
  })
})
