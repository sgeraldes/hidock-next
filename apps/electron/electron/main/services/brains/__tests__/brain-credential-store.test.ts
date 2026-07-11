/**
 * BrainCredentialStore tests — mirrors the ConnectorStore secret-vault pattern.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, rmSync } from 'fs'

// safeStorage unavailable → values are stored/read as plaintext (test-mode
// fallback, matching connector-store / config.ts).
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import { BrainCredentialStore } from '../brain-credential-store'

describe('BrainCredentialStore', () => {
  let filePath: string
  let store: BrainCredentialStore

  beforeEach(() => {
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
})
