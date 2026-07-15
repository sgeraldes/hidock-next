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
  // HIGH-3 (Codex): origin of a 'cancelled' status (see download-service). 'user' =
  // deliberate cancel → terminal until manual retry; 'interrupted' = disconnect/re-sync.
  cancelReason?: 'user' | 'interrupted'
  // Original recording date (from the device), used for recency-first ordering.
  // Arrives over IPC as a Date (structured clone) or an ISO string.
  recordingDate?: Date | string | null
}

/**
 * HIGH-3 (Codex): a download that was INTERRUPTED and should be AUTO-retried on
 * reconnect. Split from status alone because a 'cancelled' status now carries an
 * origin:
 *   'failed'                        — errored (USB/save failure, stall). Always retryable.
 *   'cancelled' + interrupted/none  — disconnect/re-sync aborted it mid-flight. Retryable.
 *   'cancelled' + 'user'            — the user deliberately cancelled. NOT auto-retryable;
 *                                     it stays terminal until a manual Retry.
 * Used consistently by the reconnect retry AND the operations badge so a user cancel
 * never resurrects on reconnect (and never inflates the "needs attention" count).
 * Exported for reuse + unit tests.
 */
export function isRetryableDownloadItem(item: { status: string; cancelReason?: string }): boolean {
  if (item.status === 'failed') return true
  if (item.status === 'cancelled') return item.cancelReason !== 'user'
  return false
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

// Defect C (recency ordering): user-explicit SINGLE downloads jump the queue and
// drain FIFO among themselves; everything else (bulk / auto-sync backlog) drains
// newest-first. Populated by useOperations.queueDownload (single) only — bulk and
// auto-sync deliberately do NOT mark priority so they sort by recording date.
// Mirrors the transcription queue's userPriorityIds (transcription.ts).
const _priorityDownloads = new Set<string>()

export function markDownloadPriority(filenames: string[]): void {
  for (const f of filenames) _priorityDownloads.add(f)
}

export function clearDownloadPriority(filename: string): void {
  _priorityDownloads.delete(filename)
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

export interface OrderableDownload {
  filename: string
  recordingDate?: Date | string | null
}

/**
 * Recency-first download ordering. Pure + deterministic so the dequeue loop can
 * re-run it on every iteration (mirrors transcription.ts orderPendingForProcessing):
 *
 *   1. User-explicit single downloads first, FIFO among themselves.
 *   2. Everything else by the recording's content date (recordingDate) DESC, so
 *      today's recording beats last month's regardless of enqueue order. Undated
 *      recordings sort last. Tiebreak: original (enqueue) order = FIFO.
 *
 * Because it re-runs per dequeue, a newer file detected mid-backlog preempts the
 * older waiting items automatically. Relies on Array.prototype.sort being stable
 * (ES2019+) for the FIFO tiebreaks.
 */
export function orderDownloadsForProcessing<T extends OrderableDownload>(
  pending: T[],
  priority: Set<string>
): T[] {
  const ms = (v?: Date | string | null): number => {
    if (!v) return Number.NEGATIVE_INFINITY // undated → smallest → sorts last under DESC
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
  }
  return [...pending].sort((a, b) => {
    const aPri = priority.has(a.filename) ? 0 : 1
    const bPri = priority.has(b.filename) ? 0 : 1
    if (aPri !== bPri) return aPri - bPri
    if (aPri === 0) return 0 // both user-explicit → FIFO (stable sort keeps input order)
    const da = ms(a.recordingDate)
    const db = ms(b.recordingDate)
    if (da !== db) return db - da // recordingDate DESC (newest first)
    return 0 // FIFO tiebreak (stable sort)
  })
}

// Defect A (queued-while-disconnected fires on connect): the orchestrator owns the
// USB download loop; useDeviceSubscriptions calls this AFTER the file-list scan has
// completed on device-ready, so already-queued (scoped) pending items drain without
// racing the scan on the USB bus. No-op until the orchestrator has mounted.
let _drainQueueFn: (() => void) | null = null

export function drainDownloadQueue(): void {
  _drainQueueFn?.()
}

/**
 * Hard connectivity gate for STARTING a download session. A download must NEVER
 * touch the USB bus unless the device is genuinely connected AND past initialization
 * (step === 'ready'). Queuing while disconnected must persist the item as pending and
 * start nothing — processing then resumes automatically on connect (drainDownloadQueue).
 *
 * Both conditions are required:
 *  - isConnected() alone is insufficient: it can read true during early init steps
 *    before the device is usable (see DL-001).
 *  - step === 'ready' alone is insufficient: the store step can be stale after an
 *    undetected unplug, which is exactly how a "download" went active against a
 *    disconnected device and starved the app.
 */
export function canStartDownloadSession(isConnected: boolean, connectionStep: string): boolean {
  return isConnected && connectionStep === 'ready'
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

    // Hard connectivity gate: never start a session while disconnected. Queuing while
    // disconnected persists the item as pending and starts nothing; processing resumes
    // on connect via drainDownloadQueue(). Bail BEFORE mutating any sync/queue state.
    if (!canStartDownloadSession(deviceService.isConnected(), useAppStore.getState().connectionStatus.step)) {
      if (shouldLogQa()) console.log('[useDownloadOrchestrator] Not starting downloads — device not connected/ready')
      isProcessingDownloads.current = false
      return
    }

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
    // Recency-first: order the batch newest-first (user-explicit requests jump ahead).
    const pendingItems = orderDownloadsForProcessing(
      selectDownloadsToProcess(allPending, _requestedDownloads, autoDownload),
      _priorityDownloads
    )

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
    const initialTotal = pendingItems.length
    // Guards against re-selecting an item that already failed this run (failed items
    // stay 'pending' in the queue so they retry on the NEXT session, not this one).
    const processedThisRun = new Set<string>()

    // Re-select the next item from fresh queue state on every dequeue so a
    // newly-detected newer recording — or a user-explicit request — preempts the
    // remaining backlog immediately (recency-first, mirroring the transcription queue).
    while (true) {
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

      // Fresh snapshot → scope → recency order → first not-yet-attempted item.
      const freshState = await window.electronAPI.downloadService.getState()
      const freshPending = freshState.queue.filter((i: DownloadQueueItem) => i.status === 'pending')
      const ordered = orderDownloadsForProcessing(
        selectDownloadsToProcess(freshPending, _requestedDownloads, autoDownload),
        _priorityDownloads
      )
      const item = ordered.find((i) => !processedThisRun.has(i.filename))
      if (!item) break
      processedThisRun.add(item.filename)

      setDeviceSyncState({
        deviceFileDownloading: item.filename,
        deviceSyncProgress: { current: completed, total: Math.max(initialTotal, completed + failed + 1) },
        deviceFileProgress: 0
      })

      currentlyDownloadingRef.current = item.filename
      const success = await processDownload(item, downloadAbortControllerRef.current.signal)
      currentlyDownloadingRef.current = null
      if (success) {
        completed++
        bytesDownloaded += item.fileSize || 0
        // Consume the scope/priority entries only once the file is actually downloaded;
        // failed items stay scoped so a retry re-processes them (auto-download OFF).
        _requestedDownloads.delete(item.filename)
        clearDownloadPriority(item.filename)
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

    // Defect A: expose the queue drain so useDeviceSubscriptions can fire already-queued
    // pending downloads once the device is ready and the file-list scan has completed.
    _drainQueueFn = () => {
      if (!isProcessingDownloads.current) processDownloadQueueRef.current()
    }

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
          // Strict connectivity gate (DL-001 + disconnected-download evidence): require BOTH
          // a live connection AND step === 'ready'. A pending item queued while disconnected
          // must NOT start here — it waits for the connect-driven drain instead.
          const step = useAppStore.getState().connectionStatus.step
          if (hasPending && !isProcessingDownloads.current && canStartDownloadSession(deviceService.isConnected(), step)) {
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
        // Only retry INTERRUPTED items on reconnect — don't process the full pending queue.
        // Pending items will be processed when auto-sync calls startSession.
        // MEDIUM-4: include disconnect-'cancelled' (cancelActiveDownloads persists an
        // interrupted transfer as 'cancelled'); retrying only 'failed' stranded them.
        // HIGH-3: but a USER-cancelled download must NOT resurrect here — isRetryable*
        // excludes cancelReason==='user', and retryFailed(_, interruptedOnly=true) skips
        // it too, so a deliberate cancel stays terminal until a manual Retry.
        window.electronAPI.downloadService.getState().then((state) => {
          const hasRetryable = state.queue.some((item: DownloadQueueItem) => isRetryableDownloadItem(item))
          if (hasRetryable) {
            if (shouldLogQa()) console.log('[useDownloadOrchestrator] Device ready, retrying interrupted downloads')
            window.electronAPI.downloadService.retryFailed(true, true) // deviceConnected, interruptedOnly
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
      _drainQueueFn = null
      unsubDownloads()
      unsubDevice()
      // SM-002: Do NOT reset orchestratorInitialized.current here.
      // StrictMode does mount -> cleanup -> mount; resetting allows double subscription.
      // When the component truly unmounts and remounts, React creates a NEW ref(false).
    }
  // DL-11: Only depend on deviceService (stable singleton). processDownloadQueue
  // is accessed via ref so changes don't cause re-subscription.
  }, [deviceService])
}
