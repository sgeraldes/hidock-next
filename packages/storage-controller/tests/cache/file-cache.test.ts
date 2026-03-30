import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileCache } from '../../src/cache/file-cache.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let cacheDir: string
let cache: FileCache

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'hidock-test-'))
  cache = new FileCache(cacheDir)
})

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('FileCache', () => {
  it('returns null for nonexistent cache', () => {
    expect(cache.load('device123')).toBeNull()
  })

  it('saves and loads cache data', () => {
    const data = {
      deviceSerial: 'device123',
      fileCount: 2,
      lastScanDate: new Date().toISOString(),
      recordings: [
        { filename: 'test.hda', date: '2025-05-13T16:00:00', duration: 60, size: 8000, version: 5, signature: 'abc' }
      ]
    }
    cache.save(data)
    const loaded = cache.load('device123')
    expect(loaded).not.toBeNull()
    expect(loaded!.fileCount).toBe(2)
    expect(loaded!.recordings).toHaveLength(1)
    expect(loaded!.recordings[0].filename).toBe('test.hda')
  })

  it('separates cache by device serial', () => {
    cache.save({ deviceSerial: 'dev-a', fileCount: 1, lastScanDate: '', recordings: [] })
    cache.save({ deviceSerial: 'dev-b', fileCount: 2, lastScanDate: '', recordings: [] })
    expect(cache.load('dev-a')!.fileCount).toBe(1)
    expect(cache.load('dev-b')!.fileCount).toBe(2)
  })

  it('clears cache for a specific device', () => {
    cache.save({ deviceSerial: 'dev-a', fileCount: 1, lastScanDate: '', recordings: [] })
    cache.clear('dev-a')
    expect(cache.load('dev-a')).toBeNull()
  })

  it('clears all caches', () => {
    cache.save({ deviceSerial: 'dev-a', fileCount: 1, lastScanDate: '', recordings: [] })
    cache.save({ deviceSerial: 'dev-b', fileCount: 2, lastScanDate: '', recordings: [] })
    cache.clearAll()
    expect(cache.load('dev-a')).toBeNull()
    expect(cache.load('dev-b')).toBeNull()
  })

  it('handles corrupted cache file gracefully', () => {
    writeFileSync(join(cacheDir, 'file-list-corrupt.json'), '{{{invalid json}}}')
    expect(cache.load('corrupt')).toBeNull()
  })
})
