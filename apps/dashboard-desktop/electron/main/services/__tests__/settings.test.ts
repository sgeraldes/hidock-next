import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coerceSettings, SettingsStore } from '../settings'

describe('SettingsStore', () => {
  it('coerces unsafe flags to false', () => {
    expect(
      coerceSettings({
        autoDownloadEnabled: true,
        allowDestructiveDeviceCommands: true,
        allowReminderWrites: true,
        aiModelId: 'local/test',
        theme: 'dark'
      })
    ).toMatchObject({
      autoDownloadEnabled: true,
      allowDestructiveDeviceCommands: false,
      allowReminderWrites: false,
      aiModelId: 'local/test',
      theme: 'dark'
    })
  })

  it('falls back to defaults for malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hidock-dashboard-settings-'))
    const filePath = join(dir, 'settings.json')
    writeFileSync(filePath, '{bad json', 'utf8')

    const settings = new SettingsStore(filePath).get()
    expect(settings.autoDownloadEnabled).toBe(false)
    expect(settings.allowDestructiveDeviceCommands).toBe(false)
    expect(settings.allowReminderWrites).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })
})
