// Core
export { StorageController } from './core/storage-controller.js'
export type { StorageControllerOptions } from './core/storage-controller.js'
export type {
  Recording,
  StorageInfo,
  DeviceStatus,
  DeviceModel,
  FileEntry,
  CardInfo,
  CacheData,
  CachedRecording,
  RawDeviceInfo
} from './core/types.js'

// Utilities (for advanced consumers)
export { parseFilenameDateTime, calculateDurationSeconds } from './core/filename-parser.js'
export { FileCache } from './cache/file-cache.js'
export { LocalScanner } from './cache/local-scanner.js'
