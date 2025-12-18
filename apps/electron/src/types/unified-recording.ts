/**
 * Unified Recording Types
 *
 * Discriminated union types for representing recordings across different locations:
 * - Device only (not yet downloaded)
 * - Local only (downloaded or imported, device disconnected or file not on device)
 * - Both locations (on device and downloaded)
 */

// Transcript summary for display purposes
export interface TranscriptSummary {
  id: string
  summary?: string
  actionItems?: string[]
  keyPoints?: string[]
}

// Base fields common to all recording types
interface RecordingBase {
  id: string
  filename: string
  size: number
  duration: number
  dateRecorded: Date
  transcriptionStatus: 'none' | 'pending' | 'processing' | 'complete' | 'error'
  meetingId?: string
  meetingSubject?: string
  transcript?: TranscriptSummary
}

/**
 * Recording that exists only on the HiDock device (not yet downloaded)
 */
export interface DeviceOnlyRecording extends RecordingBase {
  location: 'device-only'
  deviceFilename: string
  syncStatus: 'not-synced' | 'syncing'
}

/**
 * Recording that exists only locally (downloaded, imported, or device disconnected)
 */
export interface LocalOnlyRecording extends RecordingBase {
  location: 'local-only'
  localPath: string
  syncStatus: 'synced'
  /** True if this recording was imported from external file (not from device) */
  isImported?: boolean
}

/**
 * Recording that exists both on device and locally
 */
export interface BothLocationsRecording extends RecordingBase {
  location: 'both'
  deviceFilename: string
  localPath: string
  syncStatus: 'synced'
}

/**
 * Discriminated union of all recording location types.
 * Use `recording.location` to narrow the type.
 *
 * @example
 * ```ts
 * function getPath(rec: UnifiedRecording): string | null {
 *   switch (rec.location) {
 *     case 'device-only':
 *       return null // Can't play device-only recordings
 *     case 'local-only':
 *     case 'both':
 *       return rec.localPath
 *   }
 * }
 * ```
 */
export type UnifiedRecording = DeviceOnlyRecording | LocalOnlyRecording | BothLocationsRecording

/**
 * Sync status values for filtering
 */
export type SyncStatus = 'not-synced' | 'syncing' | 'synced'

/**
 * Location filter values for the UI
 */
export type LocationFilter = 'all' | 'device-only' | 'local-only' | 'both'

/**
 * Helper type guard functions
 */
export function isDeviceOnly(rec: UnifiedRecording): rec is DeviceOnlyRecording {
  return rec.location === 'device-only'
}

export function isLocalOnly(rec: UnifiedRecording): rec is LocalOnlyRecording {
  return rec.location === 'local-only'
}

export function isBothLocations(rec: UnifiedRecording): rec is BothLocationsRecording {
  return rec.location === 'both'
}

export function hasLocalPath(rec: UnifiedRecording): rec is LocalOnlyRecording | BothLocationsRecording {
  return rec.location === 'local-only' || rec.location === 'both'
}

export function hasDeviceFile(rec: UnifiedRecording): rec is DeviceOnlyRecording | BothLocationsRecording {
  return rec.location === 'device-only' || rec.location === 'both'
}
