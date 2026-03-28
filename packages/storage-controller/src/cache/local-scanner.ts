import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import type { Recording } from '../core/types.js'
import { parseFilenameDateTime } from '../core/filename-parser.js'

const AUDIO_EXTENSIONS = new Set(['.wav', '.hda'])

export class LocalScanner {
  private directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  scan(): Recording[] {
    if (!existsSync(this.directory)) return []

    const recordings: Recording[] = []

    let files: string[]
    try {
      files = readdirSync(this.directory)
    } catch {
      return []
    }

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!AUDIO_EXTENSIONS.has(ext)) continue

      const fullPath = join(this.directory, file)
      let size: number
      try {
        size = statSync(fullPath).size
      } catch {
        continue
      }

      const { date } = parseFilenameDateTime(file)

      recordings.push({
        filename: file,
        date,
        duration: 0,
        size,
        source: 'local',
        localPath: fullPath,
        version: 0,
        signature: '',
      })
    }

    return recordings
  }
}
