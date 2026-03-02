/**
 * useDownloadOrchestrator - Manages file downloads from USB device to local storage.
 *
 * Extracted from OperationController Phase 2+3A decomposition.
 * Owns: processDownload, processDownloadQueue, download service subscription,
 * device reconnect download resume, and download stall detection.
 */

import { useEffect, useRef, useCallback } from 'react'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/components/ui/toaster'
import { parseError, getErrorMessage } from '@/features/library/utils/errorHandling'

const DEBUG = import.meta.env.DEV

interface DownloadQueueItem {
  id: string
  filename: string
  fileSize: number
  progress: number
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  error?: string
}

// DL-14: Module-level abort controller ref so cancelDownloads can be called from outside the hook
let _downloadAbortControllerRef: AbortController | null = null

/**
 * Cancel in-progress downloads by aborting the USB transfer.
 * Call this from UI cancel buttons in addition to setting deviceSyncing = false.
 */
export function cancelDownloads(): void {
  if (_downloadAbortControllerRef) {
    _downloadAbortControllerRef.abort()
    _downloadAbortControllerRef = null
  }
  // Cancel all downloads at device service level (aborts USB transfers)
  const deviceService = getHiDockDeviceService()
  deviceService.cancelAllDownloads()
  // Also set store state so the queue loop breaks
  useAppStore.getState().cancelDeviceSync()
}

export function useDownloadOrchestrator() {
  const deviceService = getHiDockDeviceService()
  const isProcessingDownloads = useRef(false)
  const downloadAbortControllerRef = useRef<AbortController | null>(null)

  const setDeviceSyncState = useAppStore((s) => s.setDeviceSyncState)
  const clearDeviceSyncState = useAppStore((s) => s.clearDeviceSyncState)
  const addToDownloadQueue = useAppStore((s) => s.addToDownloadQueue)
  const updateDownloadProgress = useAppStore((s) => s.updateDownloadProgress)
  const removeFromDownloadQueue = useAppStore((s) => s.removeFromDownloadQueue)

  // ---- Single file download ----

  const processDownload = useCallback(async (item: { filename: string; fileSize: number }, signal: AbortSignal) => {
    if (DEBUG) console.log(`[QA-MONITOR][Operation] Processing download: ${item.filename}`)

    if (!deviceService.isConnected()) {
      console.error('[useDownloadOrchestrator] Device not connected')
      await window.electronAPI.downloadService.markFailed(item.filename, 'Device not connected')
      return false
    }

    if (signal.aborted) return false

    addToDownloadQueue(item.filename, item.filename, item.fileSize)

    try {
      const chunks: Uint8Array[] = []
      let totalReceived = 0

      const success = await deviceService.downloadRecording(
        item.filename,
        item.fileSize,
        (chunk) => {
          if (signal.aborted) throw new Error('Download cancelled')
          chunks.push(chunk)
          totalReceived += chunk.length
          window.electronAPI.downloadService.updateProgress(item.filename, totalReceived)
          updateDownloadProgress(item.filename, Math.round((totalReceived / item.fileSize) * 100))
        },
        signal
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
        combined
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

  // ---- Queue processing ----

  const processDownloadQueue = useCallback(async () => {
    if (isProcessingDownloads.current) return

    const state = await window.electronAPI.downloadService.getState()
    const pendingItems = state.queue.filter((item: DownloadQueueItem) => item.status === 'pending')

    if (pendingItems.length === 0 || !deviceService.isConnected()) return

    isProcessingDownloads.current = true
    downloadAbortControllerRef.current = new AbortController()
    // DL-14: Sync module-level ref so cancelDownloads() can abort from outside
    _downloadAbortControllerRef = downloadAbortControllerRef.current
    const signal = downloadAbortControllerRef.current.signal

    if (DEBUG) console.log(`[QA-MONITOR][Operation] Processing ${pendingItems.length} downloads`)

    // DL-02: Emit initial progress event immediately after queue creation
    // so the sidebar shows 0/total before the first file starts downloading
    setDeviceSyncState({
      deviceSyncing: true,
      deviceSyncProgress: { current: 0, total: pendingItems.length },
      deviceFileProgress: 0,
      deviceFileDownloading: pendingItems[0]?.filename ?? null
    })

    let completed = 0
    let failed = 0
    let aborted = false

    // TODO: DL-10: Consider pipelining: start reading next file while writing current file to disk.
    for (const item of pendingItems) {
      if (signal.aborted) {
        if (DEBUG) console.log('[useDownloadOrchestrator] Download aborted by user')
        aborted = true
        break
      }

      if (!deviceService.isConnected()) {
        if (DEBUG) console.log('[useDownloadOrchestrator] Device disconnected, stopping downloads')
        aborted = true
        break
      }

      const storeState = useAppStore.getState()
      if (!storeState.deviceSyncing) {
        if (DEBUG) console.log('[useDownloadOrchestrator] Sync cancelled by user')
        aborted = true
        break
      }

      // DL-13: Only count completed (not failed) in progress numerator
      // so the progress bar accurately reflects successful downloads
      setDeviceSyncState({
        deviceFileDownloading: item.filename,
        deviceSyncProgress: { current: completed, total: pendingItems.length },
        deviceFileProgress: 0
      })

      const success = await processDownload(item, signal)
      success ? completed++ : failed++
    }

    isProcessingDownloads.current = false
    // DL-14: Clear module-level ref when processing finishes
    _downloadAbortControllerRef = null
    clearDeviceSyncState()

    // B-DEV-007: Force refresh recordings after download completes
    // Emit a custom event so useUnifiedRecordings can do a forced refresh (with device data)
    // instead of just invalidating (which only refreshes cached data)
    if (completed > 0) {
      window.dispatchEvent(new CustomEvent('hidock:downloads-completed'))
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
  }, [deviceService, processDownload, setDeviceSyncState, clearDeviceSyncState])

  // DL-11: Use a ref for processDownloadQueue so the effect below doesn't
  // re-subscribe all listeners when processDownloadQueue is recreated
  const processDownloadQueueRef = useRef(processDownloadQueue)
  processDownloadQueueRef.current = processDownloadQueue

  // ---- Download service subscription + device reconnect resume + stall detection ----

  useEffect(() => {
    const isElectron = !!window.electronAPI?.downloadService

    // Subscribe to download service state updates
    const unsubDownloads = isElectron
      ? window.electronAPI.downloadService.onStateUpdate((state) => {
          const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
          if (hasPending && !isProcessingDownloads.current && deviceService.isConnected()) {
            processDownloadQueueRef.current()
          }
        })
      : () => {}

    // Check initial download state
    if (isElectron) {
      window.electronAPI.downloadService.getState().then((state) => {
        const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
        if (hasPending && deviceService.isConnected()) {
          processDownloadQueueRef.current()
        }
      })
    }

    // Resume downloads on device reconnect
    const unsubDevice = deviceService.onStateChange(async (deviceState) => {
      if (deviceState.connected && !isProcessingDownloads.current && isElectron) {
        window.electronAPI.downloadService.getState().then((state) => {
          const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
          if (hasPending) {
            if (DEBUG) console.log('[useDownloadOrchestrator] Device connected, resuming downloads')
            processDownloadQueueRef.current()
          }
        })
      } else if (!deviceState.connected) {
        if (isProcessingDownloads.current) {
          if (DEBUG) console.log('[useDownloadOrchestrator] Device disconnected, aborting downloads')
          downloadAbortControllerRef.current?.abort()
        }
      }
    })

    // Download stall detection heartbeat (every 15s)
    const downloadProgressTimestamps = new Map<string, { progress: number; timestamp: number }>()
    const DOWNLOAD_STALL_TIMEOUT = 60_000

    const stallDetectionInterval = setInterval(() => {
      const { downloadQueue } = useAppStore.getState()
      const now = Date.now()

      // B-DEV-008: Per-file stall detection - only fail the individual stalled file,
      // not abort the entire queue via AbortController
      downloadQueue.forEach((item, id) => {
        const prev = downloadProgressTimestamps.get(id)
        if (!prev) {
          downloadProgressTimestamps.set(id, { progress: item.progress, timestamp: now })
          return
        }

        if (item.progress !== prev.progress) {
          downloadProgressTimestamps.set(id, { progress: item.progress, timestamp: now })
        } else if (now - prev.timestamp > DOWNLOAD_STALL_TIMEOUT && item.progress > 0 && item.progress < 100) {
          console.warn(`[useDownloadOrchestrator] Download stalled: ${item.filename} at ${item.progress}%`)
          toast({
            title: 'Download stalled',
            description: `${item.filename} stopped at ${item.progress}%. Marking as failed.`,
            variant: 'error'
          })
          // B-DEV-008: Only mark the individual file as failed, don't abort the entire controller
          if (window.electronAPI?.downloadService?.markFailed) {
            window.electronAPI.downloadService.markFailed(item.filename, `Download stalled at ${item.progress}% (no progress for ${DOWNLOAD_STALL_TIMEOUT / 1000}s)`)
          }
          // Remove from the store queue so it doesn't block the UI
          useAppStore.getState().removeFromDownloadQueue(id)
          downloadProgressTimestamps.delete(id)
        }
      })

      // B-DEV-009: Clear downloadProgressTimestamps when no downloads are active to prevent memory leaks
      if (downloadQueue.size === 0) {
        downloadProgressTimestamps.clear()
      } else {
        // Clean up tracking for completed downloads
        for (const [id] of downloadProgressTimestamps) {
          if (!downloadQueue.has(id)) {
            downloadProgressTimestamps.delete(id)
          }
        }
      }
    }, 15_000)

    return () => {
      downloadAbortControllerRef.current?.abort()
      unsubDownloads()
      unsubDevice()
      clearInterval(stallDetectionInterval)
    }
  // DL-11: Only depend on deviceService (stable singleton). processDownloadQueue
  // is accessed via ref so changes don't cause re-subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceService])
}
