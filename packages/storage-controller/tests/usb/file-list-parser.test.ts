import { describe, it, expect } from 'vitest'
import { parseFileListEntry, parseFileListBuffer } from '../../src/usb/file-list-parser.js'

function buildEntry(filename: string, fileLength: number, version: number = 5): Uint8Array {
  const nameBytes = new TextEncoder().encode(filename)
  const nameLen = nameBytes.length
  const signature = new Uint8Array(16).fill(0xab)
  const padding = new Uint8Array(6).fill(0)
  const entry = new Uint8Array(1 + 3 + nameLen + 4 + 6 + 16)
  let pos = 0
  entry[pos++] = version
  entry[pos++] = (nameLen >> 16) & 0xff
  entry[pos++] = (nameLen >> 8) & 0xff
  entry[pos++] = nameLen & 0xff
  entry.set(nameBytes, pos)
  pos += nameLen
  entry[pos++] = (fileLength >> 24) & 0xff
  entry[pos++] = (fileLength >> 16) & 0xff
  entry[pos++] = (fileLength >> 8) & 0xff
  entry[pos++] = fileLength & 0xff
  entry.set(padding, pos)
  pos += 6
  entry.set(signature, pos)
  return entry
}

describe('parseFileListEntry', () => {
  it('parses a single file entry', () => {
    const buffer = buildEntry('2025May13-160405-Rec59.hda', 3000, 5)
    const result = parseFileListEntry(buffer, 0)
    expect(result).not.toBeNull()
    expect(result!.entry.name).toBe('2025May13-160405-Rec59.hda')
    expect(result!.entry.length).toBe(3000)
    expect(result!.entry.version).toBe(5)
    expect(result!.entry.duration).toBe(1)
    expect(result!.entry.time).not.toBeNull()
  })

  it('returns null for truncated data', () => {
    const buffer = new Uint8Array([5, 0, 0])
    expect(parseFileListEntry(buffer, 0)).toBeNull()
  })
})

describe('parseFileListBuffer', () => {
  it('parses multiple entries from concatenated buffer', () => {
    const entry1 = buildEntry('2025May13-160405-Rec59.hda', 3000, 5)
    const entry2 = buildEntry('2025May14-090000-Rec60.hda', 6000, 5)
    const combined = new Uint8Array(entry1.length + entry2.length)
    combined.set(entry1, 0)
    combined.set(entry2, entry1.length)
    const entries = parseFileListBuffer(combined)
    expect(entries).toHaveLength(2)
    expect(entries[0].name).toBe('2025May13-160405-Rec59.hda')
    expect(entries[1].name).toBe('2025May14-090000-Rec60.hda')
  })

  it('returns empty array for empty buffer', () => {
    expect(parseFileListBuffer(new Uint8Array(0))).toHaveLength(0)
  })

  it('skips null characters in filename', () => {
    const entry = buildEntry('test\x00file.hda', 1000, 5)
    const entries = parseFileListBuffer(entry)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('testfile.hda')
  })
})
