import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

export interface DashboardSettings {
  autoDownloadEnabled: boolean
  allowDestructiveDeviceCommands: false
  allowReminderWrites: false
  downloadsDirectory: string | null
  aiModelId: string
  theme: 'system' | 'light' | 'dark'
}

const DEFAULT_SETTINGS: DashboardSettings = {
  autoDownloadEnabled: false,
  allowDestructiveDeviceCommands: false,
  allowReminderWrites: false,
  downloadsDirectory: null,
  aiModelId: 'google/gemini-3.1-flash-lite',
  theme: 'system'
}

const settingsSchema = z
  .object({
    autoDownloadEnabled: z.boolean().default(DEFAULT_SETTINGS.autoDownloadEnabled),
    allowDestructiveDeviceCommands: z.boolean().optional(),
    allowReminderWrites: z.boolean().optional(),
    downloadsDirectory: z.string().min(1).nullable().default(DEFAULT_SETTINGS.downloadsDirectory),
    aiModelId: z.string().trim().min(1).default(DEFAULT_SETTINGS.aiModelId),
    theme: z.enum(['system', 'light', 'dark']).default(DEFAULT_SETTINGS.theme)
  })
  .partial()

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  get(): DashboardSettings {
    try {
      return coerceSettings(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown)
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  update(patch: Partial<DashboardSettings>): DashboardSettings {
    const next = coerceSettings({ ...this.get(), ...patch })

    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  }
}

export function coerceSettings(value: unknown): DashboardSettings {
  const parsed = settingsSchema.safeParse(value)
  if (!parsed.success) return DEFAULT_SETTINGS

  return {
    ...DEFAULT_SETTINGS,
    ...parsed.data,
    allowDestructiveDeviceCommands: false,
    allowReminderWrites: false,
    autoDownloadEnabled: parsed.data.autoDownloadEnabled === true
  }
}
