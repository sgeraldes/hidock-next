/**
 * useDownloadOrchestrator - Manages file downloads from USB device to local storage.
 *
 * Extracted from OperationController Phase 2+3A decomposition.
 * Owns: processDownload, processDownloadQueue, download service subscription,
 * and device reconnect download resume.
 *
 * B-DWN-008: Renderer-side stall detection removed. Stall detection is now
 * handled exclusively by main process DownloadService.checkForStalledDownloads().
 */

import { useEffect, useRef, useCallback } from 'react'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/components/ui/toaster'
import { parseError, getErrorMessage } from '@/features/library/utils/errorHandling'
import { shouldLogQa } from '@/services/qa-monitor'

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

let _cancelInProgress = false
let _cancelEpoch = 0
let _lastProcessedEpoch = 0

/**
 * Cancel in-progress downloads by aborting the USB transfer.
 * Call this from UI cancel buttons in addition to setting deviceSyncing = false.
 * Idempotent: if a cancel is already in progress, returns immediately.
 */
export function cancelDownloads(): void {
  if (_cancelInProgress) return
  _cancelInProgress = true
  _cancelEpoch++

  if (_downloadAbortControllerRef) {
    _downloadAbortControllerRef.abort()
    _downloadAbortControllerRef = null
  }
  // Cancel all downloads at device service level (aborts USB transfers)
  const deviceService = getHiDockDeviceService()
  deviceService.cancelAllDownloads()
  // DL-003: Also cancel main-process transfers
  window.electronAPI?.downloadService?.cancelAll?.()
  // Also set store state so the queue loop breaks
  useAppStore.getState().cancelDeviceSync()
}

export function cancelDownloadsComplete(): void {
  _cancelInProgress = false
}

export function useDownloadOrchestrator() {
  const deviceService = getHiDockDeviceService()
  const isProcessingDownloads = useRef(false)
  const downloadAbortControllerRef = useRef<AbortController | null>(null)
  // DL-STALL: Track the filename currently being downloaded so onStateUpdate can abort
  // when the main process marks it as failed (e.g., stall detection)
  const currentlyDownloadingRef = useRef<string | null>(null)

  const setDeviceSyncState = useAppStore((s) => s.setDeviceSyncState)
  const clearDeviceSyncState = useAppStore((s) => s.clearDeviceSyncState)
  const addToDownloadQueue = useAppStore((s) => s.addToDownloadQueue)
  const updateDownloadProgress = useAppStore((s) => s.updateDownloadProgress)
  const removeFromDownloadQueue = useAppStore((s) => s.removeFromDownloadQueue)

  // ---- Single file download ----

  const processDownload = useCallback(async (item: { filename: string; fileSize: number }, signal: AbortSignal) => {
    if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Processing download: ${item.filename}`)

    if (!deviceService.isConnected()) {
      console.error('[useDownloadOrchestrator] Device not connected')
      deviceService.log('error', 'Download failed', `${item.filename}: Device not connected`)
      await window.electronAPI.downloadService.markFailed(item.filename, 'Device not connected')
      return false
    }

    if (signal.aborted) return false

    addToDownloadQueue(item.filename, item.filename, item.fileSize)
    deviceService.log('info', 'Starting download', item.filename)

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
          // C-004: Guard against NaN when fileSize is 0
          const pct = item.fileSize > 0 ? Math.round((totalReceived / item.fileSize) * 100) : 0
          updateDownloadProgress(item.filename, Number.isFinite(pct) ? pct : 0)
        },
        signal
      )

      if (!success) {
        console.error(`[useDownloadOrchestrator] Download failed: ${item.filename}`)
        await window.electronAPI.downloadService.markFailed(item.filename, 'USB transfer failed')
        removeFromDownloadQueue(item.filename)
        deviceService.log('error', 'Download failed', `${item.filename}: USB transfer failed`)
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
        if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Download completed: ${item.filename}`)
        deviceService.log('success', 'Download complete', item.filename)
        return true
      } else {
        deviceService.log('error', 'Download save failed', `${item.filename}: ${result.error}`)
        toast({
          title: 'Save failed',
          description: `Failed to save ${item.filename}: ${result.error}`,
          variant: 'error'
        })
        return false
      }
    } catch (error) {
      const libraryError = parseError(error, 'download')
      console.error(`[useDownloadOrchestrator] Error: ${item.filename}`, error)
      await window.electronAPI.downloadService.markFailed(item.filename, libraryError.message)
      if (signal.aborted) {
        // User-initiated cancellation — log as info, not error
        deviceService.log('info', 'Download cancelled', `${item.filename}: Cancelled by user`)
      } else {
        deviceService.log('error', 'Download failed', `${item.filename}: ${libraryError.message}`)
      }
      if (!signal.aborted) {
        removeFromDownloadQueue(item.filename)
        toast({
          title: 'Download error',
          description: getErrorMessage(libraryError.type),
          variant: 'error'
        })
      }
      return false
    }
  }, [deviceService, addToDownloadQueue, updateDownloadProgress, removeFromDownloadQueue])

  // ---- Queue processing ----

  const processDownloadQueue = useCallback(async () => {
    if (isProcessingDownloads.current) return
    // DL-008: Set lock before first await to prevent double-processing
    isProcessingDownloads.current = true

    const state = await window.electronAPI.downloadService.getState()
    const pendingItems = state.queue.filter((item: DownloadQueueItem) => item.status === 'pending')

    if (pendingItems.length === 0 || !deviceService.isConnected()) {
      isProcessingDownloads.current = false
      return
    }
    downloadAbortControllerRef.current = new AbortController()
    // DL-14: Sync module-level ref so cancelDownloads() can abort from outside
    _downloadAbortControllerRef = downloadAbortControllerRef.current
    const signal = downloadAbortControllerRef.current.signal

    if (shouldLogQa()) console.log(`[QA-MONITOR][Operation] Processing ${pendingItems.length} downloads`)

    // C-004: Compute total bytes for ETA calculation
    const totalBytes = pendingItems.reduce((sum: number, item: DownloadQueueItem) => sum + (item.fileSize || 0), 0)
    const syncStartTime = Date.now()

    // DL-02: Emit initial progress event immediately after queue creation
    // so the sidebar shows 0/total before the first file starts downloading
    setDeviceSyncState({
      deviceSyncing: true,
      deviceSyncProgress: { current: 0, total: pendingItems.length },
      deviceFileProgress: 0,
      deviceFileDownloading: pendingItems[0]?.filename ?? null,
      deviceSyncStartTime: syncStartTime,
      deviceSyncBytesDownloaded: 0,
      deviceSyncTotalBytes: totalBytes,
      deviceSyncEta: null
    })

    let completed = 0
    let failed = 0
    let aborted = false
    let bytesDownloaded = 0

    // TODO: DL-10: Consider pipelining: start reading next file while writing current file to disk.
    for (const item of pendingItems) {
      if (signal.aborted) {
        if (shouldLogQa()) console.log('[useDownloadOrchestrator] Download aborted by user')
        aborted = true
        break
      }

      if (!deviceService.isConnected()) {
        if (shouldLogQa()) console.log('[useDownloadOrchestrator] Device disconnected, stopping downloads')
        aborted = true
        break
      }

      const storeState = useAppStore.getState()
      if (!storeState.deviceSyncing) {
        if (shouldLogQa()) console.log('[useDownloadOrchestrator] Sync cancelled by user')
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

      // DL-STALL: Track the currently downloading file so onStateUpdate can abort
      // if the main process marks it failed (e.g., stall detection)
      currentlyDownloadingRef.current = item.filename
      const success = await processDownload(item, signal)
      currentlyDownloadingRef.current = null
      if (success) {
        completed++
        bytesDownloaded += item.fileSize || 0
      } else {
        failed++
      }

      // C-004: Compute ETA based on elapsed time and bytes completed
      const elapsed = (Date.now() - syncStartTime) / 1000 // seconds
      if (elapsed > 0 && bytesDownloaded > 0 && totalBytes > 0) {
        const bytesPerSecond = bytesDownloaded / elapsed
        const remainingBytes = totalBytes - bytesDownloaded
        const etaSeconds = Math.round(remainingBytes / bytesPerSecond)
        setDeviceSyncState({
          deviceSyncBytesDownloaded: bytesDownloaded,
          deviceSyncEta: Number.isFinite(etaSeconds) && etaSeconds > 0 ? etaSeconds : null
        })
      }
    }

    isProcessingDownloads.current = false
    // DL-14: Clear module-level ref when processing finishes
    _downloadAbortControllerRef = null
    // DL-005: Reset cancel flag so subsequent cancels work correctly
    _cancelInProgress = false
    clearDeviceSyncState()

    if (aborted) {
      useAppStore.getState().clearDownloadQueue()
    }

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

      // C-004: Show OS-level notification for download completion
      try {
        window.electronAPI.downloadService.notifyCompletion({ completed, failed, aborted })
      } catch {
        // Notification is non-critical, fail silently
      }
    }
  }, [deviceService, processDownload, setDeviceSyncState, clearDeviceSyncState])

  // DL-11: Use a ref for processDownloadQueue so the effect below doesn't
  // re-subscribe all listeners when processDownloadQueue is recreated
  const processDownloadQueueRef = useRef(processDownloadQueue)
  processDownloadQueueRef.current = processDownloadQueue

  // SM-002: Initialization guard to prevent double subscription in StrictMode
  const orchestratorInitialized = useRef(false)

  // ---- Download service subscription + device reconnect resume ----
  // B-DWN-008: Renderer-side stall detection removed. Stall detection is handled
  // exclusively by the main process DownloadService.checkForStalledDownloads().

  useEffect(() => {
    if (orchestratorInitialized.current) return
    orchestratorInitialized.current = true

    // DL-005: Reset module-level state on mount so stale cancel flags don't block new downloads
    _cancelInProgress = false
    _cancelEpoch = 0
    _lastProcessedEpoch = 0

    const isElectron = !!window.electronAPI?.downloadService

    // Subscribe to download service state updates
    const unsubDownloads = isElectron
      ? window.electronAPI.downloadService.onStateUpdate((state) => {
          // Sync renderer queue with main process state
          const rendererQueue = useAppStore.getState().downloadQueue
          for (const item of state.queue) {
            if ((item.status === 'pending' || item.status === 'downloading') && !rendererQueue.has(item.filename)) {
              useAppStore.getState().addToDownloadQueue(item.filename, item.filename, item.fileSize || 0)
            }
          }
          for (const [key] of rendererQueue) {
            const mainItem = state.queue.find((i: DownloadQueueItem) => i.filename === key)
            if (!mainItem || mainItem.status === 'completed' || mainItem.status === 'failed' || mainItem.status === 'cancelled') {
              useAppStore.getState().removeFromDownloadQueue(key)
            }
          }

          if (_cancelEpoch > _lastProcessedEpoch) {
            _lastProcessedEpoch = _cancelEpoch
            return
          }

          // DL-STALL: If the main process marked the currently-active download as failed
          // (e.g., stall detection), abort the renderer-side USB transfer so the loop can proceed
          if (currentlyDownloadingRef.current && isProcessingDownloads.current) {
            const activeItem = state.queue.find(
              (i: DownloadQueueItem) => i.filename === currentlyDownloadingRef.current
            )
            if (activeItem?.status === 'failed' || activeItem?.status === 'cancelled') {
              if (shouldLogQa()) {
                console.log(`[useDownloadOrchestrator] Main process marked ${currentlyDownloadingRef.current} as ${activeItem.status} — aborting USB transfer`)
              }
              downloadAbortControllerRef.current?.abort()
            }
          }

          const hasPending = state.queue.some((item: DownloadQueueItem) => item.status === 'pending')
          // DL-001: Use store connection step instead of deviceService.isConnected() — the service
          // returns true during early init steps before the device is fully ready
          const isDeviceReady = useAppStore.getState().connectionStatus.step === 'ready'
          if (hasPending && !isProcessingDownloads.current && isDeviceReady) {
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
            if (shouldLogQa()) console.log('[useDownloadOrchestrator] Device connected, resuming downloads')
            processDownloadQueueRef.current()
          }
        })
      } else if (!deviceState.connected) {
        if (isProcessingDownloads.current) {
          if (shouldLogQa()) console.log('[useDownloadOrchestrator] Device disconnected, aborting downloads')
          downloadAbortControllerRef.current?.abort()
        }
      }
    })

    // B-DWN-008: Renderer-side stall detection removed — handled server-side in download-service.ts

    return () => {
      downloadAbortControllerRef.current?.abort()
      unsubDownloads()
      unsubDevice()
      // SM-002: Do NOT reset orchestratorInitialized.current here.
      // StrictMode does mount -> cleanup -> mount; resetting allows double subscription.
      // When the component truly unmounts and remounts, React creates a NEW ref(false).
    }
  // DL-11: Only depend on deviceService (stable singleton). processDownloadQueue
  // is accessed via ref so changes don't cause re-subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceService])
}
