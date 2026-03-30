import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../../src/usb/jensen-device.js', () => ({
  JensenDevice: vi.fn().mockImplementation(function () {
    return {
      isConnected: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockResolvedValue(false),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn().mockReturnValue('unknown'),
      getSerialNumber: vi.fn().mockReturnValue(null),
      getFirmwareVersion: vi.fn().mockReturnValue(null),
      getDeviceInfo: vi.fn().mockResolvedValue(null),
      getFileCount: vi.fn().mockResolvedValue(0),
      getCardInfo: vi.fn().mockResolvedValue(null),
      listFiles: vi.fn().mockResolvedValue([]),
      downloadFile: vi.fn().mockResolvedValue(null)
    }
  })
}))

import { StorageController } from '../../src/core/storage-controller.js'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'hidock-ctrl-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('StorageController', () => {
  it('returns empty list when no device and no cache', async () => {
    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: join(baseDir, 'recordings')
    })
    const recordings = await ctrl.list()
    expect(recordings).toEqual([])
  })

  it('scans local recordings when no device connected', async () => {
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(3000))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir
    })
    const recordings = await ctrl.list()
    expect(recordings).toHaveLength(1)
    expect(recordings[0].source).toBe('local')
    expect(recordings[0].filename).toBe('2025May13-160405-Rec59.wav')
  })

  it('reports deviceConnected: false in info() when disconnected', async () => {
    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: join(baseDir, 'recordings')
    })
    const info = await ctrl.info()
    expect(info.deviceConnected).toBe(false)
  })

  it('filters by date range', async () => {
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-160405-Rec59.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025Jun01-090000-Rec60.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir
    })
    const filtered = await ctrl.list({
      from: new Date(2025, 4, 13),
      to: new Date(2025, 4, 13)
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].filename).toBe('2025May13-160405-Rec59.wav')
  })

  it('search by date returns all recordings for that day', async () => {
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-090000-Rec01.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May13-160405-Rec02.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May14-120000-Rec03.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir
    })
    const results = await ctrl.search({ date: new Date(2025, 4, 13) })
    expect(results).toHaveLength(2)
  })

  it('search around finds closest recording', async () => {
    const recDir = join(baseDir, 'recordings')
    mkdirSync(recDir, { recursive: true })
    writeFileSync(join(recDir, '2025May13-090000-Rec01.wav'), Buffer.alloc(100))
    writeFileSync(join(recDir, '2025May13-160405-Rec02.wav'), Buffer.alloc(100))

    const ctrl = new StorageController({
      cacheDir: join(baseDir, 'cache'),
      recordingsDir: recDir
    })
    const results = await ctrl.search({ around: '2025-05-13T15:00:00' })
    expect(results).toHaveLength(1)
    expect(results[0].filename).toBe('2025May13-160405-Rec02.wav')
  })
})
