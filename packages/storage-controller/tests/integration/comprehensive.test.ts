/**
 * Comprehensive integration tests for @hidock/storage-controller.
 * Covers edge cases not exercised by the existing unit/integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Top-level mock for JensenDevice (required – vi.mock is always hoisted).
// Individual tests that need a "connected" device override the mock instance
// via the factory below.
// ---------------------------------------------------------------------------

// Factory state that tests can mutate
const mockDeviceState = {
  connected: false,
  serialNumber: null as string | null,
  fileCount: 0,
}

vi.mock('../../src/usb/jensen-device.js', () => ({
  JensenDevice: vi.fn().mockImplementation(function (this: any) {
    this.isConnected = vi.fn(() => mockDeviceState.connected)
    this.connect = vi.fn().mockResolvedValue(false)
    this.disconnect = vi.fn().mockResolvedValue(undefined)
    this.getModel = vi.fn().mockReturnValue('unknown')
    this.getSerialNumber = vi.fn(() => mockDeviceState.serialNumber)
    this.getFirmwareVersion = vi.fn().mockReturnValue(null)
    this.getDeviceInfo = vi.fn().mockResolvedValue(null)
    this.getFileCount = vi.fn(() => Promise.resolve(mockDeviceState.fileCount))
    this.getCardInfo = vi.fn().mockResolvedValue(null)
    this.listFiles = vi.fn().mockResolvedValue([])
    this.downloadFile = vi.fn().mockResolvedValue(null)
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFileListEntry(filename: string, fileLength: number, version = 5): Uint8Array {
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

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

// ---------------------------------------------------------------------------
// Shared tmp directory lifecycle
// ---------------------------------------------------------------------------

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'hidock-integ-'))
  // Reset device state to "disconnected" before each test
  mockDeviceState.connected = false
  mockDeviceState.serialNumber = null
  mockDeviceState.fileCount = 0
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

// ===========================================================================
// 1. StorageController – list() returns cached data when device not connected
// ===========================================================================

describe('StorageController with cache populated', () => {
  it('returns local .wav files (local scanner path) when device is not connected', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const recDir = join(baseDir, 'recordings')
    const cacheDir = join(baseDir, 'cache')
    mkdirSync(recDir, { recursive: true })
    mkdirSync(cacheDir, { recursive: true })

    writeFileSync(join(recDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(8000))

    const ctrl = new StorageController({ cacheDir, recordingsDir: recDir })
    const recordings = await ctrl.list()

    expect(recordings).toHaveLength(1)
    expect(recordings[0].filename).toBe('2025May13-160405-Rec59.wav')
    expect(recordings[0].source).toBe('local')
  })

  it('returns empty list when no device, no cache, and no local files', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: join(baseDir, 'recordings'),
    })
    expect(await ctrl.list()).toEqual([])
  })
})

// ===========================================================================
// 2. StorageController merge logic – source: 'both' when device + local match
// ===========================================================================

describe('StorageController merge logic', () => {
  it("merges device cache entry with local .wav file → source: 'both'", async () => {
    mockDeviceState.connected = true
    mockDeviceState.serialNumber = 'SN001'
    mockDeviceState.fileCount = 1  // matches cache.fileCount → uses cache

    const { StorageController } = await import('../../src/core/storage-controller.js')
    const { FileCache } = await import('../../src/cache/file-cache.js')

    const recDir = join(baseDir, 'recordings')
    const cacheDir = join(baseDir, 'cache')
    mkdirSync(recDir, { recursive: true })
    mkdirSync(cacheDir, { recursive: true })

    const cache = new FileCache(cacheDir)
    cache.save({
      deviceSerial: 'SN001',
      fileCount: 1,
      lastScanDate: new Date().toISOString(),
      recordings: [
        {
          filename: 'Rec01.hda',
          date: '2025-05-13T16:04:05.000Z',
          duration: 10,
          size: 30000,
          version: 5,
          signature: 'aabbcc',
        },
      ],
    })

    writeFileSync(join(recDir, 'Rec01.wav'), Buffer.alloc(30000))

    const ctrl = new StorageController({ cacheDir, recordingsDir: recDir })
    const recordings = await ctrl.list()

    const rec01 = recordings.find((r) => r.filename === 'Rec01.hda')
    expect(rec01).toBeDefined()
    expect(rec01!.source).toBe('both')
    expect(rec01!.localPath).toBe(join(recDir, 'Rec01.wav'))
  })
})

// ===========================================================================
// 3. StorageController search edge cases
// ===========================================================================

describe('StorageController search edge cases', () => {
  it('search around with no recordings returns empty array', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: join(baseDir, 'recordings'),
    })
    const results = await ctrl.search({ around: '2025-05-13T10:00:00' })
    expect(results).toEqual([])
  })

  it('search around with invalid date string returns empty array', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir,
    })
    const results = await ctrl.search({ around: 'not-a-date' })
    expect(results).toEqual([])
  })

  it('search with no query returns all recordings', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025Jun01-090000-Rec60.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir,
    })
    const results = await ctrl.search({})
    expect(results).toHaveLength(2)
  })
})

// ===========================================================================
// 4. File cache overwrite – latest save wins
// ===========================================================================

describe('FileCache overwrite', () => {
  it('overwrites existing cache when saved again with different data', async () => {
    const { FileCache } = await import('../../src/cache/file-cache.js')
    const cacheDir = join(baseDir, 'cache')
    mkdirSync(cacheDir, { recursive: true })
    const cache = new FileCache(cacheDir)

    cache.save({
      deviceSerial: 'dev-x',
      fileCount: 3,
      lastScanDate: '2025-01-01T00:00:00Z',
      recordings: [
        { filename: 'old.hda', date: null, duration: 5, size: 1000, version: 5, signature: '00' },
      ],
    })

    cache.save({
      deviceSerial: 'dev-x',
      fileCount: 1,
      lastScanDate: '2025-06-01T00:00:00Z',
      recordings: [
        { filename: 'new.hda', date: null, duration: 20, size: 5000, version: 5, signature: 'ff' },
      ],
    })

    const loaded = cache.load('dev-x')
    expect(loaded).not.toBeNull()
    expect(loaded!.fileCount).toBe(1)
    expect(loaded!.recordings).toHaveLength(1)
    expect(loaded!.recordings[0].filename).toBe('new.hda')
  })
})

// ===========================================================================
// 5. LocalScanner – does NOT recurse into subdirectories
// ===========================================================================

describe('LocalScanner with subdirectories', () => {
  it('only reads top-level files, ignores files in subdirectories', async () => {
    const { LocalScanner } = await import('../../src/cache/local-scanner.js')
    const scanDir = join(baseDir, 'scans')
    mkdirSync(join(scanDir, 'subdir'), { recursive: true })

    writeFileSync(join(scanDir, '2025May13-160405-Rec01.wav'), Buffer.alloc(1000))
    writeFileSync(join(scanDir, 'subdir', '2025May14-090000-Rec02.wav'), Buffer.alloc(1000))

    const scanner = new LocalScanner(scanDir)
    const files = scanner.scan()

    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('2025May13-160405-Rec01.wav')
  })

  it('a directory entry does not crash the scanner', async () => {
    const { LocalScanner } = await import('../../src/cache/local-scanner.js')
    const scanDir = join(baseDir, 'scans2')
    mkdirSync(join(scanDir, 'nested'), { recursive: true })
    // Only a subdirectory exists; no top-level wav files
    const scanner = new LocalScanner(scanDir)
    expect(scanner.scan()).toEqual([])
  })
})

// ===========================================================================
// 6. Filename parser edge cases
// ===========================================================================

describe('parseFilenameDateTime edge cases', () => {
  it('returns null date for empty string', async () => {
    const { parseFilenameDateTime } = await import('../../src/core/filename-parser.js')
    const result = parseFilenameDateTime('')
    expect(result.date).toBeNull()
    expect(result.createDate).toBe('')
    expect(result.createTime).toBe('')
  })

  it('returns null date for very long filename with no date pattern', async () => {
    const { parseFilenameDateTime } = await import('../../src/core/filename-parser.js')
    const longName = 'a'.repeat(500) + '.hda'
    const result = parseFilenameDateTime(longName)
    expect(result.date).toBeNull()
  })

  it('returns null date for filename with special characters and no date', async () => {
    const { parseFilenameDateTime } = await import('../../src/core/filename-parser.js')
    const result = parseFilenameDateTime('recording!@#$%^&*().wav')
    expect(result.date).toBeNull()
  })

  it('parses correctly when filename has extra text after date portion', async () => {
    const { parseFilenameDateTime } = await import('../../src/core/filename-parser.js')
    const result = parseFilenameDateTime('2025May13-160405-SomeExtraTextHere-Rec59.hda')
    expect(result.date).not.toBeNull()
    expect(result.date!.getFullYear()).toBe(2025)
    expect(result.date!.getMonth()).toBe(4) // May = index 4
  })

  it('returns null date for filename with short number sequence not matching any format', async () => {
    const { parseFilenameDateTime } = await import('../../src/core/filename-parser.js')
    const result = parseFilenameDateTime('audio123456.wav')
    expect(result.date).toBeNull()
  })
})

// ===========================================================================
// 7. File list parser – 100 entries
// ===========================================================================

describe('parseFileListBuffer with large entry count', () => {
  it('parses 100 consecutive entries correctly', async () => {
    const { parseFileListBuffer } = await import('../../src/usb/file-list-parser.js')

    const entryBuffers: Uint8Array[] = []
    for (let i = 0; i < 100; i++) {
      const day = String((i % 28) + 1).padStart(2, '0')
      const timeStr = String(i).padStart(6, '0')
      const recNum = String(i).padStart(3, '0')
      const filename = `2025May${day}-${timeStr}-Rec${recNum}.hda`
      entryBuffers.push(buildFileListEntry(filename, 3000 + i, 5))
    }

    const combined = concatUint8Arrays(...entryBuffers)
    const entries = parseFileListBuffer(combined)

    expect(entries).toHaveLength(100)
    expect(entries[0].name).toContain('Rec000')
    expect(entries[99].name).toContain('Rec099')
  })
})

// ===========================================================================
// 8. JensenMessage with large body (~64 KB)
// ===========================================================================

describe('JensenMessage with large body', () => {
  it('correctly encodes a 64 KB body length in the header', async () => {
    const { JensenMessage } = await import('../../src/usb/jensen-message.js')

    const bodySize = 65536 // 64 KiB
    const largeBody = new Array(bodySize).fill(0xaa)
    const msg = new JensenMessage(0x0a).body(largeBody).sequence(1)
    const bytes = msg.make()

    expect(bytes.byteLength).toBe(12 + bodySize)

    // Body length field (bytes 8–11) must be 0x00010000 = 65536
    expect(bytes[8]).toBe(0x00)
    expect(bytes[9]).toBe(0x01)
    expect(bytes[10]).toBe(0x00)
    expect(bytes[11]).toBe(0x00)

    expect(bytes[12]).toBe(0xaa)
    expect(bytes[12 + bodySize - 1]).toBe(0xaa)
  })

  it('parseResponseHeader correctly decodes a 64 KB body length', async () => {
    const { JensenMessage, parseResponseHeader } = await import('../../src/usb/jensen-message.js')

    const bodySize = 65536
    const largeBody = new Array(bodySize).fill(0x55)
    const msg = new JensenMessage(0x0b).body(largeBody).sequence(42)
    const packet = msg.make()

    const header = parseResponseHeader(packet.subarray(0, 12))
    expect(header).not.toBeNull()
    expect(header!.command).toBe(0x0b)
    expect(header!.sequence).toBe(42)
    expect(header!.bodyLength).toBe(bodySize)
  })
})

// ===========================================================================
// 9. Cache + local stem matching: Rec01.hda on device, Rec01.wav locally
// ===========================================================================

describe('Stem matching: .hda on device, .wav locally', () => {
  it("produces source: 'both' when device has Rec01.hda and local has Rec01.wav", async () => {
    mockDeviceState.connected = true
    mockDeviceState.serialNumber = 'SN002'
    mockDeviceState.fileCount = 1  // matches cache → uses cache

    const { StorageController } = await import('../../src/core/storage-controller.js')
    const { FileCache } = await import('../../src/cache/file-cache.js')

    const recDir = join(baseDir, 'recordings2')
    const cacheDir = join(baseDir, 'cache2')
    mkdirSync(recDir, { recursive: true })
    mkdirSync(cacheDir, { recursive: true })

    const cache = new FileCache(cacheDir)
    cache.save({
      deviceSerial: 'SN002',
      fileCount: 1,
      lastScanDate: new Date().toISOString(),
      recordings: [
        {
          filename: 'Rec01.hda',
          date: '2025-05-20T10:00:00.000Z',
          duration: 30,
          size: 90000,
          version: 5,
          signature: 'deadbeef',
        },
      ],
    })

    writeFileSync(join(recDir, 'Rec01.wav'), Buffer.alloc(90000))

    const ctrl = new StorageController({ cacheDir, recordingsDir: recDir })
    const recordings = await ctrl.list()

    const rec = recordings.find((r) => r.filename === 'Rec01.hda')
    expect(rec).toBeDefined()
    expect(rec!.source).toBe('both')
    expect(rec!.localPath).toBeDefined()
    expect(rec!.localPath).toContain('Rec01.wav')
  })
})

// ===========================================================================
// 10. Date range filtering edge cases
// ===========================================================================

describe('Date range filtering edge cases', () => {
  it('from == to (same day) returns only recordings from that day', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-090000-Rec01.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May14-090000-Rec02.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May15-090000-Rec03.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir,
    })
    const results = await ctrl.list({
      from: new Date(2025, 4, 14),
      to: new Date(2025, 4, 14),
    })
    expect(results).toHaveLength(1)
    expect(results[0].filename).toBe('2025May14-090000-Rec02.wav')
  })

  it('from > to returns empty (impossible date range excludes all recordings)', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-090000-Rec01.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May14-090000-Rec02.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir,
    })
    // from is later than to → no recording can satisfy both conditions
    const results = await ctrl.list({
      from: new Date(2025, 4, 20),
      to: new Date(2025, 4, 10),
    })
    expect(results).toHaveLength(0)
  })

  it('recordings with null dates are excluded when a date range filter is applied', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    // filename without a parseable date → null date
    writeFileSync(join(recDir, 'nodate-recording.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May13-090000-Rec01.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir,
    })
    const results = await ctrl.list({
      from: new Date(2025, 4, 13),
      to: new Date(2025, 4, 13),
    })
    expect(results).toHaveLength(1)
    expect(results[0].filename).toBe('2025May13-090000-Rec01.wav')
  })

  it('list() with no filters includes recordings with null dates', async () => {
    const { StorageController } = await import('../../src/core/storage-controller.js')
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, 'nodate-recording.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May13-090000-Rec01.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir,
    })
    const results = await ctrl.list()
    expect(results).toHaveLength(2)
  })
})
