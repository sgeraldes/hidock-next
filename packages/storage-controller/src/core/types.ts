export interface Recording {
  /** Original filename on device, e.g. "2025May13-160405-Rec59.hda" */
  filename: string
  /** Parsed date/time from filename */
  date: Date | null
  /** Duration in seconds, calculated from file size and version */
  duration: number
  /** File size in bytes */
  size: number
  /** Where the file currently exists */
  source: 'device' | 'local' | 'both'
  /** Absolute path if file exists locally */
  localPath?: string
  /** Firmware version byte from file entry */
  version: number
  /** 16-byte hex signature from file entry */
  signature: string
}

export interface StorageInfo {
  totalMiB: number
  usedMiB: number
  freeMiB: number
  fileCount: number
  deviceConnected: boolean
}

export interface DeviceStatus {
  connected: boolean
  model: DeviceModel
  serialNumber: string | null
  firmwareVersion: string | null
}

export type DeviceModel = 'hidock-h1' | 'hidock-h1e' | 'hidock-p1' | 'hidock-p1-mini' | 'unknown'

/** Raw file entry parsed from USB binary data */
export interface FileEntry {
  name: string
  createDate: string
  createTime: string
  time: Date | null
  duration: number
  version: number
  length: number
  signature: string
}

/** Raw card info from device (values in MiB) */
export interface CardInfo {
  used: number
  capacity: number
  free: number
  status: string
}

/** Raw device info from device */
export interface RawDeviceInfo {
  versionCode: string
  versionNumber: number
  serialNumber: string
  model: DeviceModel
}

/** Cache file structure written to disk */
export interface CacheData {
  deviceSerial: string
  fileCount: number
  lastScanDate: string
  recordings: CachedRecording[]
}

/** Recording as stored in cache JSON (dates as ISO strings) */
export interface CachedRecording {
  filename: string
  date: string | null
  duration: number
  size: number
  version: number
  signature: string
}
