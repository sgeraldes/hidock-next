/**
 * Unified Recording Types
 *
 * Discriminated union types for representing recordings across different locations:
 * - Device only (not yet downloaded)
 * - Local only (downloaded or imported, device disconnected or file not on device)
 * - Both locations (on device and downloaded)
 */

import type { QualityRating } from './knowledge'

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
  // Knowledge Capture integration
  knowledgeCaptureId?: string
  title?: string
  quality?: QualityRating
  category?: string
  status?: string
  summary?: string
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
 * Filter mode: semantic (show all matching) or exclusive (show only exact)
 */
export type FilterMode = 'semantic' | 'exclusive'

/**
 * Semantic location filter for UI (composite matching)
 * - 'on-source': Shows all files from a source (device-only + both)
 * - 'locally-available': Shows all downloaded files (local-only + both)
 * - 'synced': Shows files on both source and local (both only)
 */
export type SemanticLocationFilter = 'all' | 'on-source' | 'locally-available' | 'synced'

/**
 * Exclusive location filter for UI (exact matching)
 * - 'source-only': Shows ONLY files on source, not downloaded
 * - 'local-only': Shows ONLY files downloaded, not on source
 * - 'synced': Shows files on both source and local (both only)
 */
export type ExclusiveLocationFilter = 'all' | 'source-only' | 'local-only' | 'synced'

/**
 * Combined filter state for Library page
 */
export interface LibraryFilterState {
  mode: FilterMode
  semantic: SemanticLocationFilter
  exclusive: ExclusiveLocationFilter
}

/**
 * Helper to map semantic filters to actual location types
 * Used for composite filtering in the Library page
 */
export function matchesSemanticFilter(
  location: UnifiedRecording['location'],
  filter: SemanticLocationFilter
): boolean {
  if (filter === 'all') return true
  if (filter === 'on-source') return location === 'device-only' || location === 'both'
  if (filter === 'locally-available') return location === 'local-only' || location === 'both'
  if (filter === 'synced') return location === 'both'
  return false
}

/**
 * Helper to map exclusive filters to actual location types
 * Used for exact filtering in the Library page
 */
export function matchesExclusiveFilter(
  location: UnifiedRecording['location'],
  filter: ExclusiveLocationFilter
): boolean {
  if (filter === 'all') return true
  if (filter === 'source-only') return location === 'device-only'
  if (filter === 'local-only') return location === 'local-only'
  if (filter === 'synced') return location === 'both'
  return false
}

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
