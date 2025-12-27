/**
 * DownloadController - Background download component
 *
 * This component lives in the Layout (never unmounts) and handles all device downloads.
 * It subscribes to the main process DownloadService and processes the queue.
 *
 * Key responsibilities:
 * - Subscribe to download service state from main process
 * - Process pending downloads using device service (WebUSB)
 * - Report progress/completion back to main process
 * - Continue downloads regardless of page navigation
 */

import { useEffect, useRef, useCallback } from 'react'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/components/ui/toaster'

const DEBUG_DOWNLOAD_CONTROLLER = true

interface DownloadServiceState {
  queue: Array<{
    id: string
    filename: string
    fileSize: number
    progress: number
    status: 'pending' | 'downloading' | 'completed' | 'failed'
    error?: string
  }>
  session: {
    id: string
    totalFiles: number
    completedFiles: number
    failedFiles: number
    status: 'active' | 'completed' | 'cancelled' | 'failed'
  } | null
  isProcessing: boolean
  isPaused: boolean
}

export function DownloadController() {
  const deviceService = getHiDockDeviceService()
  const isProcessingRef = useRef(false)
  const abortRef = useRef(false)

  // Get store actions for UI updates
  const {
    setDeviceSyncState,
    clearDeviceSyncState,
    addToDownloadQueue,
    updateDownloadProgress,
    removeFromDownloadQueue,
    deviceSyncing
  } = useAppStore()

  // Track bytes for ETA calculation
  const bytesDownloadedRef = useRef(0)
  const totalBytesRef = useRef(0)
  const startTimeRef = useRef(0)

  /**
   * Process a single download from the queue
   */
  const processDownload = useCallback(async (item: { filename: string; fileSize: number }) => {
    if (DEBUG_DOWNLOAD_CONTROLLER) {
      console.log(`[DownloadController] Processing: ${item.filename}`)
    }

    // Check if device is connected
    if (!deviceService.isConnected()) {
      console.error('[DownloadController] Device not connected')
      await window.electronAPI.downloadService.markFailed(item.filename, 'Device not connected')
      return false
    }

    // Add to UI queue
    addToDownloadQueue(item.filename, item.filename, item.fileSize)

    try {
      // Download file data from device (WebUSB operation)
      const chunks: Uint8Array[] = []
      let totalReceived = 0

      const success = await deviceService.downloadRecording(
        item.filename,
        item.fileSize,
        (chunk) => {
          chunks.push(chunk)
          totalReceived += chunk.length

          // Report progress to main process and UI
          window.electronAPI.downloadService.updateProgress(item.filename, totalReceived)
          updateDownloadProgress(item.filename, Math.round((totalReceived / item.fileSize) * 100))
        }
      )

      if (!success) {
        console.error(`[DownloadController] Download failed for ${item.filename}`)
        await window.electronAPI.downloadService.markFailed(item.filename, 'USB transfer failed')
        removeFromDownloadQueue(item.filename)
        return false
      }

      // Concatenate chunks
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      // Send to main process for saving
      const result = await window.electronAPI.downloadService.processDownload(
        item.filename,
        Array.from(combined)
      )

      removeFromDownloadQueue(item.filename)

      if (result.success) {
        if (DEBUG_DOWNLOAD_CONTROLLER) {
          console.log(`[DownloadController] Completed: ${item.filename}`)
        }
        return true
      } else {
        console.error(`[DownloadController] Save failed: ${item.filename} - ${result.error}`)
        toast({
          title: 'Save failed',
          description: `Failed to save ${item.filename}: ${result.error}`,
          variant: 'error'
        })
        return false
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[DownloadController] Error downloading ${item.filename}:`, error)
      await window.electronAPI.downloadService.markFailed(item.filename, errorMsg)
      removeFromDownloadQueue(item.filename)
      toast({
        title: 'Download error',
        description: `Error downloading ${item.filename}: ${errorMsg}`,
        variant: 'error'
      })
      return false
    }
  }, [deviceService, addToDownloadQueue, updateDownloadProgress, removeFromDownloadQueue])

  /**
   * Calculate ETA based on elapsed time and progress
   */
  const calculateEta = useCallback((bytesDownloaded: number, totalBytes: number, startTime: number): number | null => {
    if (bytesDownloaded === 0 || totalBytes === 0) return null
    const elapsedMs = Date.now() - startTime
    if (elapsedMs < 2000) return null // Wait at least 2 seconds for stable estimate
    const bytesPerMs = bytesDownloaded / elapsedMs
    const remainingBytes = totalBytes - bytesDownloaded
    const remainingMs = remainingBytes / bytesPerMs
    return Math.ceil(remainingMs / 1000) // Return seconds
  }, [])

  /**
   * Process all pending downloads in the queue
   */
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) {
      if (DEBUG_DOWNLOAD_CONTROLLER) console.log('[DownloadController] Already processing, skipping')
      return
    }

    // Get current state
    const state = await window.electronAPI.downloadService.getState()
    const pendingItems = state.queue.filter(item => item.status === 'pending')

    if (pendingItems.length === 0) {
      if (DEBUG_DOWNLOAD_CONTROLLER) console.log('[DownloadController] No pending items')
      return
    }

    if (!deviceService.isConnected()) {
      if (DEBUG_DOWNLOAD_CONTROLLER) console.log('[DownloadController] Device not connected')
      return
    }

    isProcessingRef.current = true
    abortRef.current = false

    // Calculate total bytes for ETA
    const totalBytes = pendingItems.reduce((sum, item) => sum + item.fileSize, 0)
    totalBytesRef.current = totalBytes
    bytesDownloadedRef.current = 0
    startTimeRef.current = Date.now()

    if (DEBUG_DOWNLOAD_CONTROLLER) {
      console.log(`[DownloadController] Starting to process ${pendingItems.length} pending items (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`)
    }

    // Update UI state with totals
    setDeviceSyncState({
      deviceSyncing: true,
      deviceSyncProgress: { current: 0, total: pendingItems.length },
      deviceFileProgress: 0,
      deviceSyncStartTime: startTimeRef.current,
      deviceSyncTotalBytes: totalBytes,
      deviceSyncBytesDownloaded: 0,
      deviceSyncEta: null
    })

    let completed = 0
    let failed = 0

    for (const item of pendingItems) {
      // Check for abort OR cancellation via store
      if (abortRef.current || !useAppStore.getState().deviceSyncing) {
        if (DEBUG_DOWNLOAD_CONTROLLER) console.log('[DownloadController] Cancelled')
        break
      }

      // Update progress before download starts
      setDeviceSyncState({
        deviceFileDownloading: item.filename,
        deviceSyncProgress: { current: completed, total: pendingItems.length },
        deviceFileProgress: 0
      })

      const success = await processDownload(item)
      if (success) {
        completed++
        // Update bytes downloaded and calculate ETA
        bytesDownloadedRef.current += item.fileSize
        const eta = calculateEta(bytesDownloadedRef.current, totalBytesRef.current, startTimeRef.current)
        setDeviceSyncState({
          deviceSyncProgress: { current: completed, total: pendingItems.length },
          deviceSyncBytesDownloaded: bytesDownloadedRef.current,
          deviceSyncEta: eta
        })
      } else {
        failed++
      }
    }

    isProcessingRef.current = false
    const wasCancelled = !useAppStore.getState().deviceSyncing
    clearDeviceSyncState()

    // Show completion toast
    if (wasCancelled) {
      toast({
        title: 'Sync cancelled',
        description: `Downloaded ${completed} file${completed !== 1 ? 's' : ''} before cancellation`,
        variant: 'default'
      })
    } else if (completed > 0 || failed > 0) {
      if (failed === 0) {
        toast({
          title: 'Sync complete',
          description: `Downloaded ${completed} file${completed !== 1 ? 's' : ''}`,
          variant: 'success'
        })
      } else {
        toast({
          title: 'Sync completed with errors',
          description: `Downloaded ${completed}, failed ${failed}`,
          variant: 'warning'
        })
      }
    }
  }, [deviceService, processDownload, setDeviceSyncState, clearDeviceSyncState, calculateEta])

  /**
   * Subscribe to download service state updates from main process
   */
  useEffect(() => {
    if (DEBUG_DOWNLOAD_CONTROLLER) {
      console.log('[DownloadController] Mounted, subscribing to state updates')
    }

    // Subscribe to state updates from main process
    const unsubscribe = window.electronAPI.downloadService.onStateUpdate((state: DownloadServiceState) => {
      if (DEBUG_DOWNLOAD_CONTROLLER) {
        console.log('[DownloadController] State update received:', {
          queueSize: state.queue.length,
          pending: state.queue.filter(i => i.status === 'pending').length,
          session: state.session?.status
        })
      }

      // If there are pending items and we're not processing, start processing
      const hasPending = state.queue.some(item => item.status === 'pending')
      if (hasPending && !isProcessingRef.current) {
        processQueue()
      }
    })

    // Check initial state
    window.electronAPI.downloadService.getState().then((state) => {
      const hasPending = state.queue.some(item => item.status === 'pending')
      if (hasPending && !isProcessingRef.current && deviceService.isConnected()) {
        if (DEBUG_DOWNLOAD_CONTROLLER) {
          console.log('[DownloadController] Initial state has pending items, starting processing')
        }
        processQueue()
      }
    })

    // Subscribe to device connection changes
    const unsubDeviceState = deviceService.onStateChange((deviceState) => {
      if (deviceState.connected && !isProcessingRef.current) {
        // Device just connected, check if there are pending downloads
        window.electronAPI.downloadService.getState().then((state) => {
          const hasPending = state.queue.some(item => item.status === 'pending')
          if (hasPending) {
            if (DEBUG_DOWNLOAD_CONTROLLER) {
              console.log('[DownloadController] Device connected, resuming downloads')
            }
            processQueue()
          }
        })
      }
    })

    return () => {
      if (DEBUG_DOWNLOAD_CONTROLLER) {
        console.log('[DownloadController] Unmounting')
      }
      abortRef.current = true
      unsubscribe()
      unsubDeviceState()
    }
  }, [deviceService, processQueue])

  // This component renders nothing - it's purely for side effects
  return null
}
