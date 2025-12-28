import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getHiDockDeviceService, HiDockRecording } from '@/services/hidock-device'
import { useAppStore } from '@/store/useAppStore'
import {
  UnifiedRecording,
  DeviceOnlyRecording,
  LocalOnlyRecording,
  BothLocationsRecording,
  LocationFilter,
  TranscriptSummary
} from '@/types/unified-recording'

interface DatabaseRecording {
  id: string
  filename: string
  file_path: string
  file_size: number
  duration_seconds?: number
  date_recorded?: string
  meeting_id?: string
  status: string
}

interface SyncedFile {
  id: string
  original_filename: string
  local_filename: string
  file_path: string
  file_size?: number
  synced_at: string
}

interface CachedDeviceFile {
  id: string
  filename: string
  file_size?: number  // Database column name
  size?: number       // Alternative field name (for compatibility)
  duration_seconds?: number
  date_recorded: string
  cached_at: string
}

// Parse date from HiDock filename formats
function parseDateFromFilename(filename: string): Date | null {
  const monthNames: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  }

  // Format 1: 2025May13-160405-Rec59.hda (YYYYMonDD-HHMMSS)
  const monthNameMatch = filename.match(/(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})-(\d{2})(\d{2})(\d{2})/)
  if (monthNameMatch) {
    const [, year, monthName, day, hour, minute, second] = monthNameMatch
    const month = monthNames[monthName]
    return new Date(parseInt(year), month, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
  }

  // Format 2: HDA_YYYYMMDD_HHMMSS.hda or 2025-12-08_0044.hda or 2025-12-08_004400.hda
  const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})(\d{2})(\d{2})?/)
  if (numericMatch) {
    const [, year, month, day, hour, minute, second = '00'] = numericMatch
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second))
  }

  return null
}

// Get the best date for a recording - parse from filename first (most reliable), then fallback
function getBestDate(filename: string, deviceDate: Date | null | undefined, fallback: Date): Date {
  // Always try to parse from filename first - HiDock filenames contain accurate timestamps
  const parsed = parseDateFromFilename(filename)
  if (parsed && !isNaN(parsed.getTime())) {
    // Note: HiDock filenames appear to be in LOCAL time, not UTC
    return parsed
  }

  // Then use device-provided date if valid
  if (deviceDate && !isNaN(deviceDate.getTime())) {
    return deviceDate
  }

  return fallback
}

// Build unified recordings from multiple sources
function buildRecordingMap(
  deviceRecs: HiDockRecording[],
  dbRecs: DatabaseRecording[],
  syncedFiles: SyncedFile[],
  cachedDeviceFiles: CachedDeviceFile[],
  isConnected: boolean
): UnifiedRecording[] {
  // Create lookup maps
  const syncedMap = new Map<string, SyncedFile>()
  for (const sf of syncedFiles) {
    syncedMap.set(sf.original_filename, sf)
  }

  const dbMap = new Map<string, DatabaseRecording>()
  for (const dbRec of dbRecs) {
    dbMap.set(dbRec.filename, dbRec)
  }

  const recordingMap = new Map<string, UnifiedRecording>()

  // Process device recordings first
  for (const deviceRec of deviceRecs) {
    const synced = syncedMap.get(deviceRec.filename)
    const dbRec = dbMap.get(deviceRec.filename)
    const dateRecorded = getBestDate(deviceRec.filename, deviceRec.dateCreated, new Date())

    if (synced || dbRec) {
      const recording: BothLocationsRecording = {
        id: dbRec?.id || synced!.id,
        filename: deviceRec.filename,
        size: deviceRec.size,
        duration: deviceRec.duration,
        dateRecorded,
        transcriptionStatus: mapTranscriptionStatus(dbRec?.status),
        meetingId: dbRec?.meeting_id,
        location: 'both',
        deviceFilename: deviceRec.filename,
        localPath: synced?.file_path || dbRec?.file_path || '',
        syncStatus: 'synced'
      }
      recordingMap.set(deviceRec.filename, recording)
    } else {
      const recording: DeviceOnlyRecording = {
        id: deviceRec.id,
        filename: deviceRec.filename,
        size: deviceRec.size,
        duration: deviceRec.duration,
        dateRecorded,
        transcriptionStatus: 'none',
        location: 'device-only',
        deviceFilename: deviceRec.filename,
        syncStatus: 'not-synced'
      }
      recordingMap.set(deviceRec.filename, recording)
    }
  }

  // Process database recordings not from device
  for (const dbRec of dbRecs) {
    if (!recordingMap.has(dbRec.filename)) {
      const synced = syncedMap.get(dbRec.filename)
      const dbDate = dbRec.date_recorded ? new Date(dbRec.date_recorded) : null
      const dateRecorded = getBestDate(dbRec.filename, dbDate, new Date())
      const recording: LocalOnlyRecording = {
        id: dbRec.id,
        filename: dbRec.filename,
        size: dbRec.file_size,
        duration: dbRec.duration_seconds || 0,
        dateRecorded,
        transcriptionStatus: mapTranscriptionStatus(dbRec.status),
        meetingId: dbRec.meeting_id,
        location: 'local-only',
        localPath: dbRec.file_path,
        syncStatus: 'synced',
        isImported: !synced
      }
      recordingMap.set(dbRec.filename, recording)
    }
  }

  // Process cached device files (for offline or while waiting for fresh data)
  const shouldUseCachedFiles = cachedDeviceFiles.length > 0 && (
    !isConnected || (isConnected && deviceRecs.length === 0)
  )

  if (shouldUseCachedFiles) {
    for (const cached of cachedDeviceFiles) {
      if (!recordingMap.has(cached.filename)) {
        const cachedDate = new Date(cached.date_recorded)
        const dateRecorded = getBestDate(cached.filename, cachedDate, cachedDate)
        const recording: DeviceOnlyRecording = {
          id: cached.id,
          filename: cached.filename,
          size: cached.file_size ?? cached.size ?? 0,
          duration: cached.duration_seconds || 0,
          dateRecorded,
          transcriptionStatus: 'none',
          location: 'device-only',
          deviceFilename: cached.filename,
          syncStatus: 'not-synced'
        }
        recordingMap.set(cached.filename, recording)
      }
    }
  }

  // Sort by date (newest first)
  return Array.from(recordingMap.values()).sort(
    (a, b) => b.dateRecorded.getTime() - a.dateRecorded.getTime()
  )
}

interface UseUnifiedRecordingsResult {
  recordings: UnifiedRecording[]
  loading: boolean
  error: string | null
  refresh: (forceDeviceRefresh?: boolean) => Promise<void>
  deviceConnected: boolean
  stats: {
    total: number
    deviceOnly: number
    localOnly: number
    both: number
    synced: number
    unsynced: number
  }
}

/**
 * Hook that provides a unified view of all recordings across device and local storage.
 *
 * Merges:
 * - Device recordings (from HiDock device if connected)
 * - Database recordings (downloaded/imported files)
 * - Synced files tracking (maps device filenames to local files)
 *
 * Returns discriminated union types for type-safe handling of different recording locations.
 *
 * NOTE: Recordings are stored in the Zustand store to persist across page navigation.
 */
export function useUnifiedRecordings(): UseUnifiedRecordingsResult {
  // Get state from store (persists across navigation)
  const recordings = useAppStore((state) => state.unifiedRecordings) as UnifiedRecording[]
  const loading = useAppStore((state) => state.unifiedRecordingsLoading)
  const error = useAppStore((state) => state.unifiedRecordingsError)
  const loaded = useAppStore((state) => state.unifiedRecordingsLoaded)
  const setRecordings = useAppStore((state) => state.setUnifiedRecordings)
  const setLoading = useAppStore((state) => state.setUnifiedRecordingsLoading)
  const setError = useAppStore((state) => state.setUnifiedRecordingsError)
  const markLoaded = useAppStore((state) => state.markUnifiedRecordingsLoaded)

  const [deviceConnected, setDeviceConnected] = useState(false)
  const loadingRef = useRef(false) // Prevent concurrent loads

  const deviceService = getHiDockDeviceService()

  const loadRecordings = useCallback(async (forceRefresh: boolean = false) => {
    // Prevent concurrent loads
    if (loadingRef.current) return
    loadingRef.current = true

    // If not forcing and already loaded, skip (except for device connection changes)
    // This is handled by the caller - forceRefresh=true bypasses cached data

    setLoading(true)
    setError(null)

    try {
      // Check device connection
      const isConnected = deviceService.isConnected()
      setDeviceConnected(isConnected)

      // PHASE 1: Load local data + cache FIRST (fast) for instant display
      const [dbRecs, syncedFiles, cachedDeviceFiles] = await Promise.all([
        window.electronAPI.recordings.getAll() as Promise<DatabaseRecording[]>,
        window.electronAPI.syncedFiles.getAll() as Promise<SyncedFile[]>,
        window.electronAPI.deviceCache.getAll() as Promise<CachedDeviceFile[]>
      ])

      // Check if device service has in-memory cached recordings (from a recent fetch)
      // This is faster than the database cache and more up-to-date
      const memoryCachedDeviceRecs = isConnected ? deviceService.getCachedRecordings() : []

      // Show cached/local data immediately and mark as loaded
      // If we have in-memory cache from device service, use that for immediate display
      // This fixes the issue where navigating to Library shows stale data
      const initialRecordings = buildRecordingMap(memoryCachedDeviceRecs, dbRecs, syncedFiles, cachedDeviceFiles, isConnected)
      setRecordings(initialRecordings)
      setLoading(false) // Mark as loaded after showing cached data
      markLoaded() // Mark as loaded in store

      // PHASE 2: Fetch device recordings (slow) - this updates the view when complete
      // Only needed if we don't have memory cache or forceRefresh is true
      let deviceRecs: HiDockRecording[] = memoryCachedDeviceRecs
      if (isConnected && (memoryCachedDeviceRecs.length === 0 || forceRefresh)) {
        try {
          deviceRecs = await deviceService.listRecordings(undefined, forceRefresh)
        } catch (deviceError) {
          console.warn('[useUnifiedRecordings] Failed to get device recordings:', deviceError)
          // Continue with cached data
        }
      }

      // If device is connected, update the cache with current device files
      if (isConnected && deviceRecs.length > 0) {
        const cacheEntries = deviceRecs.map(rec => ({
          id: rec.id,
          filename: rec.filename,
          size: rec.size,
          duration_seconds: rec.duration,
          date_recorded: rec.dateCreated?.toISOString() || new Date().toISOString(),
          cached_at: new Date().toISOString()
        }))
        try {
          await window.electronAPI.deviceCache.saveAll(cacheEntries)
        } catch (cacheError) {
          console.warn('[useUnifiedRecordings] Failed to save device cache:', cacheError)
        }
      }

      // PHASE 3: Build final recording list with all data (silent update)
      const finalRecordings = buildRecordingMap(deviceRecs, dbRecs, syncedFiles, cachedDeviceFiles, isConnected)
      setRecordings(finalRecordings)
    } catch (e) {
      console.error('[useUnifiedRecordings] Error loading recordings:', e)
      setError(e instanceof Error ? e.message : 'Failed to load recordings')
      setLoading(false)
    } finally {
      loadingRef.current = false
    }
  }, [deviceService, setRecordings, setLoading, setError, markLoaded])

  // Initial load (only if not already loaded) and device connection subscription
  useEffect(() => {
    // Only load if not already loaded or if device connection changed
    if (!loaded) {
      loadRecordings()
    }

    // Check device connection on mount
    setDeviceConnected(deviceService.isConnected())

    // Subscribe to device connection changes
    const unsubscribe = deviceService.onConnectionChange((connected) => {
      setDeviceConnected(connected)
      // Reload when connection status changes (device data may have changed)
      loadRecordings()
    })

    return unsubscribe
  }, [loaded, loadRecordings, deviceService])

  // Memoize stats calculation - only recalculate when recordings change
  const stats = useMemo(() => {
    let deviceOnly = 0
    let localOnly = 0
    let both = 0
    let synced = 0
    let unsynced = 0

    // Single pass through recordings for efficiency
    for (const r of recordings) {
      if (r.location === 'device-only') deviceOnly++
      else if (r.location === 'local-only') localOnly++
      else if (r.location === 'both') both++

      if (r.syncStatus === 'synced') synced++
      else unsynced++
    }

    return {
      total: recordings.length,
      deviceOnly,
      localOnly,
      both,
      synced,
      unsynced
    }
  }, [recordings])

  return {
    recordings,
    loading,
    error,
    refresh: loadRecordings,
    deviceConnected,
    stats
  }
}

/**
 * Map database status to transcription status
 */
function mapTranscriptionStatus(status?: string): UnifiedRecording['transcriptionStatus'] {
  switch (status) {
    case 'transcribed':
    case 'complete':
      return 'complete'
    case 'transcribing':
    case 'processing':
      return 'processing'
    case 'pending':
    case 'queued':
      return 'pending'
    case 'error':
    case 'failed':
      return 'error'
    default:
      return 'none'
  }
}
