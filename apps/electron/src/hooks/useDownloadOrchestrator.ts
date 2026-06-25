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

// Slice 1 (ADR-0005): explicit per-action download scope.
// Every download path funnels into one persisted queue that the orchestrator
// used to drain entirely on any pending item — so "download this one file"
// pulled in every other pending/stale item (the "download one → all 52" bug).
// When auto-download is OFF, the orchestrator now processes ONLY filenames a
// user action explicitly registered here. When auto-download is ON, it keeps
// the bulk "drain all pending" behavior (that is what the toggle means).
// Register intent BEFORE enqueueing so the state-update subscription sees it.
const _requestedDownloads = new Set<string>()

export function requestScopedDownloads(filenames: string[]): void {
  for (const f of filenames) _requestedDownloads.add(f)
}

/**
 * Pure selector for which pending items to process. Exported for unit tests.
 * - auto-download ON  → all pending (bulk auto-sync semantics)
 * - auto-download OFF → only items the user explicitly requested
 */
export function selectDownloadsToProcess<T extends { filename: string }>(
  pending: T[],
  requested: Set<string>,
  autoDownload: boolean
): T[] {
  return autoDownload ? pending : pending.filter((p) => requested.has(p.filename))
}

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
    const allPending = state.queue.filter((item: DownloadQueueItem) => item.status === 'pending')

    // Slice 1: scope to the user's explicit request when auto-download is off,
    // so a single download never drains unrelated/stale pending items.
    let autoDownload = false
    try {
      const result = await window.electronAPI.config.get()
      const cfg = result?.success ? (result.data as { device?: { autoDownload?: boolean } }) : null
      autoDownload = cfg?.device?.autoDownload === true
    } catch {
      autoDownload = false
    }
    const pendingItems = selectDownloadsToProcess(allPending, _requestedDownloads, autoDownload)

    if (pendingItems.length === 0 || !deviceService.isConnected()) {
      isProcessingDownloads.current = false
      return
    }
    // NOTE: scope entries are removed only after a SUCCESSFUL download (below),
    // so a failed item stays in scope and is retried (e.g. on reconnect) instead
    // of being silently dropped. The isProcessingDownloads mutex already prevents
    // concurrent reprocessing.
    downloadAbortControllerRef.current = new AbortController()
    // DL-14: Sync module-level ref so cancelDownloads() can abort from outside
    _downloadAbortControllerRef = downloadAbortControllerRef.current

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

    for (const item of pendingItems) {
      // User-initiated cancel via cancelDownloads() — abort entire queue
      if (_cancelInProgress) {
        if (shouldLogQa()) console.log('[useDownloadOrchestrator] Download cancelled by user')
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

      // If the abort controller was triggered by stall detection (not user cancel),
      // create a fresh one so the next download can proceed
      if (downloadAbortControllerRef.current.signal.aborted && !_cancelInProgress) {
        if (shouldLogQa()) console.log('[useDownloadOrchestrator] Resetting AbortController after stall-detected abort')
        downloadAbortControllerRef.current = new AbortController()
        _downloadAbortControllerRef = downloadAbortControllerRef.current
      }

      setDeviceSyncState({
        deviceFileDownloading: item.filename,
        deviceSyncProgress: { current: completed, total: pendingItems.length },
        deviceFileProgress: 0
      })

      currentlyDownloadingRef.current = item.filename
      const success = await processDownload(item, downloadAbortControllerRef.current.signal)
      currentlyDownloadingRef.current = null
      if (success) {
        completed++
        bytesDownloaded += item.fileSize || 0
        // Consume the scope entry only once the file is actually downloaded;
        // failed items stay scoped so a retry re-processes them (auto-download OFF).
        _requestedDownloads.delete(item.filename)
      } else {
        failed++
      }

      // C-004: Compute ETA based on elapsed time and bytes completed
      const elapsed = (Date.now() - syncStartTime) / 1000
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

    // NOTE: Do NOT auto-process persisted pending downloads on mount.
    // Downloads are triggered by auto-sync (startSession → onStateUpdate → processDownloadQueue).
    // Processing persisted items here would race with the file list scan on the USB bus.

    // Handle device status changes — DO NOT start downloads here.
    // Downloads are triggered by auto-sync (useDeviceSubscriptions) which:
    //   1. Waits for file list scan to complete
    //   2. Reconciles files
    //   3. Calls startSession → emits state update → processDownloadQueue
    // Starting downloads independently on 'ready' would race with the file list scan
    // on the USB bus, causing stalls and corrupted responses.
    const unsubDevice = deviceService.onStatusChange((status) => {
      if (status.step === 'ready' && isElectron && !isProcessingDownloads.current) {
        // Only retry FAILED items on reconnect — don't process the full pending queue.
        // Pending items will be processed when auto-sync calls startSession.
        window.electronAPI.downloadService.getState().then((state) => {
          const hasFailed = state.queue.some((item: DownloadQueueItem) => item.status === 'failed')
          if (hasFailed) {
            if (shouldLogQa()) console.log('[useDownloadOrchestrator] Device ready, retrying failed downloads')
            window.electronAPI.downloadService.retryFailed(true)
          }
        })
      } else if (status.step === 'idle' && !deviceService.isConnected()) {
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
