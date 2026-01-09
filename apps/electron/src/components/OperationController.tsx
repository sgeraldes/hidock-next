/**
 * OperationController - Unified background operations manager
 *
 * This component lives in Layout and handles ALL operations that should
 * persist across page navigation. It consolidates:
 * - Downloads (via DownloadController logic)
 * - Audio playback (keeps audio element alive)
 * - Calendar sync monitoring
 * - Transcription queue monitoring
 * - Chat message handling
 *
 * Pages should ONLY display state and dispatch actions - they should never
 * own long-running operations or hold critical state.
 */

import { useEffect, useRef, useCallback } from 'react'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { useAppStore } from '@/store/useAppStore'
import { useUIStore } from '@/store/useUIStore'
import { toast } from '@/components/ui/toaster'
import { checkAutoSyncAllowed, waitForConfig, waitForDeviceReady } from '@/utils/autoSyncGuard'
import { parseError, getErrorMessage } from '@/features/library/utils/errorHandling'
import { generateWaveformData, decodeAudioData } from '@/utils/audioUtils'

const DEBUG = true

// =============================================================================
// Types
// =============================================================================

interface DownloadQueueItem {
  id: string
  filename: string
  fileSize: number
  progress: number
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  error?: string
}

// =============================================================================
// OperationController Component
// =============================================================================

export function OperationController() {
  // Device service reference
  const deviceService = getHiDockDeviceService()

  // Refs for persistent state
  const isProcessingDownloads = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const downloadAbortControllerRef = useRef<AbortController | null>(null)
  const autoSyncTriggeredRef = useRef(false) // Prevent duplicate auto-sync triggers
  const waveformAbortControllerRef = useRef<AbortController | null>(null)

  // Global store actions
  const {
    setDeviceState,
    setConnectionStatus,
    addActivityLogEntry,
    setDeviceSyncState,
    clearDeviceSyncState,
    addToDownloadQueue,
    updateDownloadProgress,
    removeFromDownloadQueue,
    loadRecordings,
    loadMeetings,
    config
  } = useAppStore()

  // UI store for playback state
  const {
    setCurrentlyPlaying,
    setPlaybackProgress,
    setIsPlaying,
    setWaveformData
  } = useUIStore()

  // ==========================================================================
  // Download Operations
  // ==========================================================================

  const processDownload = useCallback(async (item: { filename: string; fileSize: number }, signal: AbortSignal) => {
    if (DEBUG) console.log(`[QA-MONITOR][Operation] Processing download: ${item.filename}`)

    if (!deviceService.isConnected()) {
      console.error('[OperationController] Device not connected')
      await window.electronAPI.downloadService.markFailed(item.filename, 'Device not connected')
      return false
    }

    // Check if aborted before starting
    if (signal.aborted) {
      return false
    }

    addToDownloadQueue(item.filename, item.filename, item.fileSize)

    try {
      const chunks: Uint8Array[] = []
      let totalReceived = 0

      const success = await deviceService.downloadRecording(
        item.filename,
        item.fileSize,
        (chunk) => {
          // Check abort signal during download
          if (signal.aborted) {
            throw new Error('Download cancelled')
          }
          chunks.push(chunk)
          totalReceived += chunk.length
          window.electronAPI.downloadService.updateProgress(item.filename, totalReceived)
          updateDownloadProgress(item.filename, Math.round((totalReceived / item.fileSize) * 100))
        }
      )

      if (!success) {
        console.error(`[QA-MONITOR][Operation] Download failed: ${item.filename}`)
        await window.electronAPI.downloadService.markFailed(item.filename, 'USB transfer failed')
        removeFromDownloadQueue(item.filename)
        toast({
          title: 'Download failed',
          description: `Failed to download ${item.filename}`,
          variant: 'error'
        })
        return false
      }

      // Concatenate and save
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      const result = await window.electronAPI.downloadService.processDownload(
        item.filename,
        Array.from(combined)
      )

      removeFromDownloadQueue(item.filename)

      if (result.success) {
        if (DEBUG) console.log(`[QA-MONITOR][Operation] Download completed: ${item.filename}`)
        return true
      } else {
        toast({
          title: 'Save failed',
          description: `Failed to save ${item.filename}: ${result.error}`,
          variant: 'error'
        })
        return false
      }
    } catch (error) {
      const libraryError = parseError(error, 'download')
      console.error(`[QA-MONITOR][Operation] Error: ${item.filename}`, error)
      await window.electronAPI.downloadService.markFailed(item.filename, libraryError.message)
      removeFromDownloadQueue(item.filename)
      toast({
        title: 'Download error',
        description: getErrorMessage(libraryError.type),
        variant: 'error'
      })
      return false
    }
  }, [deviceService, addToDownloadQueue, updateDownloadProgress, removeFromDownloadQueue])

  const processDownloadQueue = useCallback(async () => {
    if (isProcessingDownloads.current) return

    const state = await window.electronAPI.downloadService.getState()
    const pendingItems = state.queue.filter((item: DownloadQueueItem) => item.status === 'pending')

    if (pendingItems.length === 0 || !deviceService.isConnected()) return

    isProcessingDownloads.current = true

    // Create new AbortController for this download session
    downloadAbortControllerRef.current = new AbortController()
    const signal = downloadAbortControllerRef.current.signal

    if (DEBUG) console.log(`[QA-MONITOR][Operation] Processing ${pendingItems.length} downloads`)

    setDeviceSyncState({
      deviceSyncing: true,
      deviceSyncProgress: { current: 0, total: pendingItems.length },
      deviceFileProgress: 0
    })

    let completed = 0
    let failed = 0
    let aborted = false

    for (const item of pendingItems) {
      // Check abort signal
      if (signal.aborted) {
        if (DEBUG) console.log('[OperationController] Download aborted by user')
        aborted = true
        break
      }

      // Check device connection before EACH download
      if (!deviceService.isConnected()) {
        if (DEBUG) console.log('[OperationController] Device disconnected, stopping downloads')
        aborted = true
        break
      }

      // Check store state for cancel (user clicked Cancel Sync button)
      const storeState = useAppStore.getState()
      if (!storeState.deviceSyncing) {
        if (DEBUG) console.log('[OperationController] Sync cancelled by user')
        aborted = true
        break
      }

      setDeviceSyncState({
        deviceFileDownloading: item.filename,
        deviceSyncProgress: { current: completed + failed, total: pendingItems.length },
        deviceFileProgress: 0
      })

      const success = await processDownload(item, signal)
      success ? completed++ : failed++
    }

    isProcessingDownloads.current = false
    clearDeviceSyncState()

    // Refresh data after sync
    if (completed > 0) {
      // loadRecordings() // Disabled to prevent loops; views use useUnifiedRecordings which auto-refreshes
      const store = useAppStore.getState();
      if (store.invalidateUnifiedRecordings) {
        store.invalidateUnifiedRecordings();
      }
    }

    if (completed > 0 || failed > 0 || aborted) {
      toast({
        title: aborted ? 'Sync cancelled' : (failed === 0 ? 'Sync complete' : 'Sync completed with errors'),
        description: aborted
          ? `Downloaded ${completed} of ${pendingItems.length} file${pendingItems.length !== 1 ? 's' : ''}`
          : (failed === 0
            ? `Downloaded ${completed} file${completed !== 1 ? 's' : ''}`
            : `Downloaded ${completed}, failed ${failed}`),
        variant: aborted ? 'default' : (failed === 0 ? 'success' : 'warning')
      })
    }
  }, [deviceService, processDownload, setDeviceSyncState, clearDeviceSyncState, loadRecordings])

  // ==========================================================================
  // Audio Playback Operations
  // ==========================================================================

  const playAudio = useCallback(async (recordingId: string, filePath: string) => {
    if (DEBUG) console.log(`[QA-MONITOR][Operation] Playing: ${recordingId}`)

    try {
      // Stop current playback and reset state
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      setIsPlaying(false)
      setPlaybackProgress(0, 0)

      // Load audio file
      const response = await window.electronAPI.storage.readRecording(filePath)
      const base64 = response?.data
      if (!base64) {
        toast({ title: 'Error', description: 'Failed to load audio file', variant: 'error' })
        return
      }

      // Create audio element if needed
      if (!audioRef.current) {
        audioRef.current = new Audio()
        audioRef.current.addEventListener('timeupdate', () => {
          if (audioRef.current) {
            setPlaybackProgress(audioRef.current.currentTime, audioRef.current.duration)
          }
        })
        audioRef.current.addEventListener('play', () => {
          setIsPlaying(true)
        })
        audioRef.current.addEventListener('pause', () => {
          setIsPlaying(false)
        })
        audioRef.current.addEventListener('ended', () => {
          setIsPlaying(false)
          setCurrentlyPlaying(null, null)
          setPlaybackProgress(0, 0)
          setWaveformData(null)
        })
        audioRef.current.addEventListener('error', (e) => {
          const libraryError = parseError(e, 'audio playback')
          console.error('[OperationController] Audio error:', e)
          toast({
            title: 'Playback error',
            description: getErrorMessage(libraryError.type),
            variant: 'error'
          })
          setIsPlaying(false)
          setCurrentlyPlaying(null, null)
          setWaveformData(null)
        })
      }

      // Determine MIME type from file extension
      const ext = filePath.split('.').pop()?.toLowerCase()
      const mimeType =
        ext === 'mp3' ? 'audio/mpeg' :
        ext === 'hda' ? 'audio/mpeg' :  // HDA files are MPEG MP3
        ext === 'm4a' ? 'audio/mp4' :
        'audio/wav'

      // Set currently playing BEFORE loading to show loading state
      setCurrentlyPlaying(recordingId, filePath)

      // Generate waveform data for visualization
      try {
        const audioBuffer = await decodeAudioData(base64, mimeType)
        const waveformData = await generateWaveformData(audioBuffer, 1000)
        setWaveformData(waveformData)
      } catch (waveformError) {
        console.warn('[OperationController] Failed to generate waveform:', waveformError)
        // Continue with playback even if waveform generation fails
        setWaveformData(null)
      }

      audioRef.current.src = `data:${mimeType};base64,${base64}`
      await audioRef.current.play()
    } catch (error) {
      const libraryError = parseError(error, 'audio playback')
      console.error('[OperationController] Play error:', error)
      toast({
        title: 'Playback error',
        description: getErrorMessage(libraryError.type),
        variant: 'error'
      })
      setIsPlaying(false)
      setCurrentlyPlaying(null, null)
      setWaveformData(null)
    }
  }, [setCurrentlyPlaying, setPlaybackProgress, setIsPlaying, setWaveformData])

  const loadWaveformOnly = useCallback(async (recordingId: string, filePath: string) => {
    if (DEBUG) console.log(`[QA-MONITOR][Operation] Loading waveform only: ${recordingId}`)

    // Cancel any in-flight waveform loading
    if (waveformAbortControllerRef.current) {
      waveformAbortControllerRef.current.abort()
    }

    // Create new AbortController for this load operation
    waveformAbortControllerRef.current = new AbortController()
    const signal = waveformAbortControllerRef.current.signal

    // Set loading state
    const { setWaveformLoading, setWaveformLoadingError, setWaveformLoadedFor, setWaveformData } = useUIStore.getState()
    setWaveformLoading(recordingId)

    try {
      // Check if aborted early
      if (signal.aborted) {
        if (DEBUG) console.log('[OperationController] Waveform load aborted (early)')
        return
      }

      // Load audio file - IPC returns { success: boolean, data?: string, error?: string }
      const response = await window.electronAPI.storage.readRecording(filePath)

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to read audio file')
      }

      const base64 = response.data
      const fileSizeBytes = Math.ceil((base64.length * 3) / 4) // Approximate decoded size

      // Check file size limit (100MB)
      const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
      if (fileSizeBytes > MAX_FILE_SIZE) {
        throw new Error(`File too large (${Math.round(fileSizeBytes / (1024 * 1024))}MB). Maximum size is 100MB.`)
      }

      // Check if aborted after file read
      if (signal.aborted) {
        if (DEBUG) console.log('[OperationController] Waveform load aborted (after file read)')
        return
      }

      // Determine MIME type from file extension
      const ext = filePath.split('.').pop()?.toLowerCase()
      const mimeType =
        ext === 'mp3' ? 'audio/mpeg' :
        ext === 'hda' ? 'audio/mpeg' :  // HDA files are MPEG MP3
        ext === 'm4a' ? 'audio/mp4' :
        'audio/wav'

      // Decode and generate waveform
      const audioBuffer = await decodeAudioData(base64, mimeType)

      // Check if aborted after decode
      if (signal.aborted) {
        if (DEBUG) console.log('[OperationController] Waveform load aborted (after decode)')
        return
      }

      const waveformData = await generateWaveformData(audioBuffer, 1000)

      // Check if aborted after waveform generation
      if (signal.aborted) {
        if (DEBUG) console.log('[OperationController] Waveform load aborted (after generation)')
        return
      }

      // Update UI with waveform data
      setWaveformData(waveformData)
      setWaveformLoadedFor(recordingId)

      if (DEBUG) console.log(`[QA-MONITOR][Operation] Waveform loaded successfully: ${recordingId}`)
    } catch (error) {
      // Check if error is due to abort
      if (signal.aborted) {
        if (DEBUG) console.log('[OperationController] Waveform load aborted (during error)')
        return
      }

      const libraryError = parseError(error, 'waveform generation')
      console.error('[OperationController] Waveform load error:', error)

      // Set error state
      setWaveformLoadingError(recordingId, getErrorMessage(libraryError.type))
      setWaveformData(null)
    }
  }, [])

  const pauseAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
    }
  }, [])

  const resumeAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play()
    }
  }, [])

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    setIsPlaying(false)
    setCurrentlyPlaying(null, null)
    setPlaybackProgress(0, 0)
    setWaveformData(null)
  }, [setCurrentlyPlaying, setIsPlaying, setPlaybackProgress, setWaveformData])

  const seekAudio = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }, [])

  // Expose playback controls globally
  useEffect(() => {
    (window as any).__audioControls = {
      play: playAudio,
      pause: pauseAudio,
      resume: resumeAudio,
      stop: stopAudio,
      seek: seekAudio,
      loadWaveformOnly: loadWaveformOnly
    }

    return () => {
      delete (window as any).__audioControls
    }
  }, [playAudio, pauseAudio, resumeAudio, stopAudio, seekAudio, loadWaveformOnly])

  // ==========================================================================
  // Calendar Sync Operations
  // ==========================================================================

  useEffect(() => {
    // Initial calendar sync if configured
    if (config?.calendar?.icsUrl && config?.calendar?.syncEnabled) {
      // Sync is handled by main process timer, just ensure we have latest
      loadMeetings()
    }
  }, [config?.calendar?.icsUrl, config?.calendar?.syncEnabled, loadMeetings])

  // ==========================================================================
  // Device State Subscriptions
  // ==========================================================================

  // Sync guard to prevent duplicate subscriptions
  const deviceSubscriptionsInitialized = useRef(false)

  useEffect(() => {
    // Guard: Only subscribe once
    if (deviceSubscriptionsInitialized.current) return
    deviceSubscriptionsInitialized.current = true

    if (DEBUG) console.log('[OperationController] Subscribing to device state')

    // Get initial device state and update store
    const initialState = deviceService.getState()
    const initialStatus = deviceService.getConnectionStatus()
    setDeviceState(initialState)
    setConnectionStatus(initialStatus)

    // Subscribe to device state changes
    const unsubStateChange = deviceService.onStateChange((state) => {
      if (DEBUG) console.log('[OperationController] Device state changed:', state)
      setDeviceState(state)
    })

    // Subscribe to connection status changes
    const unsubStatusChange = deviceService.onStatusChange(async (status) => {
      if (DEBUG) console.log('[OperationController] Connection status changed:', status)
      setConnectionStatus(status)

      // AUTO-SYNC TRIGGER: Only when status becomes 'ready'
      if (status.step !== 'ready') return
      if (autoSyncTriggeredRef.current) return

      // Verify all preconditions (this also checks config is loaded)
      const { allowed, reason } = checkAutoSyncAllowed()
      if (!allowed) {
        if (DEBUG) console.log(`[OperationController] Auto-sync skipped on ready: ${reason}`)
        return
      }

      // Trigger auto-sync
      autoSyncTriggeredRef.current = true
      if (DEBUG) console.log('[OperationController] Auto-sync triggered on device ready')

      const recordings = deviceService.getCachedRecordings()
      if (recordings.length > 0) {
        const syncedFilenames = await window.electronAPI.syncedFiles.getFilenames()
        const syncedSet = new Set(syncedFilenames)
        const toSync = recordings.filter(rec => !syncedSet.has(rec.filename))
        if (toSync.length > 0) {
          if (DEBUG) console.log(`[QA-MONITOR][Operation] Auto-sync on ready: ${toSync.length} files to download`)
          deviceService.log('info', 'Auto-sync triggered', `${toSync.length} new recordings to download`)

          // Queue files for download (with recording dates for proper date preservation)
          const filesToQueue = toSync.map(rec => ({
            filename: rec.filename,
            size: rec.size,
            dateCreated: rec.dateCreated?.toISOString()
          }))
          await window.electronAPI.downloadService.startSession(filesToQueue)
          setDeviceSyncState({
            deviceSyncing: true,
            deviceSyncProgress: { total: toSync.length, current: 0 },
            deviceFileDownloading: toSync[0]?.filename ?? null
          })
        } else {
          deviceService.log('success', 'All files synced', 'No new recordings to download')
        }
      }
    })

    // Subscribe to activity log (for error reporting and debugging)
    const unsubActivity = deviceService.onActivity((entry) => {
      addActivityLogEntry(entry)
    })

    return () => {
      if (DEBUG) console.log('[OperationController] Unsubscribing from device state')
      unsubStateChange()
      unsubStatusChange()
      unsubActivity()
      deviceSubscriptionsInitialized.current = false
    }
  }, [deviceService, setDeviceState, setConnectionStatus, addActivityLogEntry])

  // ==========================================================================
  // Subscriptions and Initialization
  // ==========================================================================

  useEffect(() => {
    if (DEBUG) console.log('[OperationController] Mounted')

    // Guard: Check if running in Electron with full API
    const isElectron = !!window.electronAPI?.downloadService
    if (!isElectron) {
      if (DEBUG) console.log('[OperationController] Not in Electron - limited functionality')
    }

    // Subscribe to download service state updates (only in Electron)
    const unsubDownloads = isElectron
      ? window.electronAPI.downloadService.onStateUpdate((state) => {
          const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
          if (hasPending && !isProcessingDownloads.current && deviceService.isConnected()) {
            processDownloadQueue()
          }
        })
      : () => {} // No-op cleanup

    // Check initial download state (only in Electron)
    if (isElectron) {
      window.electronAPI.downloadService.getState().then((state) => {
        const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
        if (hasPending && deviceService.isConnected()) {
          processDownloadQueue()
        }
      })
    }

    // Check for auto-sync at startup (device may already be connected when app loads)
    // This handles the case where device is connected BEFORE app starts (only in Electron)
    const checkInitialAutoSync = async () => {
      if (!isElectron) return

      // CRITICAL: Wait for config to load first - never use defaults
      const configLoaded = await waitForConfig(10000)
      if (!configLoaded) {
        if (DEBUG) console.log('[OperationController] Config load timeout, skipping auto-sync')
        return
      }

      // Wait for device to be fully ready (not just connected)
      const deviceReady = await waitForDeviceReady(60000)
      if (!deviceReady) {
        if (DEBUG) console.log('[OperationController] Device not ready, skipping auto-sync')
        return
      }

      // Check all preconditions
      const { allowed, reason } = checkAutoSyncAllowed()
      if (!allowed) {
        if (DEBUG) console.log(`[OperationController] Auto-sync skipped: ${reason}`)
        deviceService.log('info', 'Auto-sync skipped', reason)
        return
      }

      // Prevent duplicate triggers
      if (autoSyncTriggeredRef.current) return

      // All checks passed - proceed with auto-sync
      autoSyncTriggeredRef.current = true
      if (DEBUG) console.log('[OperationController] Initial auto-sync check (device pre-connected)')

      const recordings = deviceService.getCachedRecordings()
      if (recordings.length > 0) {
        const syncedFilenames = await window.electronAPI.syncedFiles.getFilenames()
        const syncedSet = new Set(syncedFilenames)
        const toSync = recordings.filter(rec => !syncedSet.has(rec.filename))
        if (toSync.length > 0) {
          if (DEBUG) console.log(`[QA-MONITOR][Operation] Initial auto-sync: ${toSync.length} files to download`)
          deviceService.log('info', 'Auto-sync triggered', `${toSync.length} new recordings to download`)

          // Queue files for download (with recording dates for proper date preservation)
          const filesToQueue = toSync.map(rec => ({
            filename: rec.filename,
            size: rec.size,
            dateCreated: rec.dateCreated?.toISOString()
          }))
          await window.electronAPI.downloadService.startSession(filesToQueue)
          setDeviceSyncState({
            deviceSyncing: true,
            deviceSyncProgress: { total: toSync.length, current: 0 },
            deviceFileDownloading: toSync[0]?.filename ?? null
          })
        } else {
          deviceService.log('success', 'All files synced', 'No new recordings to download')
        }
      }
    }
    checkInitialAutoSync()

    // Subscribe to device connection changes (for download resumption and abort on disconnect)
    const unsubDevice = deviceService.onStateChange(async (deviceState) => {
      if (deviceState.connected && !isProcessingDownloads.current && isElectron) {
        // Check for pending downloads to resume
        window.electronAPI.downloadService.getState().then((state) => {
          const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
          if (hasPending) {
            if (DEBUG) console.log('[OperationController] Device connected, resuming downloads')
            processDownloadQueue()
          }
        })

        // AUTO-SYNC: Device connected - DON'T trigger here
        // Auto-sync is now triggered by status reaching 'ready' state (see status change handler)
      } else if (!deviceState.connected) {
        // Device disconnected - abort downloads if processing
        if (isProcessingDownloads.current) {
          if (DEBUG) console.log('[OperationController] Device disconnected, aborting downloads')
          downloadAbortControllerRef.current?.abort()
        }
        // Reset auto-sync flag so it triggers on reconnect
        autoSyncTriggeredRef.current = false
      }
    })

    // Subscribe to transcription updates (from main process) - only in Electron
    const transcriptionInterval = isElectron
      ? setInterval(async () => {
          try {
            const status = await window.electronAPI.recordings.getTranscriptionStatus()
            if (status.isProcessing || status.pendingCount > 0) {
              // Transcription in progress - data will be refreshed when done
            }
          } catch (e) {
            // Ignore errors
          }
        }, 5000)
      : null

    return () => {
      if (DEBUG) console.log('[OperationController] Unmounting')
      downloadAbortControllerRef.current?.abort()
      unsubDownloads()
      unsubDevice()
      if (transcriptionInterval) clearInterval(transcriptionInterval)

      // Clean up audio
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
    }
  }, [deviceService, processDownloadQueue, setDeviceSyncState])

  // This component renders nothing - purely side effects
  return null
}

// =============================================================================
// Hook for accessing audio controls from any component
// =============================================================================

export const useAudioControls = () => {
  return {
    play: (recordingId: string, filePath: string) => {
      (window as any).__audioControls?.play(recordingId, filePath)
    },
    pause: () => {
      (window as any).__audioControls?.pause()
    },
    resume: () => {
      (window as any).__audioControls?.resume()
    },
    stop: () => {
      (window as any).__audioControls?.stop()
    },
    seek: (time: number) => {
      (window as any).__audioControls?.seek(time)
    },
    loadWaveformOnly: (recordingId: string, filePath: string) => {
      (window as any).__audioControls?.loadWaveformOnly(recordingId, filePath)
    }
  }
}
