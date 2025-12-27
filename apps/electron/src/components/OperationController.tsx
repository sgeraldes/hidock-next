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

const DEBUG = true

// =============================================================================
// Types
// =============================================================================

interface DownloadQueueItem {
  id: string
  filename: string
  fileSize: number
  progress: number
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  error?: string
}

interface PlaybackState {
  recordingId: string | null
  filePath: string | null
  isPlaying: boolean
  currentTime: number
  duration: number
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
  const downloadAbortRef = useRef(false)

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
    syncCalendar,
    config
  } = useAppStore()

  // UI store for playback state
  const {
    currentlyPlayingId,
    setCurrentlyPlaying,
    setPlaybackProgress,
    setIsPlaying
  } = useUIStore()

  // ==========================================================================
  // Download Operations
  // ==========================================================================

  const processDownload = useCallback(async (item: { filename: string; fileSize: number }) => {
    if (DEBUG) console.log(`[OperationController] Processing download: ${item.filename}`)

    if (!deviceService.isConnected()) {
      console.error('[OperationController] Device not connected')
      await window.electronAPI.downloadService.markFailed(item.filename, 'Device not connected')
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
          chunks.push(chunk)
          totalReceived += chunk.length
          window.electronAPI.downloadService.updateProgress(item.filename, totalReceived)
          updateDownloadProgress(item.filename, Math.round((totalReceived / item.fileSize) * 100))
        }
      )

      if (!success) {
        console.error(`[OperationController] Download failed: ${item.filename}`)
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
        if (DEBUG) console.log(`[OperationController] Download completed: ${item.filename}`)
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
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[OperationController] Error: ${item.filename}`, error)
      await window.electronAPI.downloadService.markFailed(item.filename, errorMsg)
      removeFromDownloadQueue(item.filename)
      toast({
        title: 'Download error',
        description: `Error: ${errorMsg}`,
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
    downloadAbortRef.current = false

    if (DEBUG) console.log(`[OperationController] Processing ${pendingItems.length} downloads`)

    setDeviceSyncState({
      deviceSyncing: true,
      deviceSyncProgress: { current: 0, total: pendingItems.length },
      deviceFileProgress: 0
    })

    let completed = 0
    let failed = 0

    for (const item of pendingItems) {
      if (downloadAbortRef.current) break

      setDeviceSyncState({
        deviceFileDownloading: item.filename,
        deviceSyncProgress: { current: completed + failed, total: pendingItems.length },
        deviceFileProgress: 0
      })

      const success = await processDownload(item)
      success ? completed++ : failed++
    }

    isProcessingDownloads.current = false
    clearDeviceSyncState()

    // Refresh data after sync
    if (completed > 0) {
      loadRecordings()
    }

    if (completed > 0 || failed > 0) {
      toast({
        title: failed === 0 ? 'Sync complete' : 'Sync completed with errors',
        description: failed === 0
          ? `Downloaded ${completed} file${completed !== 1 ? 's' : ''}`
          : `Downloaded ${completed}, failed ${failed}`,
        variant: failed === 0 ? 'success' : 'warning'
      })
    }
  }, [deviceService, processDownload, setDeviceSyncState, clearDeviceSyncState, loadRecordings])

  // ==========================================================================
  // Audio Playback Operations
  // ==========================================================================

  const playAudio = useCallback(async (recordingId: string, filePath: string) => {
    if (DEBUG) console.log(`[OperationController] Playing: ${recordingId}`)

    try {
      // Stop current playback and reset state
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      setIsPlaying(false)
      setPlaybackProgress(0, 0)

      // Load audio file
      const base64 = await window.electronAPI.storage.readRecording(filePath)
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
        })
        audioRef.current.addEventListener('error', (e) => {
          console.error('[OperationController] Audio error:', e)
          toast({ title: 'Playback error', description: 'Failed to play audio', variant: 'error' })
          setIsPlaying(false)
          setCurrentlyPlaying(null, null)
        })
      }

      // Determine MIME type from file extension
      const ext = filePath.split('.').pop()?.toLowerCase()
      const mimeType = ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : 'audio/wav'

      // Set currently playing BEFORE loading to show loading state
      setCurrentlyPlaying(recordingId, filePath)

      audioRef.current.src = `data:${mimeType};base64,${base64}`
      await audioRef.current.play()
    } catch (error) {
      console.error('[OperationController] Play error:', error)
      toast({ title: 'Playback error', description: 'Failed to play audio', variant: 'error' })
      setIsPlaying(false)
      setCurrentlyPlaying(null, null)
    }
  }, [setCurrentlyPlaying, setPlaybackProgress, setIsPlaying])

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
  }, [setCurrentlyPlaying, setIsPlaying, setPlaybackProgress])

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
      seek: seekAudio
    }

    return () => {
      delete (window as any).__audioControls
    }
  }, [playAudio, pauseAudio, resumeAudio, stopAudio, seekAudio])

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
    const unsubStatusChange = deviceService.onStatusChange((status) => {
      if (DEBUG) console.log('[OperationController] Connection status changed:', status)
      setConnectionStatus(status)
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

    // Subscribe to download service state updates
    const unsubDownloads = window.electronAPI.downloadService.onStateUpdate((state) => {
      const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
      if (hasPending && !isProcessingDownloads.current && deviceService.isConnected()) {
        processDownloadQueue()
      }
    })

    // Check initial download state
    window.electronAPI.downloadService.getState().then((state) => {
      const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
      if (hasPending && deviceService.isConnected()) {
        processDownloadQueue()
      }
    })

    // Subscribe to device connection changes (for download resumption)
    const unsubDevice = deviceService.onStateChange((deviceState) => {
      if (deviceState.connected && !isProcessingDownloads.current) {
        window.electronAPI.downloadService.getState().then((state) => {
          const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
          if (hasPending) {
            if (DEBUG) console.log('[OperationController] Device connected, resuming downloads')
            processDownloadQueue()
          }
        })
      }
    })

    // Subscribe to transcription updates (from main process)
    // Transcription is already handled by main process, just need to refresh data
    const transcriptionInterval = setInterval(async () => {
      try {
        const status = await window.electronAPI.recordings.getTranscriptionStatus()
        if (status.isProcessing || status.pendingCount > 0) {
          // Transcription in progress - data will be refreshed when done
        }
      } catch (e) {
        // Ignore errors
      }
    }, 5000)

    return () => {
      if (DEBUG) console.log('[OperationController] Unmounting')
      downloadAbortRef.current = true
      unsubDownloads()
      unsubDevice()
      clearInterval(transcriptionInterval)

      // Clean up audio
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
    }
  }, [deviceService, processDownloadQueue])

  // This component renders nothing - purely side effects
  return null
}

// =============================================================================
// Hook for accessing audio controls from any component
// =============================================================================

export function useAudioControls() {
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
    }
  }
}
