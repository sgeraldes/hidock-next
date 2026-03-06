import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getHiDockDeviceService, HiDockRecording } from '@/services/hidock-device'
import { useAppStore } from '@/store/useAppStore'
import {
  UnifiedRecording,
  DeviceOnlyRecording,
  LocalOnlyRecording,
  BothLocationsRecording
} from '@/types/unified-recording'
import type { KnowledgeCapture } from '@/types/knowledge'

interface DatabaseRecording {
  id: string
  filename: string
  file_path: string
  file_size: number
  duration_seconds?: number
  date_recorded?: string
  meeting_id?: string
  // FL-001: transcription_status is the authoritative column; status is the legacy fallback
  transcription_status?: string
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

// Get base filename without extension (for matching .hda and .wav files)
function getBaseFilename(filename: string): string {
  // Remove common audio extensions
  return filename.replace(/\.(hda|wav|mp3|m4a|aac|ogg|flac)$/i, '')
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

/**
 * Try to match a device recording with a local recording by date/time proximity
 * Used as fallback when filename matching fails (for wrongly-named downloads)
 */
function findMatchByDateTime(
  deviceRec: HiDockRecording,
  dbRecs: DatabaseRecording[],
  syncedFiles: SyncedFile[],
  matchedBaseNames: Set<string>,
  toleranceSeconds: number = 60
): { dbRec?: DatabaseRecording; synced?: SyncedFile; localBaseName?: string } | null {
  // Parse device file date from filename
  const deviceDate = parseDateFromFilename(deviceRec.filename)
  if (!deviceDate || isNaN(deviceDate.getTime())) return null

  // Search through unmatched database recordings
  for (const dbRec of dbRecs) {
    const baseName = getBaseFilename(dbRec.filename)
    if (matchedBaseNames.has(baseName)) continue // Already matched

    // Try to parse date from local filename or use db date_recorded
    const localDate = parseDateFromFilename(dbRec.filename) ||
                     (dbRec.date_recorded ? new Date(dbRec.date_recorded) : null)
    if (!localDate || isNaN(localDate.getTime())) continue

    // Check if dates are within tolerance
    const diffSeconds = Math.abs(deviceDate.getTime() - localDate.getTime()) / 1000
    if (diffSeconds <= toleranceSeconds) {
      // Found a match! Also find corresponding synced file entry
      const synced = syncedFiles.find(sf =>
        sf.local_filename === dbRec.filename ||
        getBaseFilename(sf.local_filename) === baseName
      )
      return { dbRec, synced, localBaseName: baseName }
    }
  }

  return null
}

// Build unified recordings from multiple sources
function buildRecordingMap(
  deviceRecs: HiDockRecording[],
  dbRecs: DatabaseRecording[],
  syncedFiles: SyncedFile[],
  cachedDeviceFiles: CachedDeviceFile[],
  isConnected: boolean,
  knowledgeCaptures: KnowledgeCapture[] = []
): UnifiedRecording[] {
  // Create lookup maps using BASE filename (without extension)
  // This allows matching .hda (device) with .wav (downloaded) files
  const syncedMapByBase = new Map<string, SyncedFile>()
  const syncedMapByOriginal = new Map<string, SyncedFile>()
  const syncedMapByLocal = new Map<string, SyncedFile>()
  for (const sf of syncedFiles) {
    syncedMapByBase.set(getBaseFilename(sf.original_filename), sf)
    syncedMapByOriginal.set(sf.original_filename, sf)
    syncedMapByLocal.set(sf.local_filename, sf)
  }

  const dbMapByBase = new Map<string, DatabaseRecording>()
  const dbMapByFilename = new Map<string, DatabaseRecording>()
  for (const dbRec of dbRecs) {
    dbMapByBase.set(getBaseFilename(dbRec.filename), dbRec)
    dbMapByFilename.set(dbRec.filename, dbRec)
  }

  // Map knowledge captures by source recording ID for quick lookup
  const captureMapBySourceId = new Map<string, KnowledgeCapture>()
  for (const capture of knowledgeCaptures) {
    if (capture.sourceRecordingId) {
      captureMapBySourceId.set(capture.sourceRecordingId, capture)
    }
  }

  // Track which base filenames have been processed
  const processedBaseNames = new Set<string>()
  const recordingMap = new Map<string, UnifiedRecording>()

  // Process device recordings first
  for (const deviceRec of deviceRecs) {
    const baseName = getBaseFilename(deviceRec.filename)

    // Look up by base filename to match .hda with .wav
    let synced = syncedMapByOriginal.get(deviceRec.filename) || syncedMapByBase.get(baseName)
    let dbRec = dbMapByFilename.get(deviceRec.filename) || dbMapByBase.get(baseName)

    // NEW: If no exact match, try date/time matching (fallback for wrongly-named files)
    let localBaseName: string | undefined
    if (!synced && !dbRec) {
      const dateMatch = findMatchByDateTime(deviceRec, dbRecs, syncedFiles, processedBaseNames)
      if (dateMatch) {
        dbRec = dateMatch.dbRec
        synced = dateMatch.synced
        localBaseName = dateMatch.localBaseName
        console.log(`[buildRecordingMap] Matched by date: ${deviceRec.filename} ←→ ${dbRec?.filename}`)
      }
    }

    const dateRecorded = getBestDate(deviceRec.filename, deviceRec.dateCreated, new Date())

    if (synced || dbRec) {
      const dbId = dbRec?.id || synced!.id
      const capture = captureMapBySourceId.get(dbId)

      const recording: BothLocationsRecording = {
        id: dbId,
        filename: deviceRec.filename,
        size: deviceRec.size,
        duration: deviceRec.duration || dbRec?.duration_seconds || 0,
        dateRecorded,
        transcriptionStatus: mapTranscriptionStatus(dbRec?.transcription_status ?? dbRec?.status, capture?.status ?? undefined),
        meetingId: dbRec?.meeting_id,
        location: 'both',
        deviceFilename: deviceRec.filename,
        localPath: synced?.file_path || dbRec?.file_path || '',
        syncStatus: 'synced',
        knowledgeCaptureId: capture?.id,
        title: capture?.title,
        quality: capture?.quality,
        category: capture?.category ?? undefined,
        status: capture?.status ?? undefined,
        summary: capture?.summary ?? undefined
      }
      recordingMap.set(baseName, recording)
      processedBaseNames.add(baseName)
      // IMPORTANT: If matched by date, also track the local file's baseName to prevent duplicate processing
      if (localBaseName && localBaseName !== baseName) {
        processedBaseNames.add(localBaseName)
      }
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
      recordingMap.set(baseName, recording)
      processedBaseNames.add(baseName)
    }
  }

  // Process database recordings not already matched with device recordings
  for (const dbRec of dbRecs) {
    const baseName = getBaseFilename(dbRec.filename)
    if (!processedBaseNames.has(baseName)) {
      // Look up synced file by local filename first, then by base name
      const synced = syncedMapByLocal.get(dbRec.filename) || syncedMapByBase.get(baseName)
      const dbDate = dbRec.date_recorded ? new Date(dbRec.date_recorded) : null
      // IMPORTANT: Use original_filename (device filename) for date parsing if available
      // The local filename may have been saved with the wrong date (download date instead of recording date)
      const filenameForDate = synced?.original_filename || dbRec.filename
      const dateRecorded = getBestDate(filenameForDate, dbDate, new Date())
      const capture = captureMapBySourceId.get(dbRec.id)

      const recording: LocalOnlyRecording = {
        id: dbRec.id,
        filename: dbRec.filename,
        size: dbRec.file_size,
        duration: dbRec.duration_seconds || 0,
        dateRecorded,
        transcriptionStatus: mapTranscriptionStatus(dbRec.status, capture?.status ?? undefined),
        meetingId: dbRec.meeting_id,
        location: 'local-only',
        localPath: dbRec.file_path,
        syncStatus: 'synced',
        isImported: !synced,
        knowledgeCaptureId: capture?.id,
        title: capture?.title,
        quality: capture?.quality,
        category: capture?.category ?? undefined,
        status: capture?.status ?? undefined,
        summary: capture?.summary ?? undefined
      }
      recordingMap.set(baseName, recording)
      processedBaseNames.add(baseName)
    }
  }

  // Process cached device files (for offline or while waiting for fresh data)
  const shouldUseCachedFiles = cachedDeviceFiles.length > 0 && (
    !isConnected || (isConnected && deviceRecs.length === 0)
  )

  if (shouldUseCachedFiles) {
    for (const cached of cachedDeviceFiles) {
      const baseName = getBaseFilename(cached.filename)
      if (!processedBaseNames.has(baseName)) {
        const cachedDate = new Date(cached.date_recorded)
        const dateRecorded = getBestDate(cached.filename, cachedDate, cachedDate)
        const recording: DeviceOnlyRecording = {
          id: getBaseFilename(cached.filename),
          filename: cached.filename,
          size: cached.file_size ?? cached.size ?? 0,
          duration: cached.duration_seconds || 0,
          dateRecorded,
          transcriptionStatus: 'none',
          location: 'device-only',
          deviceFilename: cached.filename,
          syncStatus: 'not-synced'
        }
        recordingMap.set(baseName, recording)
        processedBaseNames.add(baseName)
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
    onSource: number
    locallyAvailable: number
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
  const incrementLoading = useAppStore((state) => state.incrementUnifiedRecordingsLoading)
  const decrementLoading = useAppStore((state) => state.decrementUnifiedRecordingsLoading)
  const setError = useAppStore((state) => state.setUnifiedRecordingsError)
  const markLoaded = useAppStore((state) => state.markUnifiedRecordingsLoaded)

  const [deviceConnected, setDeviceConnected] = useState(false)
  const loadingRef = useRef(false) // Prevent concurrent loads
  const pendingForceRefreshRef = useRef(false)
  const deviceReadyRefreshDoneRef = useRef(false) // Track if we've done a device-ready refresh
  const lastLoadTimestampRef = useRef(0) // FL-02: Track last load to prevent triple-fire
  const connectionEventCooldownRef = useRef(0) // AUD5-014: Suppress polling right after connection events

  const deviceService = getHiDockDeviceService()

  const loadRecordings = useCallback(async (forceRefresh: boolean = false) => {
    console.log('[useUnifiedRecordings] loadRecordings called, forceRefresh:', forceRefresh, 'loadingRef:', loadingRef.current)

    // FL-02 FIX: Debounce rapid-fire calls (connection + ready + poll within 2 seconds)
    // This prevents the triple-fire issue where all 3 events trigger simultaneously on device connection
    const now = Date.now()
    const timeSinceLastLoad = now - lastLoadTimestampRef.current
    if (!forceRefresh && timeSinceLastLoad < 2000) {
      console.log('[useUnifiedRecordings] Debouncing - only', timeSinceLastLoad, 'ms since last load')
      return
    }

    // Prevent concurrent loads
    // FL-03 MITIGATION: This ref-based locking has an async race window. Between the
    // check (loadingRef.current === false) and the set (loadingRef.current = true),
    // another caller on the same microtask could pass the guard. This is a known
    // limitation of ref-based locks in async React code. However, the FL-02 debounce
    // above (2 second window) significantly reduces the likelihood of this race occurring.
    // The worst case is a redundant fetch, not data corruption. A full fix would use a
    // promise-based queue, but the complexity isn't warranted given the low risk.
    if (loadingRef.current) {
      if (forceRefresh) {
        console.log('[useUnifiedRecordings] Already loading - queuing forceRefresh')
        pendingForceRefreshRef.current = true
      } else {
        console.log('[useUnifiedRecordings] Skipping - already loading')
      }
      return
    }
    loadingRef.current = true
    lastLoadTimestampRef.current = now

    // If not forcing and already loaded, skip (except for device connection changes)
    // This is handled by the caller - forceRefresh=true bypasses cached data

    incrementLoading()
    setError(null)
    // B-LIB-001: Track whether we've already decremented to avoid double-decrement on error
    let decremented = false

    try {
      // Guard: Check if running in Electron with full API
      if (!window.electronAPI?.recordings) {
        console.log('[useUnifiedRecordings] Not in Electron - returning empty data')
        setRecordings([])
        setDeviceConnected(false)
        decrementLoading()
        decremented = true
        loadingRef.current = false
        return
      }

      // Check device connection
      const isConnected = deviceService.isConnected()
      setDeviceConnected(isConnected)
      console.log('[useUnifiedRecordings] Device connected:', isConnected)

      // PHASE 1: Load local data + cache FIRST (fast) for instant display
      const [dbRecs, syncedFiles, cachedDeviceFiles, knowledgeCaptures] = await Promise.all([
        window.electronAPI.recordings.getAll() as Promise<DatabaseRecording[]>,
        window.electronAPI.syncedFiles.getAll() as Promise<SyncedFile[]>,
        window.electronAPI.deviceCache.getAll() as Promise<CachedDeviceFile[]>,
        window.electronAPI.knowledge.getAll() as Promise<KnowledgeCapture[]>
      ])
      console.log('[useUnifiedRecordings] Loaded: dbRecs:', dbRecs.length, 'syncedFiles:', syncedFiles.length, 'cachedDeviceFiles:', cachedDeviceFiles.length, 'knowledgeCaptures:', knowledgeCaptures?.length)

      // Debug: Show sample synced files to verify original_filename is present
      if (syncedFiles.length > 0) {
        const samples = syncedFiles.slice(0, 3)
        console.log('[useUnifiedRecordings] Sample synced files:', samples.map(sf => ({
          local: sf.local_filename,
          original: sf.original_filename
        })))
      }

      // Check if device service has in-memory cached recordings (from a recent fetch)
      // This is faster than the database cache and more up-to-date
      const memoryCachedDeviceRecs = isConnected ? deviceService.getCachedRecordings() : []

      // Show cached/local data immediately and mark as loaded
      // If we have in-memory cache from device service, use that for immediate display
      // This fixes the issue where navigating to Library shows stale data
      const initialRecordings = buildRecordingMap(memoryCachedDeviceRecs, dbRecs, syncedFiles, cachedDeviceFiles, isConnected, knowledgeCaptures)
      console.log('[useUnifiedRecordings] Built', initialRecordings.length, 'recordings')

      // Debug: Show sample dates
      if (initialRecordings.length > 0) {
        const samples = initialRecordings.slice(0, 3)
        console.log('[useUnifiedRecordings] Sample recording dates:', samples.map(r => ({
          filename: r.filename,
          date: r.dateRecorded.toISOString()
        })))
      }

      setRecordings(initialRecordings)
      markLoaded() // Mark as loaded in store

      // PHASE 2: Fetch device recordings (slow) - this updates the view when complete
      // Only needed if we don't have memory cache or forceRefresh is true
      const needsDeviceFetch = isConnected && (memoryCachedDeviceRecs.length === 0 || forceRefresh)

      // Only decrement loading if no device fetch is needed.
      // If Phase 2 will run, keep loading count elevated so the UI shows a loading indicator
      // and the sync button stays disabled until device recordings are available.
      if (!needsDeviceFetch) {
        decrementLoading()
        decremented = true
      }

      let deviceRecs: HiDockRecording[] = memoryCachedDeviceRecs
      if (needsDeviceFetch) {
        try {
          deviceRecs = await deviceService.listRecordings(undefined, forceRefresh)
        } catch (deviceError) {
          console.warn('[useUnifiedRecordings] Failed to get device recordings:', deviceError)
          // Continue with cached data
        }
      }

      // If device is connected, update the cache with current device files
      if (isConnected && deviceRecs.length > 0) {
        // Note: Field names must match device-cache-handlers.ts expectations:
        // filename (string), size (number), duration (number), dateCreated (string)
        const cacheEntries = deviceRecs.map(rec => ({
          filename: rec.filename,
          size: rec.size ?? 0, // Ensure number, not undefined
          duration: rec.duration ?? 0, // Ensure number, not undefined
          dateCreated: rec.dateCreated?.toISOString() || new Date().toISOString()
        }))
        try {
          await window.electronAPI.deviceCache.saveAll(cacheEntries)
        } catch (cacheError) {
          console.warn('[useUnifiedRecordings] Failed to save device cache:', cacheError)
        }
      }

      // PHASE 3: Build final recording list with all data (silent update)
      const finalRecordings = buildRecordingMap(deviceRecs, dbRecs, syncedFiles, cachedDeviceFiles, isConnected, knowledgeCaptures)
      console.log('[useUnifiedRecordings] Final recordings count:', finalRecordings.length)
      setRecordings(finalRecordings)
      // Decrement loading after final update (covers Phase 2 path only — Phase 1-only already decremented)
      if (!decremented) {
        decrementLoading()
        decremented = true
      }
    } catch (e) {
      console.error('[useUnifiedRecordings] Error loading recordings:', e)
      setError(e instanceof Error ? e.message : 'Failed to load recordings')
      if (!decremented) {
        decrementLoading()
        decremented = true
      }
    } finally {
      loadingRef.current = false
      if (pendingForceRefreshRef.current) {
        pendingForceRefreshRef.current = false
        setTimeout(() => loadRecordingsRef.current(true), 0)
      }
      console.log('[useUnifiedRecordings] loadRecordings completed')
    }
  }, [deviceService, setRecordings, incrementLoading, decrementLoading, setError, markLoaded])

  const loadRecordingsRef = useRef(loadRecordings)
  loadRecordingsRef.current = loadRecordings

  // TODO: FL-05: Multiple page instances each create independent subscriptions below.
  // A singleton subscription manager would prevent duplicate refreshes when multiple
  // components consume this hook simultaneously.
  // TODO: FL-10: React StrictMode double-mount is expected in dev mode. Subscriptions
  // are properly cleaned up on unmount so this does not cause leaks in production.

  // Initial load (only if not already loaded) and device connection subscription
  const initialLoadDoneRef = useRef(false)

  useEffect(() => {
    if (initialLoadDoneRef.current) return
    initialLoadDoneRef.current = true

    // Only load if not already loaded or if device connection changed
    if (!loaded) {
      loadRecordings()
    }

    // Check device connection on mount
    setDeviceConnected(deviceService.isConnected())

    // Subscribe to device connection changes
    // AUD5-014: Use forceRefresh=false here - the connection event fires before the device
    // is fully ready. The onStatusChange('ready') handler below is the real "ready" signal
    // and uses forceRefresh=true. This prevents triple-refresh on connect.
    const unsubConnection = deviceService.onConnectionChange((connected) => {
      setDeviceConnected(connected)
      // Reset the device-ready refresh flag when disconnecting
      if (!connected) {
        deviceReadyRefreshDoneRef.current = false
      }
      // AUD5-014: Set cooldown to suppress polling for 5 seconds after connection event
      connectionEventCooldownRef.current = Date.now()
      // Reload with forceRefresh=false - just checks cached/local data
      loadRecordings(false)
    })

    // Subscribe to connection STATUS changes (important: 'ready' means device is fully initialized)
    // This fixes the issue where connection change fires before device is ready,
    // causing isConnected() to return false and skipping device data fetch
    const unsubStatus = deviceService.onStatusChange((status) => {
      if (status.step === 'ready' && !deviceReadyRefreshDoneRef.current) {
        console.log('[useUnifiedRecordings] Device ready - forcing refresh to get device files')
        deviceReadyRefreshDoneRef.current = true
        // AUD5-014: Set cooldown to suppress polling after ready event
        connectionEventCooldownRef.current = Date.now()
        // Force refresh when device becomes ready to ensure we get fresh device data
        loadRecordings(true)
      }
    })

    return () => {
      unsubConnection()
      unsubStatus()
    }
  }, [loaded, loadRecordings, deviceService])

  // B-DEV-007: Listen for download completion events to refresh recordings
  // DL-USB-CONCURRENCY: Use forceRefresh=false — the DB is already updated when downloads complete
  // (via markRecordingDownloaded). forceRefresh=true would call listRecordings() over USB while
  // new downloads may be starting, causing USB concurrency conflicts and stalls.
  useEffect(() => {
    const handleDownloadsCompleted = () => {
      console.log('[useUnifiedRecordings] Downloads completed - refreshing from DB')
      loadRecordings(false)
    }
    window.addEventListener('hidock:downloads-completed', handleDownloadsCompleted)
    return () => window.removeEventListener('hidock:downloads-completed', handleDownloadsCompleted)
  }, [loadRecordings])

  // Subscribe to recording watcher events for auto-refresh
  useEffect(() => {
    if (!window.electronAPI?.onRecordingAdded) return

    const unsubscribe = window.electronAPI.onRecordingAdded((data) => {
      console.log('[useUnifiedRecordings] New recording detected:', data.recording.filename)

      // Import toast at runtime to avoid circular dependencies
      import('@/components/ui/toaster').then(({ toast }) => {
        toast.success('New Recording Detected', data.recording.filename)
      })

      // Auto-refresh without forcing device fetch (use cached data for speed)
      loadRecordings(false)
    })

    return unsubscribe
  }, [loadRecordings])

  // Poll device for file count changes (detect new recordings on device)
  useEffect(() => {
    if (!deviceConnected) return

    let previousRecordingCount = 0
    let isInitialized = false

    const checkDeviceChanges = async () => {
      try {
        if (!deviceService.isConnected()) return

        // FL-04: Skip polling when a connection-triggered refresh is already in progress
        // This prevents the polling effect from racing with connection event handlers
        if (loadingRef.current) return

        // AUD5-014: Skip polling during cooldown after a connection event
        // This prevents the poll from firing a redundant refresh right after connect/ready
        const cooldownElapsed = Date.now() - connectionEventCooldownRef.current
        if (cooldownElapsed < 5000) return

        // Get current device recordings count
        const deviceRecs = deviceService.getCachedRecordings()
        const currentCount = deviceRecs.length

        // Initialize on first run
        if (!isInitialized) {
          previousRecordingCount = currentCount
          isInitialized = true
          return
        }

        // Check for changes
        if (currentCount !== previousRecordingCount) {
          const diff = currentCount - previousRecordingCount
          console.log(`[useUnifiedRecordings] Device recording count changed: ${previousRecordingCount} → ${currentCount}`)

          if (diff > 0) {
            // New recordings detected
            import('@/components/ui/toaster').then(({ toast }) => {
              toast.info(
                `${diff} New Recording${diff > 1 ? 's' : ''} on Device`,
                `Detected ${diff} new recording${diff > 1 ? 's' : ''}`
              )
            })
          }

          // Force device refresh when count changes
          loadRecordings(true)
          previousRecordingCount = currentCount
        }
      } catch (error) {
        console.error('[useUnifiedRecordings] Error checking device changes:', error)
      }
    }

    // Check immediately on connection
    checkDeviceChanges()

    // Then check every 30 seconds
    const interval = setInterval(checkDeviceChanges, 30000)

    return () => clearInterval(interval)
  }, [deviceConnected, deviceService, loadRecordings])

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

    // Semantic stats for composite filters
    const onSource = deviceOnly + both          // All files from any source
    const locallyAvailable = localOnly + both   // All files downloaded

    return {
      total: recordings.length,
      deviceOnly,
      localOnly,
      both,
      synced,
      unsynced,
      // Semantic counts for dual-mode filter UI
      onSource,
      locallyAvailable
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
function mapTranscriptionStatus(status?: string, captureStatus?: string): UnifiedRecording['transcriptionStatus'] {
  if (captureStatus) {
    if (captureStatus === 'ready' || captureStatus === 'enriched') return 'complete'
    if (captureStatus === 'processing') return 'processing'
  }

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
