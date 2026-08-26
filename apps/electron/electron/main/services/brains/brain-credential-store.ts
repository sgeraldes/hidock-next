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
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'fs'
import type { BrainId } from './types'

const ENC_PREFIX = '__enc__'

/** Best-effort fsync of a path (file or directory). Silently skips where the FS
 *  or platform doesn't support it (e.g. directory fsync on Windows) — durability
 *  is a hardening, never a correctness dependency. */
function fsyncPath(path: string, mode: string): void {
  try {
    const fd = openSync(path, mode)
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    /* fsync unsupported / unavailable — ignore */
  }
}

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

/**
 * Decrypt a stored value.
 *  - No `__enc__` prefix → it's plaintext; return as-is.
 *  - Encrypted but undecryptable (safeStorage unavailable, or decryptString
 *    throws) → return null. Returning the raw ciphertext here would make callers
 *    (resolveGeminiApiKey) treat the `__enc__…` blob as a valid key and skip the
 *    still-valid plaintext-config fallback, breaking all Gemini ops on a
 *    keychain lock. null lets the fallback kick in.
 */
function decryptSecret(value: string): string | null {
  if (!value.startsWith(ENC_PREFIX)) return value
  try {
    if (safeStorage?.isEncryptionAvailable?.()) {
      return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
    }
  } catch {
    return null
  }
  // Encrypted bytes exist but no keychain is available to read them.
  return null
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

  /**
   * Atomically persist the store: write a UNIQUELY-named sibling temp file, fsync
   * it, then rename it over `brains.json` (and fsync the directory where the OS
   * supports it). An interrupted/partial write lands in the temp file and can
   * NEVER corrupt the real file (rename is atomic on the same filesystem).
   *
   * The temp name is unique per write (`brains.json.<pid>.<ts>.<rand>.tmp`) — a
   * FIXED shared `brains.json.tmp` let two processes/instances clobber each
   * other's in-flight temp or commit a stale full-file snapshot (lost updates,
   * MEDIUM-7). Distinct temp names mean concurrent writers never share a scratch
   * file; the rename is still the single atomic commit point.
   *
   * Unlike the pre-fix implementation this THROWS on failure — the caller
   * (setSecret) surfaces it instead of silently swallowing, which is what let a
   * failed key rotation leave brains.json and config.json split-brained.
   */
  private persist(): void {
    const path = this.resolvePath()
    const dir = join(path, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
    const tmp = `${path}.${unique}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      fsyncPath(tmp, 'r+') // durably flush the temp bytes before the rename commits
      renameSync(tmp, path)
      fsyncPath(dir, 'r') // durably flush the rename (best-effort; no-op on Windows)
    } catch (err) {
      // Clean up our unique temp so a failed write doesn't leak scratch files.
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        /* ignore cleanup failure */
      }
      throw err
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

  /**
   * True only when a secret is stored AND readable. An encrypted value that
   * cannot be decrypted (keychain locked/unavailable) reports false, so the
   * one-time migration does NOT treat an unreadable value as "already migrated"
   * and the plaintext-config fallback stays authoritative.
   */
  hasSecret(brainId: BrainId, key: string): boolean {
    return this.getSecret(brainId, key) !== null
  }

  /**
   * Store (or, for null/'' , delete) a secret and persist atomically.
   *
   * Returns `true` only when the change reached disk. On a persistence failure
   * (read-only/full/permission-denied/interrupted write) the in-memory change is
   * ROLLED BACK so in-memory state matches on-disk truth, and `false` is
   * returned. This is what makes the vault reconcilable: because getSecret() then
   * still reports the OLD value, the next saveConfig/boot re-attempts the sync
   * instead of believing a failed write succeeded (the old split-brain bug).
   */
  setSecret(brainId: BrainId, key: string, value: string | null): boolean {
    let secrets: Record<string, string>
    try {
      secrets = this.ensure(brainId)._secrets
    } catch (err) {
      console.error('[BrainCredentialStore] Failed to access secret store:', err)
      return false
    }

    const had = Object.prototype.hasOwnProperty.call(secrets, key)
    const prev = secrets[key]
    if (value === null || value === '') {
      delete secrets[key]
    } else {
      secrets[key] = encryptSecret(value)
    }

    try {
      this.persist()
      return true
    } catch (err) {
      // Roll back so in-memory === on-disk, keeping the state reconcilable.
      if (had) secrets[key] = prev
      else delete secrets[key]
      console.error(
        '[BrainCredentialStore] Failed to persist secret; change rolled back (state left reconcilable):',
        err
      )
      return false
    }
  }

  /** Test helper: reset in-memory + on-disk state. */
  reset(): void {
    this.data = {}
    this.loaded = true
    try {
      this.persist()
    } catch (err) {
      console.error('[BrainCredentialStore] Failed to persist during reset:', err)
    }
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
