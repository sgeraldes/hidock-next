/**
 * Device sync actions — recording-aware re-sync (2026-07-22).
 *
 * THE PROBLEM: auto-sync fired ONCE on connect, then never again. Worse, the
 * device service's file-list cache is COUNT-BASED (`listRecordings` returns the
 * cache whenever `cachedRecordingCount === state.recordingCount`, even with
 * forceRefresh), and `state.recordingCount` is only refreshed at connect — so
 * after a recording session nothing could ever observe the new file until a
 * disconnect/reconnect.
 *
 * THE MODEL (owner spec):
 * - The CMD-18 recording-state poll is the authoritative dirty signal. When
 *   the device is RECORDING, the file list is dirty — marked ONCE per
 *   recording session (not re-marked on every poll of the same session).
 * - When recording STOPS, wait for the device to finalize the file, then
 *   rescan + reconcile ONCE — even if the file count appears unchanged.
 * - At recording START, probe the (cheap) file count: if files from BEFORE
 *   this session are waiting, sync them while the recording runs (HiNotes
 *   parity). The in-progress file itself is always excluded from downloads.
 * - A slow periodic count probe is the safety net for files that appeared
 *   without a seen recording state (device recorded while disconnected).
 * - A manual trigger (Library Refresh) always scans and always downloads new
 *   files — an explicit user request, not subject to the auto-download toggle.
 *
 * Everything routes through the SAME serialized device path the connect-time
 * auto-sync uses (deviceService.listRecordings → downloadService.getFilesToSync
 * → startSession), so USB discipline (no interleaving) is preserved.
 */

import { getHiDockDeviceService } from '@/services/hidock-device'
import { useAppStore } from '@/store/useAppStore'
import { checkAutoSyncAllowed } from '@/utils/autoSyncGuard'
import { requestScopedDownloads, drainDownloadQueue } from '@/hooks/useDownloadOrchestrator'

export type SyncTrigger = 'recording-started' | 'recording-stopped' | 'periodic' | 'manual'

export interface ReconcileOutcome {
  /** Device files needing download after reconciliation (active recording excluded). */
  newFiles: number
  /** Files actually queued for download (0 when auto-download is off and the trigger is not manual). */
  downloaded: number
  /** Total files currently on the device. */
  deviceFileCount: number
  /** True when no USB scan was needed (count unchanged, not dirty). */
  skippedScan: boolean
}

// ── Module state ────────────────────────────────────────────────────────────

let scanInFlight = false
/** True after a recording START was observed and not yet reconciled. Set ONCE
 *  per recording session — never re-marked by subsequent polls of the same
 *  session (owner spec: the dirty mark is per session, not per poll tick). */
let listDirty = false
/** True while the dirty mark belongs to the CURRENTLY recording session. A
 *  re-notified start for the same session must not trigger a backlog scan —
 *  only a dirty mark PREDATING the session (a previous stop we never
 *  reconciled) or a count move may. */
let dirtyFromActiveSession = false
/** Device file count known-good as of the last scan/baseline (-1 = unknown). */
let lastScanCount = -1
/** Timestamp of the last completed scan (debounce for periodic probes). */
let lastScanAt = 0

/** Device finalize grace after the stop signal before reading the list. */
const FINALIZE_DELAY_MS = 5_000
/** Re-arm delay when a stop-reconcile finds another scan in flight. */
const RETRY_DELAY_MS = 15_000
/** Minimum gap between periodic scans (event-driven triggers bypass this). */
const PERIODIC_MIN_INTERVAL_MS = 90_000

// ── State surface (tests + diagnostics) ─────────────────────────────────────

export function isListDirty(): boolean {
  return listDirty
}

export function isScanInFlight(): boolean {
  return scanInFlight
}

export function getLastScanCount(): number {
  return lastScanCount
}

/** Test hook: reset all module state (including the pending stop timer). */
export function __resetDeviceSyncState(): void {
  scanInFlight = false
  listDirty = false
  dirtyFromActiveSession = false
  lastScanCount = -1
  lastScanAt = 0
  if (stopTimer) {
    clearTimeout(stopTimer)
    stopTimer = null
  }
}

// ── Count probe ─────────────────────────────────────────────────────────────

/** Cheap one-command count read; also refreshes deviceService.state.recordingCount
 *  so the service's own count-based cache can miss naturally on the next scan. */
async function probeCount(): Promise<number | null> {
  try {
    return await getHiDockDeviceService().getRecordingCount()
  } catch {
    return null
  }
}

// ── Reconcile ───────────────────────────────────────────────────────────────

/**
 * Probe the device count, rescan when warranted, reconcile against the
 * library, and queue downloads per the trigger's rules.
 *
 * Guards:
 * - device must be connected;
 * - one scan at a time (callers re-arm if they need a later run);
 * - 'periodic' is debounced to PERIODIC_MIN_INTERVAL_MS between scans;
 * - downloads: 'manual' always queues new files; other triggers queue only
 *   when the auto-download toggle is on (the view still refreshes either way,
 *   so new device files become visible as device-only rows);
 * - the in-progress recording (activeRecordingFilename) is NEVER queued.
 */
export async function scanAndReconcile(
  trigger: SyncTrigger,
  opts: { probedCount?: number | null } = {}
): Promise<ReconcileOutcome | null> {
  const deviceService = getHiDockDeviceService()
  if (!deviceService.isConnected()) return null
  if (scanInFlight) return null
  if (trigger === 'periodic' && lastScanCount >= 0 && Date.now() - lastScanAt < PERIODIC_MIN_INTERVAL_MS) {
    return null
  }

  scanInFlight = true
  try {
    const probed = opts.probedCount !== undefined ? opts.probedCount : await probeCount()

    // Baseline: we have never scanned. The connect path owns the initial sync —
    // adopt the probed count as the known-good baseline instead of double-scanning.
    if (lastScanCount < 0 && trigger !== 'manual') {
      lastScanCount = probed ?? deviceService.getCachedRecordings().length
      lastScanAt = Date.now()
      return null
    }

    // The service cache is current when its length matches the probed count (the
    // cache is only ever filled by a full scan; invalidations null it). When it
    // is current and nothing is dirty, a scan would re-read the same list — skip
    // the USB round trip. 'manual' still reconciles the cached list (that is the
    // "force sync check" the button promises) without paying for a 90s rescan.
    // A dirty mark from a COMPLETED session forces the rescan (its file is not
    // in the count-locked cache); a dirty mark from the ACTIVE session does not
    // — nothing new has finalized yet, and the stop will reconcile.
    // EXCEPTION: if the count moved since our baseline AND the service cache
    // already matches it, someone else (connect-time auto-sync) just scanned —
    // adopt their fresh cache instead of paying for a duplicate USB scan.
    const cacheCurrent = probed !== null && probed === deviceService.getCachedRecordings().length
    const cacheFreshEnough = cacheCurrent && probed !== null && probed !== lastScanCount
    const staleDirty = listDirty && !dirtyFromActiveSession
    const mustScan = (staleDirty && !cacheFreshEnough) || !cacheCurrent
    if (!mustScan && trigger !== 'manual') {
      lastScanCount = probed ?? lastScanCount
      lastScanAt = Date.now()
      return { newFiles: 0, downloaded: 0, deviceFileCount: probed ?? lastScanCount, skippedScan: true }
    }

    let recordings
    if (mustScan) {
      // Owner spec: a seen recording session means the list is dirty even when
      // the count did not move — the count-based cache would hide that, force it.
      if (staleDirty && cacheCurrent) {
        deviceService.invalidateRecordingsCache()
      }
      recordings = await deviceService.listRecordings(undefined, true)
    } else {
      recordings = deviceService.getCachedRecordings()
    }
    const deviceFileCount = recordings.length

    const activeFile = useAppStore.getState().activeRecordingFilename
    const reconcileResults = await window.electronAPI.downloadService.getFilesToSync(
      recordings.map((rec) => ({
        filename: rec.filename,
        size: rec.size,
        duration: rec.duration,
        dateCreated: rec.dateCreated,
      }))
    )
    const toSync = reconcileResults.filter((r) => !r.skipReason && r.filename !== activeFile)

    const { allowed } = checkAutoSyncAllowed()
    const shouldDownload = toSync.length > 0 && (trigger === 'manual' || allowed)
    let downloaded = 0
    if (shouldDownload) {
      const filesToQueue = toSync.map((rec) => ({
        filename: rec.filename,
        size: rec.size,
        dateCreated: rec.dateCreated?.toISOString(),
      }))
      // Scoped registration: these process even with auto-download off (manual),
      // mirroring the connect-time auto-sync path.
      requestScopedDownloads(filesToQueue.map((f) => f.filename))
      await window.electronAPI.downloadService.startSession(filesToQueue)
      downloaded = toSync.length
      deviceService.log('info', 'Auto-sync triggered', `${downloaded} new recording(s) to download (${trigger})`)
      useAppStore.getState().setDeviceSyncState({
        deviceSyncing: true,
        deviceSyncProgress: { total: toSync.length, current: 0 },
        deviceFileDownloading: toSync[0]?.filename ?? null,
      })
      // Do not rely solely on the asynchronous state-update broadcast to begin
      // execution. A completed reconcile owns an explicit queue-drain handoff.
      drainDownloadQueue()
    } else if (toSync.length > 0) {
      deviceService.log('info', 'New files on device', `${toSync.length} new file(s) — auto-download off`)
    }

    lastScanCount = deviceFileCount
    lastScanAt = Date.now()
    // The reconcile covers everything currently on the device — but if a
    // recording is STILL in progress, its file is not finalized yet, so the
    // list remains dirty for that session and the stop must reconcile again.
    const stillRecording = !!useAppStore.getState().activeRecordingFilename
    listDirty = stillRecording
    dirtyFromActiveSession = stillRecording

    // Rebuild the unified view — the device cache changed regardless of downloads.
    window.dispatchEvent(new Event('hidock:downloads-completed'))

    return { newFiles: toSync.length, downloaded, deviceFileCount, skippedScan: !mustScan }
  } finally {
    scanInFlight = false
  }
}

// ── Recording-state consumption (called from useDeviceSubscriptions) ────────

let stopTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Recording START observed. Mark the list dirty ONCE for this session, then
 * probe the count: files waiting from BEFORE this session (count moved, or an
 * earlier dirty mark was never reconciled) are synced now, while the recording
 * runs. The in-progress file is excluded from downloads inside the reconcile.
 */
export async function handleRecordingStart(): Promise<void> {
  const dirtyPredatingSession = listDirty && !dirtyFromActiveSession
  if (!listDirty) {
    listDirty = true
    console.log('[DeviceSync] Recording started — device file list marked dirty')
  }
  dirtyFromActiveSession = true
  const probed = await probeCount()
  const countChanged = probed !== null && lastScanCount >= 0 && probed !== lastScanCount
  if (dirtyPredatingSession || countChanged) {
    void scanAndReconcile('recording-started', { probedCount: probed })
  }
}

/**
 * Recording STOP observed. Wait for the device to finalize the file, then run
 * exactly one reconcile — even if the count appears unchanged (owner spec).
 * If another scan is in flight when the timer fires, re-arm: the dirty mark is
 * only cleared by a completed scan, so the reconcile is never lost.
 */
export function handleRecordingStop(delayMs: number = FINALIZE_DELAY_MS): void {
  dirtyFromActiveSession = false
  if (!listDirty) return // a stop we never saw a start for (already reconciled)
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = setTimeout(() => {
    stopTimer = null
    if (scanInFlight) {
      handleRecordingStop(RETRY_DELAY_MS)
      return
    }
    void scanAndReconcile('recording-stopped')
  }, delayMs)
}

/**
 * Slow safety-net probe (call on an interval). Picks up files that appeared
 * without a seen recording session (recorded while disconnected, missed poll).
 * Debounced inside scanAndReconcile.
 */
export function periodicCountCheck(): void {
  if (!getHiDockDeviceService().isConnected()) return
  void scanAndReconcile('periodic')
}
