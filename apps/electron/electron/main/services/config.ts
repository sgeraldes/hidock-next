import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

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
    language: 'es'
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
      if (modelsChanged || autoTransChanged) {
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
  config = deepMerge(config, newConfig)

  const configPath = getConfigPath()
  const configDir = join(configPath, '..')

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  // CS-007: Encrypt sensitive fields before writing to disk
  const toWrite = {
    ...config,
    calendar: {
      ...config.calendar,
      icsUrl: encryptSensitive(config.calendar.icsUrl)
    }
  }
  writeFileSync(configPath, JSON.stringify(toWrite, null, 2))
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
