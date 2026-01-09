import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface AppConfig {
  version: string
  storage: {
    dataPath: string
    maxRecordingsGB: number
  }
  calendar: {
    icsUrl: string
    syncEnabled: boolean
    syncIntervalMinutes: number
    lastSyncAt: string | null
  }
  transcription: {
    provider: 'gemini'
    geminiApiKey: string
    geminiModel: string
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
  ui: {
    theme: 'light' | 'dark' | 'system'
    defaultView: 'week' | 'month'
    startOfWeek: number
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
    geminiModel: 'gemini-2.0-flash',
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
    geminiModel: 'gemini-2.0-flash',
    ollamaModel: 'llama3.2',
    maxContextChunks: 10
  },
  device: {
    autoConnect: true,
    autoDownload: true
  },
  ui: {
    theme: 'system',
    defaultView: 'week',
    startOfWeek: 1 // Monday
  }
}

let config: AppConfig = { ...DEFAULT_CONFIG }

export function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function getDataPath(): string {
  return config.storage.dataPath
}

export async function initializeConfig(): Promise<void> {
  const configPath = getConfigPath()

  try {
    if (existsSync(configPath)) {
      const fileContent = readFileSync(configPath, 'utf-8')
      const savedConfig = JSON.parse(fileContent)
      // Merge with defaults to handle new fields
      config = deepMerge(DEFAULT_CONFIG, savedConfig)
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

  writeFileSync(configPath, JSON.stringify(config, null, 2))
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
