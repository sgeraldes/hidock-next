/**
 * Per-brain secret vault (H10, Phase 1).
 *
 * Mirrors `services/connectors/connector-store.ts` exactly: secrets are stored
 * in `<userData>/brains.json` under a `_secrets` map, encrypted at rest via
 * Electron `safeStorage` (DPAPI/Keychain-backed) with an `__enc__` prefix. When
 * encryption is unavailable (unit tests under plain Node), values fall back to
 * plaintext — matching connector-store and config.ts.
 *
 * Keys per brain (spec §C.3):
 *   gemini-api  → 'apiKey'
 *   codex       → optional 'OPENAI_API_KEY'
 *   claude-code → optional 'ANTHROPIC_API_KEY'
 *   gemini-cli  → optional 'GEMINI_API_KEY'
 *
 * Defensive design: every method is wrapped so that a missing Electron runtime
 * (e.g. vitest without an electron mock) degrades to "no secret" instead of
 * throwing — the brains then fall back to the plaintext config key.
 */
import { app, safeStorage } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { BrainId } from './types'

const ENC_PREFIX = '__enc__'

function encryptSecret(value: string): string {
  try {
    if (value && safeStorage?.isEncryptionAvailable?.()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  } catch {
    /* fall through to plaintext */
  }
  return value
}

function decryptSecret(value: string): string {
  try {
    if (value.startsWith(ENC_PREFIX) && safeStorage?.isEncryptionAvailable?.()) {
      return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
    }
  } catch {
    /* fall through to return as-is */
  }
  return value
}

/** On-disk shape: a per-brain secrets map keyed by brain id. */
interface PersistedBrainState {
  _secrets: Record<string, string>
}

type StoreFile = Record<string, PersistedBrainState>

export class BrainCredentialStore {
  private data: StoreFile = {}
  private loaded = false

  constructor(private readonly filePath?: string) {}

  private resolvePath(): string {
    if (this.filePath) return this.filePath
    // Lazily resolve to avoid touching electron `app` at import time. Fall back
    // to a temp path when `app` is unavailable (non-electron test runtime).
    try {
      return join(app.getPath('userData'), 'brains.json')
    } catch {
      return join(tmpdir(), 'hidock-brains.json')
    }
  }

  load(): void {
    if (this.loaded) return
    try {
      const path = this.resolvePath()
      if (existsSync(path)) {
        this.data = JSON.parse(readFileSync(path, 'utf-8')) as StoreFile
      }
    } catch (err) {
      console.error('[BrainCredentialStore] Failed to load brains.json:', err)
      this.data = {}
    }
    this.loaded = true
  }

  private persist(): void {
    try {
      const path = this.resolvePath()
      const dir = join(path, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(this.data, null, 2))
    } catch (err) {
      console.error('[BrainCredentialStore] Failed to persist brains.json:', err)
    }
  }

  private ensure(id: BrainId): PersistedBrainState {
    this.load()
    if (!this.data[id]) this.data[id] = { _secrets: {} }
    if (!this.data[id]._secrets) this.data[id]._secrets = {}
    return this.data[id]
  }

  getSecret(brainId: BrainId, key: string): string | null {
    try {
      const raw = this.ensure(brainId)._secrets[key]
      if (raw === undefined) return null
      return decryptSecret(raw)
    } catch {
      return null
    }
  }

  hasSecret(brainId: BrainId, key: string): boolean {
    try {
      const raw = this.ensure(brainId)._secrets[key]
      return raw !== undefined && raw !== ''
    } catch {
      return false
    }
  }

  setSecret(brainId: BrainId, key: string, value: string | null): void {
    try {
      const secrets = this.ensure(brainId)._secrets
      if (value === null || value === '') {
        delete secrets[key]
      } else {
        secrets[key] = encryptSecret(value)
      }
      this.persist()
    } catch (err) {
      console.error('[BrainCredentialStore] Failed to set secret:', err)
    }
  }

  /** Test helper: reset in-memory + on-disk state. */
  reset(): void {
    this.data = {}
    this.loaded = true
    this.persist()
  }
}

let singleton: BrainCredentialStore | null = null

export function getBrainCredentialStore(): BrainCredentialStore {
  if (!singleton) {
    singleton = new BrainCredentialStore()
    singleton.load()
  }
  return singleton
}

/** Test helper: drop the singleton so a fresh store is built next call. */
export function resetBrainCredentialStore(): void {
  singleton = null
}
