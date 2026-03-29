import { join } from 'node:path'
import { homedir } from 'node:os'
import { writeFileSync, mkdirSync } from 'node:fs'
import { JensenDevice } from '../usb/jensen-device.js'
import { FileCache } from '../cache/file-cache.js'
import { LocalScanner } from '../cache/local-scanner.js'
import type {
  Recording, StorageInfo, DeviceStatus,
  CacheData, CachedRecording, FileEntry
} from './types.js'

export interface StorageControllerOptions {
  cacheDir?: string
  recordingsDir?: string
}

const DEFAULT_HIDOCK_DIR = join(homedir(), '.hidock')

export class StorageController {
  private device: JensenDevice
  private cache: FileCache
  private localScanner: LocalScanner
  private recordingsDir: string

  constructor(options: StorageControllerOptions = {}) {
    const cacheDir = options.cacheDir ?? join(DEFAULT_HIDOCK_DIR, 'cache')
    this.recordingsDir = options.recordingsDir ?? join(DEFAULT_HIDOCK_DIR, 'recordings')
    this.device = new JensenDevice()
    this.cache = new FileCache(cacheDir)
    this.localScanner = new LocalScanner(this.recordingsDir)
  }

  async connect(): Promise<boolean> {
    const success = await this.device.connect()
    if (success) await this.device.getDeviceInfo()
    return success
  }

  async disconnect(): Promise<void> {
    await this.device.disconnect()
  }

  isConnected(): boolean {
    return this.device.isConnected()
  }

  async list(filters?: { from?: Date; to?: Date }): Promise<Recording[]> {
    let recordings: Recording[]
    if (this.device.isConnected()) {
      recordings = await this.listFromDevice()
    } else {
      recordings = this.listFromCacheAndLocal()
    }
    if (filters?.from || filters?.to) {
      recordings = this.filterByDateRange(recordings, filters.from, filters.to)
    }
    return recordings.sort((a, b) => {
      const aTime = a.date?.getTime() ?? 0
      const bTime = b.date?.getTime() ?? 0
      return bTime - aTime
    })
  }

  async get(filename: string): Promise<Recording | null> {
    const all = await this.list()
    return all.find((r) => r.filename === filename || this.stemMatch(r.filename, filename)) ?? null
  }

  async search(query: { date?: Date; around?: string }): Promise<Recording[]> {
    const all = await this.list()
    if (query.date) {
      const targetDay = this.dayStart(query.date)
      const nextDay = new Date(targetDay.getTime() + 86400000)
      return all.filter((r) => {
        if (!r.date) return false
        return r.date >= targetDay && r.date < nextDay
      })
    }
    if (query.around) {
      const target = new Date(query.around)
      if (isNaN(target.getTime())) return []
      const withDates = all.filter((r) => r.date !== null)
      if (withDates.length === 0) return []
      let closest = withDates[0]
      let closestDiff = Math.abs(closest.date!.getTime() - target.getTime())
      for (const r of withDates) {
        const diff = Math.abs(r.date!.getTime() - target.getTime())
        if (diff < closestDiff) {
          closest = r
          closestDiff = diff
        }
      }
      return [closest]
    }
    return all
  }

  async info(): Promise<StorageInfo> {
    if (!this.device.isConnected()) {
      return { totalMiB: 0, usedMiB: 0, freeMiB: 0, fileCount: 0, deviceConnected: false }
    }
    const cardInfo = await this.device.getCardInfo()
    const fileCount = await this.device.getFileCount()
    return {
      totalMiB: cardInfo?.capacity ?? 0,
      usedMiB: cardInfo?.used ?? 0,
      freeMiB: cardInfo?.free ?? 0,
      fileCount,
      deviceConnected: true
    }
  }

  async status(): Promise<DeviceStatus> {
    return {
      connected: this.device.isConnected(),
      model: this.device.getModel(),
      serialNumber: this.device.getSerialNumber(),
      firmwareVersion: this.device.getFirmwareVersion()
    }
  }

  async download(filename: string, outputDir?: string): Promise<string> {
    const targetDir = outputDir ?? this.recordingsDir
    mkdirSync(targetDir, { recursive: true })
    const all = await this.list()
    const recording = all.find((r) => r.filename === filename || this.stemMatch(r.filename, filename))
    if (!recording) throw new Error(`Recording not found: ${filename}`)
    if (recording.localPath) return recording.localPath
    if (!this.device.isConnected()) throw new Error('Device not connected and file not available locally')
    const data = await this.device.downloadFile(recording.filename, recording.size)
    if (!data) throw new Error(`Download failed: ${filename}`)
    const stem = recording.filename.replace(/\.[^.]+$/, '')
    const outputPath = join(targetDir, `${stem}.wav`)
    writeFileSync(outputPath, data)
    return outputPath
  }

  async downloadAll(
    outputDir?: string,
    onProgress?: (n: number, total: number) => void
  ): Promise<string[]> {
    const recordings = await this.list()
    const paths: string[] = []
    for (let i = 0; i < recordings.length; i++) {
      onProgress?.(i, recordings.length)
      const path = await this.download(recordings[i].filename, outputDir)
      paths.push(path)
    }
    onProgress?.(recordings.length, recordings.length)
    return paths
  }

  async refresh(): Promise<void> {
    if (!this.device.isConnected()) throw new Error('Cannot refresh: device not connected')
    const serial = this.device.getSerialNumber()
    if (serial) this.cache.clear(serial)
    await this.listFromDevice()
  }

  private async listFromDevice(): Promise<Recording[]> {
    const serial = this.device.getSerialNumber() ?? 'unknown'
    const cached = this.cache.load(serial)
    const currentCount = await this.device.getFileCount()
    if (cached && cached.fileCount === currentCount && currentCount > 0) {
      const deviceRecordings = cached.recordings.map((r) => this.cachedToRecording(r, 'device'))
      return this.mergeWithLocal(deviceRecordings)
    }
    const entries = await this.device.listFiles()
    const recordings = entries.map((e) => this.entryToRecording(e))
    // Only cache if we actually got recordings — never cache empty results
    if (recordings.length > 0) {
      const cacheData: CacheData = {
        deviceSerial: serial,
        fileCount: currentCount,
        lastScanDate: new Date().toISOString(),
        recordings: recordings.map((r) => this.recordingToCached(r))
      }
      this.cache.save(cacheData)
    }
    return this.mergeWithLocal(recordings)
  }

  private listFromCacheAndLocal(): Recording[] {
    return this.localScanner.scan()
  }

  private mergeWithLocal(deviceRecordings: Recording[]): Recording[] {
    const localFiles = this.localScanner.scan()
    const localByFileStem = new Map<string, Recording>()
    for (const local of localFiles) {
      localByFileStem.set(this.fileStem(local.filename), local)
    }
    const merged: Recording[] = []
    const matchedStems = new Set<string>()
    for (const rec of deviceRecordings) {
      const stem = this.fileStem(rec.filename)
      const local = localByFileStem.get(stem)
      if (local) {
        merged.push({ ...rec, source: 'both', localPath: local.localPath })
        matchedStems.add(stem)
      } else {
        merged.push({ ...rec, source: 'device' })
      }
    }
    for (const local of localFiles) {
      if (!matchedStems.has(this.fileStem(local.filename))) {
        merged.push(local)
      }
    }
    return merged
  }

  private filterByDateRange(recordings: Recording[], from?: Date, to?: Date): Recording[] {
    return recordings.filter((r) => {
      if (!r.date) return false
      if (from && r.date < this.dayStart(from)) return false
      if (to && r.date >= new Date(this.dayStart(to).getTime() + 86400000)) return false
      return true
    })
  }

  private fileStem(filename: string): string {
    return filename.replace(/\.[^.]+$/, '')
  }

  private stemMatch(a: string, b: string): boolean {
    return this.fileStem(a) === this.fileStem(b)
  }

  private dayStart(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  private entryToRecording(entry: FileEntry): Recording {
    return {
      filename: entry.name, date: entry.time, duration: entry.duration,
      size: entry.length, source: 'device', version: entry.version, signature: entry.signature
    }
  }

  private cachedToRecording(cached: CachedRecording, source: 'device' | 'local' | 'both'): Recording {
    return {
      filename: cached.filename, date: cached.date ? new Date(cached.date) : null,
      duration: cached.duration, size: cached.size, source,
      version: cached.version, signature: cached.signature
    }
  }

  private recordingToCached(recording: Recording): CachedRecording {
    return {
      filename: recording.filename, date: recording.date?.toISOString() ?? null,
      duration: recording.duration, size: recording.size,
      version: recording.version, signature: recording.signature
    }
  }
}
