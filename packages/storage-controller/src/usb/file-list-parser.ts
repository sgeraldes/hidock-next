import type { FileEntry } from '../core/types.js'
import { parseFilenameDateTime, calculateDurationSeconds } from '../core/filename-parser.js'

export interface ParseResult {
  entry: FileEntry
  bytesConsumed: number
}

export function parseFileListEntry(data: Uint8Array, offset: number): ParseResult | null {
  let pos = offset

  if (pos + 4 > data.length) return null
  const version = data[pos++] & 0xff

  if (pos + 3 > data.length) return null
  const nameLen =
    ((data[pos] & 0xff) << 16) |
    ((data[pos + 1] & 0xff) << 8) |
    (data[pos + 2] & 0xff)
  pos += 3

  if (pos + nameLen > data.length) return null
  const nameChars: string[] = []
  for (let i = 0; i < nameLen; i++) {
    const ch = data[pos++] & 0xff
    if (ch > 0) nameChars.push(String.fromCharCode(ch))
  }

  if (pos + 4 > data.length) return null
  const fileLength =
    ((data[pos] & 0xff) << 24) |
    ((data[pos + 1] & 0xff) << 16) |
    ((data[pos + 2] & 0xff) << 8) |
    (data[pos + 3] & 0xff)
  pos += 4

  if (pos + 6 > data.length) return null
  pos += 6

  if (pos + 16 > data.length) return null
  const sigParts: string[] = []
  for (let i = 0; i < 16; i++) {
    const hex = (data[pos++] & 0xff).toString(16)
    sigParts.push(hex.length === 1 ? '0' + hex : hex)
  }

  const filename = nameChars.join('')
  const { date, createDate, createTime } = parseFilenameDateTime(filename)
  const duration = calculateDurationSeconds(fileLength, version)

  return {
    entry: {
      name: filename,
      createDate,
      createTime,
      time: date,
      duration,
      version,
      length: fileLength,
      signature: sigParts.join('')
    },
    bytesConsumed: pos - offset
  }
}

export function parseFileListBuffer(data: Uint8Array): FileEntry[] {
  const entries: FileEntry[] = []
  let pos = 0

  // Handle optional 0xFF 0xFF header (total file count — skip it)
  if (data.length >= 6 && data[0] === 0xff && data[1] === 0xff) {
    pos = 6  // Skip 2-byte marker + 4-byte count
  }

  while (pos < data.length) {
    const result = parseFileListEntry(data, pos)
    if (!result) break
    entries.push(result.entry)
    pos += result.bytesConsumed
  }
  return entries
}
