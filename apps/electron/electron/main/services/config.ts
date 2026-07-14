import { app, safeStorage } from 'electron'
import { join } from 'path'
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
import type { BrainId, BrainTask } from './brains/types'
import { getBrainCredentialStore } from './brains/brain-credential-store'
import type { FeaturesConfig } from '../../../src/shared/feature-registry'
import { DEFAULT_FEATURES_CONFIG } from '../../../src/shared/feature-registry'

/** Best-effort fsync of a path (file or directory). Silently skips where the FS
 *  or platform doesn't support it (e.g. directory fsync on Windows) — durability
 *  is a hardening, never a correctness dependency. Mirrors BrainCredentialStore. */
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

/**
 * Atomically write config.json: write a UNIQUELY-named sibling temp file, fsync
 * it, then rename it over the target (and fsync the directory where supported).
 * An interrupted/partial write lands in the temp file and can NEVER corrupt the
 * real config.json (rename is atomic on the same filesystem). Mirrors
 * BrainCredentialStore.persist() so both files use the same durability contract.
 * THROWS on failure (temp cleaned up) so the caller can compensate.
 */
function writeConfigAtomically(path: string, contents: string): void {
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
  const tmp = `${path}.${unique}.tmp`
  try {
    writeFileSync(tmp, contents)
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

// CS-007: Encrypt sensitive config values (ICS URL) at rest using Electron safeStorage
function encryptSensitive(value: string): string {
  try {
    if (safeStorage.isEncryptionAvailable() && value) {
      return '__enc__' + safeStorage.encryptString(value).toString('base64')
    }
  } catch { /* fall through to plaintext */ }
  return value
}

function decryptSensitive(value: string): string {
  try {
    if (value.startsWith('__enc__') && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(value.slice(7), 'base64'))
    }
  } catch { /* fall through to return as-is */ }
  return value
}

export interface AppConfig {
  version: string
  storage: {
    dataPath: string
    recordingsPath?: string
    transcriptsPath?: string
    maxRecordingsGB: number
  }
  calendar: {
    icsUrl: string
    syncEnabled: boolean
    syncIntervalMinutes: number
    lastSyncAt: string | null
  }
  transcription: {
    provider: 'gemini' | 'local-asr' | 'vibevoice'
    geminiApiKey: string
    geminiModel: string
    localAsrPath: string
    localAsrHfToken: string
    localAsrVocabularyFile: string
    localAsrDiarize: boolean
    localAsrNumBeams: number
    // VibeVoice backend (microsoft/VibeVoice-ASR) — reuses localAsrPath/mcp_runner.py.
    vibevoiceModelId: string
    vibevoiceDevice: string
    vibevoiceAttn: string
    autoTranscribe: boolean
    language: string
    // F16/spec-001 kill-switch: gates the content-based VALUE classification
    // that rides the post-transcription analysis call (item-9 prompt append +
    // the applyCaptureValueClassification write/emit). Default true. When
    // false, the analysis prompt is byte-identical to pre-F16 behavior and no
    // value write/emit occurs — existing captures can still be classified
    // later via the standalone backfill (separate complete() call, no
    // summary-call blast radius). See phase-1-architecture-review.md A1.
    valueClassificationEnabled: boolean
    // Codex adversarial review (AR-2a): a downgrade (low->low-value,
    // none->garbage) only persists when the model's own confidence meets this
    // floor; below it, applyCaptureValueClassification writes nothing at all
    // (defense-in-depth against a low-confidence/injected misclassification).
    // high/normal are never gated by this (they never downgrade regardless).
    valueClassificationMinConfidence: number
  }
  embeddings: {
    provider: 'ollama'
    ollamaBaseUrl: string
    ollamaModel: string
    chunkSize: number
    chunkOverlap: number
  }
  chat: {
    provider: 'gemini' | 'ollama'
    geminiModel: string
    ollamaModel: string
    maxContextChunks: number
  }
  device: {
    autoConnect: boolean
    autoDownload: boolean
  }
  integrations: {
    // Default working directory for the "Open in Claude Code" handoff when the
    // source meeting has no project folder. Remembered after the user picks one.
    handoffDirectory: string
  }
  // Pluggable AI "brains" (H10). Add-on toggles + per-task routing. Secrets live
  // in BrainCredentialStore (<userData>/brains.json), NOT here. Defaults preserve
  // the legacy Gemini-first / Ollama-fallback behaviour until the user opts in.
  brains: {
    enabled: Record<BrainId, boolean>
    defaultBrain: BrainId
    taskRouting: Partial<Record<BrainTask, BrainId>>
    models: Partial<Record<BrainId, string>>
  }
  // Modular features (Track I). `preset` selects a named feature-set; `flags` are
  // sparse per-feature overrides. Default preset `full` = ZERO behavior change for
  // existing installs. The effective per-feature state is computed by the pure
  // resolveFeatureState() in src/shared/feature-registry.ts.
  features: FeaturesConfig
  ui: {
    theme: 'light' | 'dark' | 'system'
    defaultView: 'week' | 'month'
    startOfWeek: number
    calendarView: 'day' | 'workweek' | 'week' | 'month'
    hideEmptyMeetings: boolean
    showListView: boolean
  }
}

const DEFAULT_CONFIG: AppConfig = {
  version: '1.0.0',
  storage: {
    dataPath: join(app.getPath('home'), 'HiDock'),
    maxRecordingsGB: 50
  },
  calendar: {
    icsUrl: '',
    syncEnabled: true,
    syncIntervalMinutes: 15,
    lastSyncAt: null
  },
  transcription: {
    provider: 'gemini',
    geminiApiKey: '',
    geminiModel: 'gemini-3.5-flash', // current flash model (2.0/2.5-flash retired); audio-capable for transcription
    localAsrPath: process.env.ASR_MCP_PATH || 'G:\\Code\\claude-plugins\\plugins\\mcp-asr',
    localAsrHfToken: process.env.HF_TOKEN || '',
    localAsrVocabularyFile: 'vocabulary.json',
    localAsrDiarize: true,
    localAsrNumBeams: 5,
    vibevoiceModelId: process.env.VIBEVOICE_MODEL_ID || 'microsoft/VibeVoice-ASR',
    vibevoiceDevice: process.env.ASR_DEVICE || 'cuda:0',
    vibevoiceAttn: process.env.VIBEVOICE_ATTN || 'sdpa', // VibeVoice-ASR supports neither flash_attention_2 (not built on Windows) nor flex_attention (unsupported arch); both silently fall back to sdpa, so use it directly
    autoTranscribe: true,
    language: 'es',
    valueClassificationEnabled: true,
    valueClassificationMinConfidence: 0.6
  },
  embeddings: {
    provider: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'nomic-embed-text',
    chunkSize: 500,
    chunkOverlap: 50
  },
  chat: {
    provider: 'gemini',
    geminiModel: 'gemini-3.5-flash',
    ollamaModel: 'llama3.2',
    maxContextChunks: 10
  },
  device: {
    autoConnect: true,
    autoDownload: true
  },
  integrations: {
    handoffDirectory: ''
  },
  brains: {
    // Only the two current providers are on by default → nothing changes until
    // the user enables Claude Code / Codex / Gemini CLI / Kiro CLI (later phases).
    enabled: {
      'gemini-api': true,
      ollama: true,
      'claude-code': false,
      codex: false,
      'gemini-cli': false,
      kiro: false
    },
    defaultBrain: 'gemini-api',
    taskRouting: {},
    models: {}
  },
  // Default preset `full` → every feature enabled → identical behavior to before
  // modular features existed. New installs may later be asked during onboarding.
  features: { ...DEFAULT_FEATURES_CONFIG },
  ui: {
    theme: 'system',
    defaultView: 'week',
    startOfWeek: 1, // Monday
    calendarView: 'week',
    hideEmptyMeetings: true,
    showListView: false
  }
}

let config: AppConfig = { ...DEFAULT_CONFIG }

export function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function getDataPath(): string {
  return config.storage.dataPath
}

// Gemini models that are retired / unavailable for generateContent. Persisted
// configs holding these are upgraded to the current default on load.
export const RETIRED_GEMINI_MODELS = new Set([
  'gemini-pro',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-3-pro-preview',
])
export const CURRENT_GEMINI_MODEL = 'gemini-3.5-flash'

/** Upgrade any retired geminiModel values in-place. Returns true if changed. */
function migrateRetiredGeminiModels(cfg: AppConfig): boolean {
  let changed = false
  for (const section of ['transcription', 'chat'] as const) {
    const sec = cfg[section] as { geminiModel?: string } | undefined
    if (sec && sec.geminiModel && RETIRED_GEMINI_MODELS.has(sec.geminiModel)) {
      sec.geminiModel = CURRENT_GEMINI_MODEL
      changed = true
    }
  }
  return changed
}

/**
 * One-time: re-enable auto-transcription. Long-recording transcription was
 * broken (truncation/hangs) and users turned the toggle off; now that the
 * pipeline works, restore it once. The marker keeps the user's choice
 * authoritative afterwards — turning it off again sticks.
 */
function migrateAutoTranscribeRestore(cfg: AppConfig): boolean {
  const marker = (cfg as unknown as Record<string, unknown>)['autoTranscribeRestored2026_07']
  if (marker) return false
  ;(cfg as unknown as Record<string, unknown>)['autoTranscribeRestored2026_07'] = true
  if (cfg.transcription.autoTranscribe !== true) {
    cfg.transcription.autoTranscribe = true
  }
  return true
}

/**
 * Reconcile the encrypted BrainCredentialStore's `gemini-api/apiKey` with the
 * desired plaintext value, writing ONLY when the store's current readable value
 * differs from the target. This is the self-healing core of the two-write sync:
 *
 *  - Idempotent: when the store already matches, it is a no-op (no needless write).
 *  - Self-healing: a previous save whose store write FAILED left the store still
 *    mismatched, so the next call re-attempts automatically.
 *  - Observable: a failed persist is logged loudly (never silently swallowed) and
 *    reported to the caller via the boolean return.
 *
 * `rawKey` is the plaintext geminiApiKey; empty/whitespace means "no key" →
 * delete the stored secret. Never throws.
 *
 * Returns true when the store already matched or was successfully updated; false
 * when a needed write could not be persisted (state left reconcilable).
 */
export function syncGeminiKeyToCredentialStore(rawKey: string): boolean {
  const desired = rawKey.trim() ? rawKey.trim() : null // null => delete
  try {
    const store = getBrainCredentialStore()
    // getSecret returns null when absent OR unreadable (keychain locked). In both
    // cases a non-null desired value differs → we (re)write it; a null desired
    // with an already-absent secret matches → no-op.
    const current = store.getSecret('gemini-api', 'apiKey')
    const currentNorm = current && current.length ? current : null
    if (currentNorm === desired) return true // already in sync
    const ok = store.setSecret('gemini-api', 'apiKey', desired)
    if (!ok) {
      console.error(
        '[Config] Gemini key sync to credential store FAILED to persist; ' +
          'state left reconcilable (next save/boot will retry, plaintext fallback still works).'
      )
    }
    return ok
  } catch (e) {
    console.error('[Config] Failed to sync Gemini key to credential store:', e)
    return false
  }
}

/**
 * Boot-time (H10): reconcile the encrypted BrainCredentialStore with the legacy
 * plaintext `transcription.geminiApiKey`. Originally a one-time copy that ran
 * only when the store was empty; now it RECONCILES a mismatch too, so a store
 * that fell behind config.json (e.g. an earlier rotation whose store write
 * failed) is repaired on the next boot rather than silently serving the stale
 * stored key (resolveGeminiApiKey prefers the store). Plaintext is authoritative
 * here — the same "compare store vs plaintext" logic as the per-save sync.
 *
 * The plaintext value is deliberately LEFT in place for one release
 * (belt-and-suspenders; GeminiApiBrain reads the store first, the plaintext key
 * as fallback). Never throws; returns true only if `cfg` itself changed (to
 * trigger a re-save).
 */
export function migrateGeminiKeyToCredentialStore(cfg: AppConfig): boolean {
  const key = cfg.transcription.geminiApiKey?.trim()
  if (!key) return false
  try {
    const store = getBrainCredentialStore()
    // Reconcile: (re)write when the store doesn't already hold this exact key —
    // covers empty, unreadable (null), and stale/different values. Idempotent
    // when it already matches.
    const current = store.getSecret('gemini-api', 'apiKey')
    if (current !== key) {
      store.setSecret('gemini-api', 'apiKey', key)
    }
    let changed = false
    if (cfg.brains && cfg.brains.enabled['gemini-api'] !== true) {
      cfg.brains.enabled['gemini-api'] = true
      changed = true
    }
    return changed
  } catch (e) {
    console.warn('[Config] Gemini key → credential store migration skipped:', e)
    return false
  }
}

export async function initializeConfig(): Promise<void> {
  const configPath = getConfigPath()

  try {
    if (existsSync(configPath)) {
      const fileContent = readFileSync(configPath, 'utf-8')
      const savedConfig = JSON.parse(fileContent)
      // CS-007: Decrypt sensitive fields before loading into memory
      if (savedConfig.calendar?.icsUrl) {
        savedConfig.calendar.icsUrl = decryptSensitive(savedConfig.calendar.icsUrl)
      }
      // Merge with defaults to handle new fields
      config = deepMerge(DEFAULT_CONFIG, savedConfig)
      // Auto-upgrade retired Gemini model names in persisted configs so old
      // saved values (e.g. gemini-2.0-flash, now 404) don't break transcription
      // and GraphRAG extraction. Persist if anything changed.
      const modelsChanged = migrateRetiredGeminiModels(config)
      const autoTransChanged = migrateAutoTranscribeRestore(config)
      const keyMigrated = migrateGeminiKeyToCredentialStore(config)
      if (modelsChanged || autoTransChanged || keyMigrated) {
        await saveConfig(config)
      }
    } else {
      // Create config file with defaults
      await saveConfig(DEFAULT_CONFIG)
    }
  } catch (error) {
    console.error('Error loading config:', error)
    config = { ...DEFAULT_CONFIG }
  }
}

export function getConfig(): AppConfig {
  return { ...config }
}

export async function saveConfig(newConfig: Partial<AppConfig>): Promise<void> {
  // Snapshot the PRIOR in-memory config and the PRIOR plaintext key BEFORE merging
  // so we can (a) roll back a failed store write on a key change (HIGH-4) and
  // (b) compensate a store write that succeeded but whose config.json write then
  // failed (HIGH — the store-then-config split-brain, other direction).
  const prevConfig = config
  const prevGeminiKey = config.transcription?.geminiApiKey ?? ''

  // Capture the credential store's PRIOR gemini key so that, if the config.json
  // write fails AFTER the store write already committed a key change, we can
  // restore the store to exactly what it held before this save.
  let priorStoreValue: string | null = null
  try {
    priorStoreValue = getBrainCredentialStore().getSecret('gemini-api', 'apiKey')
  } catch {
    priorStoreValue = null
  }

  config = deepMerge(config, newConfig)

  const desiredGeminiKey = config.transcription?.geminiApiKey ?? ''
  const geminiKeyChanged = prevGeminiKey.trim() !== desiredGeminiKey.trim()

  // H10 FIX: keep the encrypted credential store in sync with the plaintext
  // `transcription.geminiApiKey`. resolveGeminiApiKey() prefers the store, so
  // without this a rotated/cleared key in Settings (which only touches the
  // plaintext field) would silently keep using the stale stored key.
  //
  // This is reconcile-based, NOT diff-gated: we compare the store's CURRENT
  // value against the desired one on EVERY save and write only on a real
  // mismatch. That makes it idempotent AND self-healing — a reconcile whose
  // store write fails for a NON-key-change save re-attempts on the next save
  // (defence in depth), while boot migration repairs a store that fell behind.
  //
  // HIGH-4: if the store write fails for THIS save's key CHANGE, the change must
  // NOT be reported as a success while the stale key stays active
  // (resolveGeminiApiKey prefers the store). We roll the geminiApiKey field back
  // to its previous value — in memory AND in what we write to config.json — so
  // plaintext and store stay CONSISTENT (config is never ahead of the store),
  // and we surface the failure to the caller (throw) so the UI can react. The
  // rollback is scoped to geminiApiKey; unrelated fields in this save still
  // persist, and unrelated saves are never blocked by a background reconcile.
  //
  // Done BEFORE writing config.json so a store-write failure never leaves
  // config.json ahead of brains.json.
  const syncOk = syncGeminiKeyToCredentialStore(desiredGeminiKey)
  let keyChangeFailed = false
  if (!syncOk && geminiKeyChanged) {
    config.transcription.geminiApiKey = prevGeminiKey
    keyChangeFailed = true
  }

  const configPath = getConfigPath()

  // CS-007: Encrypt sensitive fields before writing to disk
  const toWrite = {
    ...config,
    calendar: {
      ...config.calendar,
      icsUrl: encryptSensitive(config.calendar.icsUrl)
    }
  }

  // HIGH (store-then-config split-brain, the OTHER direction): the store write
  // above has ALREADY committed the desired key. If we now fail to write
  // config.json (disk full / permissions / AV), the store would hold the NEW key
  // while config.json — and a restart's boot reconciliation — flip back to the OLD
  // plaintext. Because resolveGeminiApiKey() prefers the store, a *failed* save
  // would have silently changed the active credential. So we write config.json
  // ATOMICALLY (temp + rename, mirroring the credential store's own pattern) and,
  // on failure AFTER a successful store key change, COMPENSATE by restoring the
  // prior store value AND the prior in-memory config, then rethrow — so disk,
  // memory, and the effective key all stay on the PREVIOUS value. If compensation
  // itself fails we log loudly and explicitly (split-brain, naming both files);
  // never silently.
  try {
    writeConfigAtomically(configPath, JSON.stringify(toWrite, null, 2))
  } catch (writeErr) {
    // Only the store direction can split-brain here: config.json still holds the
    // OLD key (its write failed), so we must undo a store write that changed the
    // key. A reconcile with no key change (config.json unchanged either way) is
    // already consistent — leave the (healed) store alone.
    if (syncOk && geminiKeyChanged) {
      const restored = syncGeminiKeyToCredentialStore(priorStoreValue ?? '')
      if (!restored) {
        console.error(
          '[Config] SPLIT-BRAIN: writing config.json FAILED after the Gemini API key was ' +
            'changed in the credential store (brains.json), and restoring the previous stored ' +
            'key ALSO failed. brains.json now holds the NEW key while config.json holds the OLD ' +
            'key; resolveGeminiApiKey() will use the new (unsaved) key until the next successful ' +
            'save or boot reconciliation repairs it. Manual reconciliation of brains.json vs ' +
            'config.json may be required.',
          writeErr
        )
      }
    }
    // Restore the prior in-memory config so memory matches what is (still) on disk.
    config = prevConfig
    throw writeErr
  }

  if (keyChangeFailed) {
    throw new Error(
      'Failed to persist the Gemini API key to the secure credential store; the key change was ' +
        'rolled back (previous key still in effect). Other settings were saved.'
    )
  }
}

export async function updateConfig<K extends keyof AppConfig>(
  section: K,
  values: Partial<AppConfig[K]>
): Promise<void> {
  const updatedSection = { ...(config[section] as any), ...values }
  await saveConfig({ [section]: updatedSection } as Partial<AppConfig>)
}

// Deep merge utility
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key]
      const targetValue = result[key]

      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue as Partial<typeof targetValue>)
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }

  return result
}
