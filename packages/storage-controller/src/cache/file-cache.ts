import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CacheData } from '../core/types.js'

export class FileCache {
  private cacheDir: string

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir
  }

  private filePath(deviceSerial: string): string {
    const safe = deviceSerial.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.cacheDir, `file-list-${safe}.json`)
  }

  load(deviceSerial: string): CacheData | null {
    const path = this.filePath(deviceSerial)
    try {
      const raw = readFileSync(path, 'utf-8')
      const data = JSON.parse(raw) as CacheData
      if (!data.deviceSerial || !Array.isArray(data.recordings)) return null
      return data
    } catch {
      return null
    }
  }

  save(data: CacheData): void {
    mkdirSync(this.cacheDir, { recursive: true })
    const path = this.filePath(data.deviceSerial)
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
  }

  clear(deviceSerial: string): void {
    const path = this.filePath(deviceSerial)
    try {
      rmSync(path)
    } catch {
      // File doesn't exist
    }
  }

  clearAll(): void {
    if (!existsSync(this.cacheDir)) return
    const files = readdirSync(this.cacheDir)
    for (const file of files) {
      if (file.startsWith('file-list-') && file.endsWith('.json')) {
        try {
          rmSync(join(this.cacheDir, file))
        } catch {
          // Ignore
        }
      }
    }
  }
}
