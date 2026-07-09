/**
 * Electron-backed implementation of the connector `ConnectorStateStore`
 * contract (@hidock/connectors).
 *
 * - Non-secret config + per-source cursors → `<userData>/connectors.json`.
 * - Secrets (tokens, refresh tokens, API keys) → same file under `_secrets`,
 *   encrypted at rest via Electron `safeStorage` (DPAPI/Keychain-backed),
 *   mirroring the pattern config.ts uses for the ICS URL. CONNECTORS.md:
 *   "Secrets in the OS keychain / existing config service, never in the DB."
 *
 * safeStorage is the OS-keychain-backed mechanism already present in this app;
 * there is no keytar dependency. When encryption is unavailable (e.g. unit
 * tests under plain Node), values fall back to plaintext — matching config.ts.
 */
import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type {
  ConnectorConfig,
  ConnectorStateStore,
  StoredConnectorState,
  StoredSourceState,
} from '@hidock/connectors'

const ENC_PREFIX = '__enc__'

function encryptSecret(value: string): string {
  try {
    if (value && safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  } catch {
    /* fall through to plaintext */
  }
  return value
}

function decryptSecret(value: string): string {
  try {
    if (value.startsWith(ENC_PREFIX) && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
    }
  } catch {
    /* fall through to return as-is */
  }
  return value
}

/** On-disk shape: StoredConnectorState plus an internal encrypted secrets map. */
interface PersistedConnectorState extends StoredConnectorState {
  _secrets?: Record<string, string>
}

type StoreFile = Record<string, PersistedConnectorState>

function emptyState(): PersistedConnectorState {
  return { config: {}, lastSyncAt: null, sources: {}, _secrets: {} }
}

export class ConnectorStore implements ConnectorStateStore {
  private data: StoreFile = {}
  private loaded = false

  constructor(private readonly filePath?: string) {}

  private resolvePath(): string {
    // Lazily resolve to avoid touching electron `app` at import time.
    return this.filePath ?? join(app.getPath('userData'), 'connectors.json')
  }

  load(): void {
    if (this.loaded) return
    const path = this.resolvePath()
    try {
      if (existsSync(path)) {
        this.data = JSON.parse(readFileSync(path, 'utf-8')) as StoreFile
      }
    } catch (err) {
      console.error('[ConnectorStore] Failed to load connectors.json:', err)
      this.data = {}
    }
    this.loaded = true
  }

  private persist(): void {
    const path = this.resolvePath()
    try {
      const dir = join(path, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(this.data, null, 2))
    } catch (err) {
      console.error('[ConnectorStore] Failed to persist connectors.json:', err)
    }
  }

  private ensure(id: string): PersistedConnectorState {
    this.load()
    if (!this.data[id]) this.data[id] = emptyState()
    if (!this.data[id]._secrets) this.data[id]._secrets = {}
    return this.data[id]
  }

  /** ConnectorStateStore: returns state WITHOUT the internal secrets map. */
  getState(id: string): StoredConnectorState {
    const { _secrets, ...rest } = this.ensure(id)
    void _secrets
    return rest
  }

  getConfig(id: string): ConnectorConfig {
    return { ...this.ensure(id).config }
  }

  setConfig(id: string, config: ConnectorConfig): void {
    const state = this.ensure(id)
    state.config = { ...state.config, ...config }
    this.persist()
  }

  getSecret(id: string, key: string): string | null {
    const raw = this.ensure(id)._secrets![key]
    if (raw === undefined) return null
    return decryptSecret(raw)
  }

  hasSecret(id: string, key: string): boolean {
    const raw = this.ensure(id)._secrets![key]
    return raw !== undefined && raw !== ''
  }

  setSecret(id: string, key: string, value: string | null): void {
    const secrets = this.ensure(id)._secrets!
    if (value === null || value === '') {
      delete secrets[key]
    } else {
      secrets[key] = encryptSecret(value)
    }
    this.persist()
  }

  setLastSyncAt(id: string, iso: string | null): void {
    this.ensure(id).lastSyncAt = iso
    this.persist()
  }

  getSourceState(id: string, containerId: string): StoredSourceState {
    const state = this.ensure(id)
    if (!state.sources[containerId]) {
      state.sources[containerId] = { enabled: true, cursor: null, lastSyncAt: null }
    }
    return state.sources[containerId]
  }

  setSourceState(id: string, containerId: string, patch: Partial<StoredSourceState>): void {
    const current = this.getSourceState(id, containerId)
    this.ensure(id).sources[containerId] = { ...current, ...patch }
    this.persist()
  }

  /** Test helper: reset in-memory + on-disk state. */
  reset(): void {
    this.data = {}
    this.loaded = true
    this.persist()
  }
}

let singleton: ConnectorStore | null = null

export function getConnectorStore(): ConnectorStore {
  if (!singleton) {
    singleton = new ConnectorStore()
    singleton.load()
  }
  return singleton
}
