/**
 * DownloadService - Centralized background download manager
 *
 * This service runs in the main process and manages all device file downloads.
 * It persists across renderer navigation - downloads continue regardless of which page is shown.
 *
 * Key responsibilities:
 * - Maintain download queue state
 * - Handle USB file transfers via device service
 * - Track sync status in database
 * - Emit progress events to renderer
 * - Prevent duplicate downloads
 * - Handle errors gracefully with user notification
 */

import { BrowserWindow, ipcMain, Notification } from 'electron'
import {
  markRecordingDownloaded,
  addSyncedFile,
  isFileSynced,
  getRecordingByFilename,
  getSyncedFilenames,
  queryOne,
  queryAll,
  run,
  runInTransaction
} from './database'
import { saveRecording, getRecordingsPath } from './file-storage'
import { emitActivityLog } from './activity-log'
import { cancelActiveTransfer, cancelActiveTransferByName, getActiveTransferFilename } from './download-transfer-controller'
import { existsSync } from 'fs'
import { join, basename } from 'path'

// Download queue item
// C-004: Added 'cancelled' status to distinguish user cancellations from actual failures
// Phase-1 cancellation: 'cancelling' is a TRANSIENT status emitted to the renderer
// while the in-flight USB transfer is being aborted + settled. It is never persisted
// (the durable terminal state is 'cancelled'); a crash mid-cancel leaves the DB row at
// its prior 'downloading'/'pending' value, which reconciliation handles.
export interface DownloadQueueItem {
  id: string
  filename: string
  fileSize: number
  progress: number
  status: 'pending' | 'downloading' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
  error?: string
  startedAt?: Date
  // Set when the item reaches ANY terminal state (completed, failed, cancelled) —
  // not just success. It is the primary AGE SOURCE for the 24h terminal-row prune:
  // startedAt alone never exists for items cancelled while still PENDING, which let
  // those rows (and their DB counterparts) grow without bound.
  completedAt?: Date
  // When the item was first queued (DB created_at on reload). Last-resort prune age
  // source for legacy rows that predate terminal-state stamping.
  createdAt?: Date
  recordingDate?: Date // Original recording date from device
  lastProgressAt?: Date // C-004: Track last progress update for smarter stall detection
  // HIGH-3 (Codex): origin of a 'cancelled' status. 'user' = the user deliberately
  // cancelled — terminal-suppressed from auto-retry AND from reconciliation
  // re-queue until the user acts again (manual Retry, or an explicit re-download).
  // 'interrupted' = disconnect/re-sync aborted it mid-flight; auto-retried on
  // reconnect. DURABLE: persisted to download_queue.cancel_reason (schema v40) and
  // user-cancelled rows are reloaded on startup, so a deliberate cancel survives an
  // app restart instead of resurrecting via post-restart reconciliation.
  cancelReason?: 'user' | 'interrupted'
}

// Sync session state
export interface SyncSession {
  id: string
  totalFiles: number
  completedFiles: number
  failedFiles: number
  startedAt: Date
  status: 'active' | 'completed' | 'cancelled' | 'failed'
}

// Service state
interface DownloadServiceState {
  queue: Map<string, DownloadQueueItem>
  currentSession: SyncSession | null
  isProcessing: boolean
  isPaused: boolean
}

// Exported so tests can construct a FRESH instance to simulate an app restart
// (the module normally uses only the getDownloadService() singleton below).
export class DownloadService {
  private state: DownloadServiceState = {
    queue: new Map(),
    currentSession: null,
    isProcessing: false,
    isPaused: false
  }
  private stalledCheckInterval: NodeJS.Timeout | null = null // spec-007: periodic stalled check
  private cancelLock = false

  // B-DWN-009: Dirty-flag caching for getState() to avoid creating new arrays on every call
  private dirty = true
  private cachedQueueArray: DownloadQueueItem[] = []

  private pruneInterval: NodeJS.Timeout | null = null // MEDIUM (re-review): bounded periodic prune

  constructor() {
    console.log('[DownloadService] Initialized')
    this.loadQueueFromDatabase()
    // MEDIUM (re-review): prune terminal rows at STARTUP — the prune used to run only
    // after successful completions, so reloaded >24h user-cancelled rows never aged out.
    this.pruneCompletedItems(10)
    this.startStalledCheckInterval() // spec-007: start periodic timeout detection
    this.startPruneInterval()
  }

  /**
   * B-DWN-009: Mark the cached queue array as dirty so getState() rebuilds it
   */
  private markDirty(): void {
    this.dirty = true
  }

  /**
   * True when the item is in (or transitioning into) a user-cancelled terminal state.
   * Read through this helper — not an inline `item.status === ...` — because callers
   * check it AFTER assigning `item.status = 'downloading'`, and a concurrent cancel
   * mutates the SAME object; the helper's parameter type keeps the full status union
   * so the comparison stays valid (an inline check would be narrowed to the literal).
   */
  private isCancelledStatus(item: DownloadQueueItem): boolean {
    return item.status === 'cancelling' || item.status === 'cancelled'
  }

  /**
   * B-DWN-003: Normalize .hda filenames to .mp3 extension
   * HiDock devices output .hda files which are actually MP3 format
   */
  static normalizeFilename(filename: string): string {
    return filename.replace(/\.hda$/i, '.mp3')
  }

  /**
   * spec-007: Start periodic check for stalled downloads (every 10 seconds)
   */
  private startStalledCheckInterval(): void {
    this.stalledCheckInterval = setInterval(() => {
      this.checkForStalledDownloads()
    }, 10000) // Check every 10 seconds
    console.log('[DownloadService] Started periodic stalled download check (10s interval)')
  }

  /**
   * spec-007: Stop periodic stalled check (for cleanup)
   */
  stopStalledCheckInterval(): void {
    if (this.stalledCheckInterval) {
      clearInterval(this.stalledCheckInterval)
      this.stalledCheckInterval = null
      console.log('[DownloadService] Stopped periodic stalled download check')
    }
  }

  /**
   * MEDIUM (re-review): bounded periodic prune (hourly). Terminal rows must age out
   * even in sessions where no download ever completes — previously the prune ran
   * only inside processDownload's success path.
   */
  private startPruneInterval(): void {
    const PRUNE_INTERVAL_MS = 60 * 60 * 1000 // hourly — cheap scan, bounded frequency
    this.pruneInterval = setInterval(() => {
      this.pruneCompletedItems(10)
      this.emitStateUpdate()
    }, PRUNE_INTERVAL_MS)
  }

  private stopPruneInterval(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval)
      this.pruneInterval = null
    }
  }

  /**
   * C-004: Clean up all timers (stalled check + emit throttle) for graceful shutdown.
   * Should be called before app quit to prevent leaked intervals/timeouts.
   */
  destroy(): void {
    this.stopStalledCheckInterval()
    this.stopPruneInterval()
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.emitPending = false
    console.log('[DownloadService] Destroyed (all timers cleaned up)')
  }

  /**
   * Load queue from database on startup (spec-007: persistence).
   * HIGH-3 (restart resurrection): ALSO loads user-cancelled rows — they act as
   * durable terminal-suppression markers so post-restart reconciliation cannot
   * re-queue a file the user deliberately cancelled. Interrupted cancels are NOT
   * reloaded (they are re-created as pending by reconciliation, which is correct).
   */
  private loadQueueFromDatabase(): void {
    try {
      const items = queryAll<{
        id: string
        filename: string
        file_size: number
        progress: number
        status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
        error: string | null
        started_at: string | null
        completed_at: string | null
        recording_date: string | null
        cancel_reason: 'user' | 'interrupted' | null
        created_at: string | null
      }>(`
        SELECT id, filename, file_size, progress, status, error, started_at, completed_at, recording_date, cancel_reason, created_at
        FROM download_queue
        WHERE status IN ('pending', 'downloading')
           OR (status = 'cancelled' AND cancel_reason = 'user')
        ORDER BY created_at ASC
      `)

      for (const item of items) {
        const queueItem: DownloadQueueItem = {
          id: item.id,
          filename: item.filename,
          fileSize: item.file_size,
          progress: item.progress,
          status: item.status,
          error: item.error ?? undefined,
          startedAt: item.started_at ? new Date(item.started_at) : undefined,
          completedAt: item.completed_at ? new Date(item.completed_at) : undefined,
          recordingDate: item.recording_date ? new Date(item.recording_date) : undefined,
          cancelReason: item.cancel_reason ?? undefined,
          // Prune age fallback for rows without terminal/start timestamps.
          createdAt: item.created_at ? new Date(item.created_at) : undefined
        }
        this.state.queue.set(item.filename, queueItem)
      }

      // Clear stale pending items (> 24h old) — these can never complete if the device
      // was disconnected between sessions and left downloads in a perpetual pending state.
      const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000
      const now = Date.now()
      const staleKeys: string[] = []
      for (const [key, item] of this.state.queue) {
        // Age source: startedAt when it ever started; createdAt for never-started
        // pending rows (they used to have no timestamp and lingered forever).
        const ref = item.startedAt ?? item.createdAt
        if (item.status === 'pending' && ref) {
          const age = now - ref.getTime()
          if (age > STALE_THRESHOLD_MS) {
            staleKeys.push(key)
          }
        }
      }
      if (staleKeys.length > 0) {
        for (const key of staleKeys) {
          this.state.queue.delete(key)
          this.removeFromDatabase(key)
        }
        console.log(`[DownloadService] Cleared ${staleKeys.length} stale pending item(s) older than 24h`)
      }

      this.markDirty()
      console.log(`[DownloadService] Loaded ${items.length - staleKeys.length} items from database (${staleKeys.length} stale cleared)`)
    } catch (e) {
      console.error('[DownloadService] Failed to load queue from database:', e)
    }
  }

  /**
   * Persist a queue item to database (spec-007: persistence)
   */
  private persistQueueItem(item: DownloadQueueItem): void {
    try {
      run(`
        INSERT OR REPLACE INTO download_queue
        (id, filename, file_size, progress, status, error, started_at, completed_at, recording_date, cancel_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM download_queue WHERE id = ?), datetime('now')))
      `, [
        item.id,
        item.filename,
        item.fileSize,
        item.progress,
        item.status,
        item.error ?? null,
        item.startedAt?.toISOString() ?? null,
        item.completedAt?.toISOString() ?? null,
        item.recordingDate?.toISOString() ?? null,
        item.cancelReason ?? null, // HIGH-3: durable cancellation origin (v40)
        item.id  // For COALESCE to preserve created_at
      ])
    } catch (e) {
      console.error(`[DownloadService] Failed to persist queue item ${item.filename}:`, e)
    }
  }

  /**
   * Remove item from database (spec-007: persistence)
   */
  private removeFromDatabase(filename: string): void {
    try {
      run('DELETE FROM download_queue WHERE filename = ?', [filename])
    } catch (e) {
      console.error(`[DownloadService] Failed to remove ${filename} from database:`, e)
    }
  }

  /**
   * Check if a file needs to be downloaded
   * Reconciles database, synced_files table, and actual files on disk
   * C-004: Also checks .mp3 normalized name (B-DWN-003 normalizes .hda->.mp3)
   */
  isFileAlreadySynced(filename: string): { synced: boolean; reason: string } {
    // Check 1: Is it in synced_files table?
    if (isFileSynced(filename)) {
      return { synced: true, reason: 'In synced_files table' }
    }

    // Check 2: Convert .hda to .wav and check both (legacy format)
    const wavFilename = filename.replace(/\.hda$/i, '.wav')
    if (wavFilename !== filename && isFileSynced(wavFilename)) {
      return { synced: true, reason: 'WAV version in synced_files' }
    }

    // C-004: Check 2b: Also check .mp3 normalized name (B-DWN-003 normalizes .hda->.mp3)
    const mp3Filename = DownloadService.normalizeFilename(filename)
    if (mp3Filename !== filename && mp3Filename !== wavFilename && isFileSynced(mp3Filename)) {
      return { synced: true, reason: 'MP3 version in synced_files' }
    }

    // Check 3: Check if file exists on disk (check wav and mp3 variants)
    const recordingsPath = getRecordingsPath()
    const filePath = join(recordingsPath, wavFilename)
    if (existsSync(filePath)) {
      // File exists but not in synced_files - add it!
      // BUG-R4: no per-file log here — reconciliation runs over 1000+ files and
      // this once produced 1300+ lines per sync. getFilesToSync() emits a single
      // summary line (including a reconciled count) instead.
      addSyncedFile(filename, wavFilename, filePath)
      return { synced: true, reason: 'File exists on disk (reconciled)' }
    }
    // C-004: Also check mp3 variant on disk
    if (mp3Filename !== filename && mp3Filename !== wavFilename) {
      const mp3Path = join(recordingsPath, mp3Filename)
      if (existsSync(mp3Path)) {
        // BUG-R4: no per-file log — folded into getFilesToSync() summary.
        addSyncedFile(filename, mp3Filename, mp3Path)
        return { synced: true, reason: 'MP3 file exists on disk (reconciled)' }
      }
    }

    // Check 4: Check recordings table
    const recording = getRecordingByFilename(filename) || getRecordingByFilename(wavFilename)
    if (recording && recording.file_path && existsSync(recording.file_path)) {
      // Recording exists with valid file path
      // BUG-R4: no per-file log — folded into getFilesToSync() summary.
      addSyncedFile(filename, basename(recording.file_path), recording.file_path)
      return { synced: true, reason: 'In recordings table with valid file' }
    }

    return { synced: false, reason: 'Not found anywhere' }
  }

  /**
   * Get files that need to be synced from a list
   */
  getFilesToSync(deviceFiles: Array<{ filename: string; size: number; duration: number; dateCreated: Date }>): Array<{ filename: string; size: number; duration: number; dateCreated: Date; skipReason?: string }> {
    const results: Array<{ filename: string; size: number; duration: number; dateCreated: Date; skipReason?: string }> = []
    let skippedCount = 0
    let queuedCount = 0
    let reconciledCount = 0

    for (const file of deviceFiles) {
      const { synced, reason } = this.isFileAlreadySynced(file.filename)
      if (synced) {
        skippedCount++
        // BUG-R4: files that were healed into synced_files during this pass
        // (found on disk / in recordings table) used to log one line each.
        // Count them and report the total on the single summary line below.
        if (reason.includes('reconciled') || reason === 'In recordings table with valid file') {
          reconciledCount++
        }
      } else {
        queuedCount++
      }
      results.push({ ...file, skipReason: synced ? reason : undefined })
    }

    // BUG-R4: ONE summary line per reconciliation (was 1300+ per-file lines).
    // reconciled suffix only appears when files were actually healed this pass,
    // so the steady-state line stays "N files skipped (already synced), M files queued".
    const reconciledNote = reconciledCount > 0 ? ` (${reconciledCount} reconciled from disk/recordings)` : ''
    console.log(`[DownloadService] Reconciliation: ${skippedCount} files skipped (already synced)${reconciledNote}, ${queuedCount} files queued`)
    return results
  }

  /**
   * Add files to download queue (spec-007: database duplicate check).
   *
   * HIGH-3 `explicit` flag: reconciliation/auto-sync calls (startSyncSession) leave
   * it false — a user-cancelled item is then terminal-suppressed and NOT re-queued,
   * in this session or after a restart (the suppression row is durable). An explicit
   * user action ("Download this file" from the Library) passes true, which CLEARS
   * the suppression and re-queues — equivalent to a manual Retry for that file.
   */
  queueDownloads(files: Array<{ filename: string; size: number; dateCreated?: Date }>, explicit: boolean = false): string[] {
    const queuedIds: string[] = []
    // BUG-R4: aggregate per-file skip reasons into one summary line instead of
    // logging every already-queued/already-synced file (was 1300+ lines per sync).
    let skippedInQueue = 0
    let skippedAlreadySynced = 0
    let skippedUserCancelled = 0

    for (const file of files) {
      // B-DWN-003: Normalize .hda filenames to .mp3
      const normalizedFilename = DownloadService.normalizeFilename(file.filename)

      // HIGH-3: terminal-suppression check BEFORE the generic in-queue skip. A
      // user-cancelled item stays in the queue (memory + DB) exactly so this check
      // can see it. Auto/reconciliation calls skip the file entirely; an explicit
      // user request clears the cancel and re-queues it as pending.
      const suppressed =
        this.state.queue.get(file.filename) ?? this.state.queue.get(normalizedFilename)
      if (suppressed && suppressed.status === 'cancelled' && suppressed.cancelReason === 'user') {
        if (!explicit) {
          skippedUserCancelled++
          continue
        }
        suppressed.status = 'pending'
        suppressed.progress = 0
        suppressed.error = undefined
        suppressed.cancelReason = undefined
        suppressed.startedAt = undefined
        suppressed.completedAt = undefined
        suppressed.lastProgressAt = undefined
        suppressed.fileSize = file.size || suppressed.fileSize
        suppressed.recordingDate = file.dateCreated ?? suppressed.recordingDate
        this.persistQueueItem(suppressed)
        queuedIds.push(suppressed.filename)
        console.log(`[DownloadService] Re-queued after explicit user request: ${suppressed.filename}`)
        continue
      }

      // spec-007: Check database for existing queue entry (check both original and normalized)
      const existingInDb = queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM download_queue WHERE (filename = ? OR filename = ?) AND status IN (?, ?)',
        [file.filename, normalizedFilename, 'pending', 'downloading']
      )

      if (existingInDb) {
        skippedInQueue++
        continue
      }

      // Skip if already in memory queue (check both original and normalized)
      if (this.state.queue.has(file.filename) || this.state.queue.has(normalizedFilename)) {
        skippedInQueue++
        continue
      }

      // Skip if already synced (check both original and normalized)
      const { synced } = this.isFileAlreadySynced(file.filename)
      if (synced) {
        skippedAlreadySynced++
        continue
      }
      if (normalizedFilename !== file.filename) {
        const { synced: normalizedSynced } = this.isFileAlreadySynced(normalizedFilename)
        if (normalizedSynced) {
          skippedAlreadySynced++
          continue
        }
      }

      const item: DownloadQueueItem = {
        id: file.filename, // Use original filename as ID for simplicity
        filename: file.filename,
        fileSize: file.size,
        progress: 0,
        status: 'pending',
        recordingDate: file.dateCreated, // Store the original recording date
        createdAt: new Date() // prune age fallback (DB created_at is set on persist)
      }

      this.state.queue.set(file.filename, item)
      this.persistQueueItem(item) // spec-007: persist to database
      queuedIds.push(file.filename)
      console.log(`[DownloadService] Queued: ${file.filename} (${(file.size / 1024 / 1024).toFixed(1)} MB)`)
    }

    // BUG-R4: one summary line for skipped files (only when something was skipped).
    if (skippedInQueue > 0 || skippedAlreadySynced > 0 || skippedUserCancelled > 0) {
      const userCancelledNote = skippedUserCancelled > 0
        ? `, ${skippedUserCancelled} user-cancelled (suppressed until manual retry)` : ''
      console.log(
        `[DownloadService] queueDownloads: skipped ${skippedInQueue} already queued, ${skippedAlreadySynced} already synced${userCancelledNote}`
      )
    }

    this.markDirty()
    // C-004: Emit immediately so renderer sees new queue items without throttle delay
    this.emitStateUpdate(true)
    return queuedIds
  }

  /**
   * Start a sync session
   * C-004: Uses queuedIds.length (newly queued) instead of queue.size (includes prior items)
   */
  startSyncSession(files: Array<{ filename: string; size: number; dateCreated?: Date }>): SyncSession {
    // Queue the files (including recording dates for proper date preservation)
    const queuedIds = this.queueDownloads(files)

    // C-004: Count only the pending/downloading items for this session, not completed/failed leftovers
    let pendingCount = 0
    for (const item of this.state.queue.values()) {
      if (item.status === 'pending' || item.status === 'downloading') {
        pendingCount++
      }
    }

    // Create session
    const session: SyncSession = {
      id: `sync_${Date.now()}`,
      totalFiles: pendingCount,
      completedFiles: 0,
      failedFiles: 0,
      startedAt: new Date(),
      status: 'active'
    }

    this.state.currentSession = session
    this.emitStateUpdate(true) // C-004: immediate emit for session start

    console.log(`[DownloadService] Started sync session ${session.id} with ${session.totalFiles} files (${queuedIds.length} newly queued)`)
    return session
  }

  /**
   * Process download queue - called with data from renderer
   * The actual USB communication happens in the renderer, but state is managed here
   */
  async processDownload(
    filename: string,
    data: Buffer
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    const item = this.state.queue.get(filename)
    if (!item) {
      return { success: false, error: 'File not in queue' }
    }

    // Phase-1 cancellation race: a user cancel can land AFTER the renderer already
    // finished the USB transfer and called process-download. If the item is already
    // cancelling/cancelled, do NOT overwrite it back to 'downloading' and do NOT save
    // the file — the user asked for it gone. Leave the terminal state intact.
    if (this.isCancelledStatus(item)) {
      console.log(`[DownloadService] Skipping save for ${filename} — status is '${item.status}'`)
      return { success: false, error: 'Download cancelled' }
    }

    try {
      // C-004: Validate download path exists and is writable before processing
      const recordingsPath = getRecordingsPath()
      if (!existsSync(recordingsPath)) {
        const { mkdirSync } = await import('fs')
        try {
          mkdirSync(recordingsPath, { recursive: true })
          console.log(`[DownloadService] Created recordings directory: ${recordingsPath}`)
        } catch (mkdirErr) {
          const errMsg = `Recordings directory cannot be created: ${recordingsPath}`
          console.error(`[DownloadService] ${errMsg}`, mkdirErr)
          item.status = 'failed'
          item.error = errMsg
          this.persistQueueItem(item)
          this.markDirty()
          this.emitStateUpdate(true) // C-004: immediate emit for status transition
          return { success: false, error: errMsg }
        }
      }

      item.status = 'downloading'
      item.startedAt = new Date()
      this.persistQueueItem(item) // spec-007: persist status change
      this.markDirty()
      this.emitStateUpdate(true) // C-004: immediate emit for status transition

      // DL-002: Integrity check — reject truncated transfers before saving
      if (item.fileSize && item.fileSize > 0 && data.length !== item.fileSize) {
        const errMsg = `File size mismatch: expected ${item.fileSize} bytes, received ${data.length} bytes`
        console.error(`[DownloadService] Integrity check failed: ${filename} — ${errMsg}`)
        item.status = 'failed'
        item.error = errMsg
        this.persistQueueItem(item)
        this.markDirty()
        this.emitStateUpdate(true)
        return { success: false, error: errMsg }
      }

      // Re-check RIGHT before touching disk: a cancel may have landed during the
      // integrity check / directory creation awaits above.
      if (this.isCancelledStatus(item)) {
        console.log(`[DownloadService] Aborting save for ${filename} — cancelled before write`)
        return { success: false, error: 'Download cancelled' }
      }

      // Save the file with the original recording date if available. saveRecording
      // writes to a temp `.partial` and atomically renames only after a final
      // cancellation check, so a cancel that lands mid-write never yields a visible
      // half-file (and never deletes a pre-existing valid recording — collisions get
      // a numeric suffix). isCancelled() is re-evaluated inside, just before rename.
      const filePath = await saveRecording(filename, data, undefined, item.recordingDate, {
        isCancelled: () => this.isCancelledStatus(item),
      })

      if (filePath === null) {
        // Cancelled between the check above and the rename — temp file was cleaned up.
        console.log(`[DownloadService] Save cancelled for ${filename} (no file written)`)
        return { success: false, error: 'Download cancelled' }
      }

      // Final guard before persisting DB rows: never write synced_files/recordings for
      // a file the user cancelled (a late completion must not resurrect it as synced).
      if (this.isCancelledStatus(item)) {
        console.log(`[DownloadService] Discarding completed save for ${filename} — cancelled`)
        return { success: false, error: 'Download cancelled' }
      }

      // Update database. markRecordingDownloaded matches any extension variant
      // (.hda device name vs .wav local name) and creates the recordings row
      // itself when none exists, so downloads never race the file watcher.
      addSyncedFile(filename, basename(filePath), filePath, data.length)
      const recordingId = markRecordingDownloaded(filename, filePath, {
        fileSize: data.length,
        dateRecorded: item.recordingDate?.toISOString()
      })

      // Update queue item
      item.status = 'completed'
      item.progress = 100
      item.completedAt = new Date()
      this.persistQueueItem(item) // spec-007: persist completion

      // Update session
      if (this.state.currentSession) {
        this.state.currentSession.completedFiles++
      }

      this.markDirty()
      this.emitStateUpdate(true) // C-004: immediate emit for completion

      import('./transcription').then(({ queueTranscriptionIfEnabled }) => {
        queueTranscriptionIfEnabled(recordingId)
      }).catch(err => {
        console.error('[DownloadService] Failed to import transcription service:', err)
      })

      // DL-07: Clean up completed items from queue after emitting final state.
      // Keep them briefly so the renderer sees the 100% state, then remove.
      setTimeout(() => {
        this.state.queue.delete(filename)
        this.removeFromDatabase(filename) // spec-007: remove from database
        // B-DWN-002: Reduced prune threshold from 50 to 10 to prevent memory leaks
        this.pruneCompletedItems(10)
        this.markDirty()
        this.emitStateUpdate()
      }, 2000)

      console.log(`[DownloadService] Completed: ${filename}`)
      return { success: true, filePath }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[DownloadService] Failed: ${filename} - ${errorMsg}`)

      item.status = 'failed'
      item.error = errorMsg
      this.persistQueueItem(item) // spec-007: persist failure

      if (this.state.currentSession) {
        this.state.currentSession.failedFiles++
      }

      this.markDirty()
      this.emitStateUpdate(true) // C-004: immediate emit for failure
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Cancel a specific download (spec-004).
   * C-004: Uses 'cancelled' status to distinguish from actual failures.
   *
   * Phase-1 cancellation: this now ALSO aborts the in-flight USB transfer for this
   * file (via the shared download-transfer-controller) and resolves only AFTER the
   * device has settled — so a caller can `await` a real completion, and the renderer
   * no longer has to separately abort the transfer. If the file's transfer is
   * actively streaming, the item briefly shows 'cancelling' (emitted to the UI) until
   * the abort settles; a still-'pending' item (not on the bus) goes straight to
   * 'cancelled'.
   */
  async cancelDownload(filename: string): Promise<{ success: boolean; error?: string }> {
    const item = this.state.queue.get(filename)
    if (!item) {
      return { success: false, error: 'Download not found in queue' }
    }

    if (item.status !== 'pending' && item.status !== 'downloading') {
      return { success: false, error: `Cannot cancel download with status: ${item.status}` }
    }

    // If THIS file is the transfer currently streaming on the USB bus, abort it and
    // wait for the device to settle before marking the item terminal.
    if (getActiveTransferFilename() === filename) {
      item.status = 'cancelling' // transient — emitted so the UI can show a spinner
      this.markDirty()
      this.emitStateUpdate(true)
      await cancelActiveTransferByName(filename, 'user-cancel')
    }

    item.status = 'cancelled'
    item.error = 'Cancelled by user'
    item.cancelReason = 'user' // HIGH-3: deliberate cancel — no auto-retry on reconnect
    item.completedAt = new Date() // terminal-state stamp: prune age source (works for pending cancels too)
    this.persistQueueItem(item) // spec-007: persist cancellation (durable suppression row)
    emitActivityLog('info', `Download cancelled: ${filename}`)
    console.log(`[DownloadService] Cancelled download: ${filename}`)
    this.markDirty()
    this.emitStateUpdate(true) // C-004: immediate emit for cancellation

    // HIGH-3: NO delayed cleanup (formerly B-DWN-006's 5s delete). The retained
    // 'cancelled' + cancel_reason='user' row IS the terminal-suppression marker —
    // deleting it would let the next reconciliation pass (or a restart) re-queue a
    // file the user deliberately cancelled. It clears via manual Retry, an explicit
    // re-download, clearCompleted(), or the 24h failed/cancelled prune.

    return { success: true }
  }

  /**
   * Update progress for a download (spec-007: persist progress periodically)
   * C-004: Tracks lastProgressAt for smarter stall detection based on data flow
   */
  updateProgress(filename: string, bytesReceived: number): void {
    const item = this.state.queue.get(filename)
    if (item) {
      const statusTransition = item.status === 'pending'
      if (statusTransition) {
        item.status = 'downloading'
        item.startedAt = new Date()
      }
      // C-004: Track last progress time for stall detection
      item.lastProgressAt = new Date()

      // C-004: Guard against NaN when fileSize is 0 or undefined
      const rawProgress = item.fileSize > 0 ? (bytesReceived / item.fileSize) * 100 : 0
      item.progress = Math.round(Number.isFinite(rawProgress) ? rawProgress : 0)

      // Persist ONLY the pending -> downloading status transition, never the
      // progress percentage. Progress lives in memory + throttled IPC; writing
      // it to the DB on every 10% was a per-file multiplier on the full-DB save
      // storm that froze the main thread. On restart an incomplete download is
      // re-attempted from scratch, so the exact mid-download percentage is not
      // worth a database write.
      if (statusTransition) {
        this.persistQueueItem(item)
      }

      this.markDirty()
      // C-004: Status transitions (pending->downloading) emit immediately to avoid UI lag;
      // pure progress updates use throttle to avoid IPC spam
      this.emitStateUpdate(statusTransition)
    }
  }

  /**
   * Mark download as failed (spec-007: persist failure)
   */
  markFailed(filename: string, error: string): void {
    const item = this.state.queue.get(filename)
    if (item) {
      // Phase-1 cancellation: never downgrade a user cancel to 'failed'. When a cancel
      // aborts the in-flight USB transfer, the renderer's transfer call returns false
      // and its error path calls markFailed — that must NOT clobber the 'cancelling'/
      // 'cancelled' state (which would make it look retryable and resurrect on
      // reconnect). A deliberate cancel stays terminal until an explicit retry.
      if (item.status === 'cancelling' || item.status === 'cancelled') {
        console.log(`[DownloadService] Ignoring markFailed for ${filename} — status is '${item.status}'`)
        return
      }
      item.status = 'failed'
      item.error = error
      item.completedAt = new Date() // terminal-state stamp: prune age source
      this.persistQueueItem(item) // spec-007: persist failure
      emitActivityLog('error', `Download failed: ${filename}`, error)

      if (this.state.currentSession) {
        this.state.currentSession.failedFiles++
      }

      this.markDirty()
      // C-004: Status transitions emit immediately to prevent stale UI
      this.emitStateUpdate(true)
    }
  }

  /**
   * spec-007: Check for stalled downloads and mark as failed
   * Called periodically to detect downloads that exceed timeout
   * C-004: Uses lastProgressAt (not startedAt) for smarter stall detection.
   * Large files legitimately take a long time; what matters is whether data
   * is still flowing.
   * AUD4-005: Adaptive timeout based on file size to reduce false positives.
   *   - Files > 10MB: 120s without progress
   *   - Unknown file size: 90s without progress
   *   - All others: 60s without progress
   */
  checkForStalledDownloads(): number {
    const STALL_TIMEOUT_DEFAULT_MS = 60000
    const STALL_TIMEOUT_LARGE_FILE_MS = 120000  // AUD4-005: 120s for files > 10MB
    const STALL_TIMEOUT_UNKNOWN_SIZE_MS = 90000  // AUD4-005: 90s when file size unknown
    const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024 // 10MB

    const now = Date.now()
    let stalledCount = 0
    const stalledFilenames: string[] = []

    for (const item of this.state.queue.values()) {
      if (item.status === 'downloading' && item.startedAt) {
        // C-004: Use lastProgressAt if available (data flow), fall back to startedAt
        const lastActivity = item.lastProgressAt ?? item.startedAt
        const elapsed = now - lastActivity.getTime()

        // AUD4-005: Adaptive timeout based on file size
        let stallTimeout: number
        if (!item.fileSize || item.fileSize <= 0) {
          stallTimeout = STALL_TIMEOUT_UNKNOWN_SIZE_MS
        } else if (item.fileSize > LARGE_FILE_THRESHOLD) {
          stallTimeout = STALL_TIMEOUT_LARGE_FILE_MS
        } else {
          stallTimeout = STALL_TIMEOUT_DEFAULT_MS
        }

        if (elapsed > stallTimeout) {
          const stallMsg = `Download stalled (${Math.round(elapsed / 1000)}s without data)`
          console.warn(`[DownloadService] Stall detected for ${item.filename} (${Math.round(elapsed / 1000)}s without progress, timeout=${stallTimeout / 1000}s, size=${item.fileSize})`)
          item.status = 'failed'
          item.error = stallMsg
          item.completedAt = new Date() // terminal-state stamp: prune age source
          this.persistQueueItem(item)
          emitActivityLog('warning', `Download stalled: ${item.filename}`, stallMsg)

          if (this.state.currentSession) {
            this.state.currentSession.failedFiles++
          }

          stalledFilenames.push(item.filename)
          stalledCount++
        }
      }
    }

    // B-DWN-001: Clean up stalled items from the queue after marking failed
    if (stalledCount > 0) {
      this.markDirty()
      this.emitStateUpdate(true) // C-004: immediate emit for stalled detection

      // Delayed cleanup: remove stalled items from queue after renderer sees the failed state
      setTimeout(() => {
        for (const filename of stalledFilenames) {
          this.state.queue.delete(filename)
          this.removeFromDatabase(filename)
        }
        this.markDirty()
        this.emitStateUpdate()
      }, 5000)
    }

    return stalledCount
  }

  /**
   * spec-007: Cancel active downloads (e.g., on device disconnect).
   * Only marks 'downloading' items as cancelled — 'pending' items are preserved
   * so they can be retried when the device reconnects.
   */
  cancelActiveDownloads(reason: string = 'Cancelled', origin: 'user' | 'interrupted' = 'interrupted'): number {
    let cancelledCount = 0

    for (const item of this.state.queue.values()) {
      if (item.status === 'downloading') {
        item.status = 'cancelled'
        item.error = reason
        // HIGH-3: record WHY. Disconnect/re-sync = 'interrupted' (reconnect auto-retries);
        // an explicit user cancel routed through here passes origin 'user' (stays terminal).
        item.cancelReason = origin
        item.completedAt = new Date() // terminal-state stamp: prune age source
        this.persistQueueItem(item)

        cancelledCount++
        console.log(`[DownloadService] Cancelled active download: ${item.filename} - ${reason}`)
      }
    }

    if (cancelledCount > 0) {
      this.markDirty()
      this.emitStateUpdate(true)
    }

    return cancelledCount
  }

  /**
   * Re-queue all failed downloads as pending so they can be retried
   */
  /**
   * Re-queue all failed/cancelled downloads as pending so they can be retried.
   * B-DWN-007: Checks if file is already synced before retrying.
   * C-004: Also retries cancelled items, not just failed.
   */
  retryFailed(deviceConnected: boolean = true, interruptedOnly: boolean = false): { count: number; error?: string } {
    // AUD4-016: Check if device is connected before retrying
    if (!deviceConnected) {
      console.warn('[DownloadService] retryFailed called but device is not connected')
      return { count: 0, error: 'Device not connected' }
    }

    let count = 0
    const alreadySynced: string[] = []

    for (const [key, item] of this.state.queue) {
      if (item.status === 'failed' || item.status === 'cancelled') {
        // HIGH-3: the automatic reconnect retry passes interruptedOnly — it must
        // re-queue ONLY disconnect-interrupted work, never a deliberate user cancel
        // (which stays terminal until a MANUAL retry, where interruptedOnly is false).
        if (interruptedOnly && item.status === 'cancelled' && item.cancelReason === 'user') {
          continue
        }

        // B-DWN-007: Check if file was synced in the meantime
        const { synced, reason } = this.isFileAlreadySynced(item.filename)
        if (synced) {
          console.log(`[DownloadService] Skipping retry for ${item.filename}: ${reason}`)
          alreadySynced.push(key)
          continue
        }

        item.status = 'pending'
        item.progress = 0
        item.error = undefined
        item.cancelReason = undefined // cleared on re-queue; a re-fail is re-tagged fresh
        item.startedAt = undefined
        item.completedAt = undefined
        item.lastProgressAt = undefined
        this.persistQueueItem(item) // spec-007: persist retry
        count++
      }
    }

    // Remove already-synced items from queue
    for (const key of alreadySynced) {
      this.state.queue.delete(key)
      this.removeFromDatabase(key)
    }

    if (count > 0 || alreadySynced.length > 0) {
      this.state.isPaused = false
      this.markDirty()
      this.emitStateUpdate(true) // C-004: immediate emit for retry status changes
    }

    return { count }
  }

  /**
   * DL-07: Prune completed items from queue, keeping at most maxRetained.
   * B-DWN-002: Reduced threshold to 10, also auto-prunes failed/cancelled items older than 24h.
   * C-004: Fixed Map iteration during modification bug - collect keys first, then delete.
   * C-004: Also removes pruned items from database for persistence consistency.
   */
  private pruneCompletedItems(maxRetained: number): void {
    const completed: string[] = []
    const toRemoveStale: string[] = []
    const now = Date.now()
    const FAILED_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

    for (const [key, item] of this.state.queue) {
      if (item.status === 'completed') {
        completed.push(key)
      }

      // B-DWN-002: Auto-prune failed/cancelled items older than 24h to prevent memory leaks.
      // MEDIUM (re-review): age source is completedAt (terminal-state stamp) with
      // startedAt/createdAt fallbacks — keying on startedAt alone meant an item
      // cancelled while still PENDING (no startedAt) was NEVER pruned, so its row
      // reloaded forever and the queue/table grew without bound. A terminal row with
      // no timestamp at all is legacy garbage — prune it immediately.
      if (item.status === 'failed' || item.status === 'cancelled') {
        const ref = item.completedAt ?? item.startedAt ?? item.createdAt
        if (!ref || now - ref.getTime() > FAILED_MAX_AGE_MS) {
          toRemoveStale.push(key)
        }
      }
    }

    // C-004: Delete stale failed/cancelled items after iteration (safe)
    for (const key of toRemoveStale) {
      this.state.queue.delete(key)
      this.removeFromDatabase(key)
    }

    // Remove oldest completed first (beyond the retention limit)
    if (completed.length > maxRetained) {
      const toRemove = completed.slice(0, completed.length - maxRetained)
      for (const key of toRemove) {
        this.state.queue.delete(key)
        this.removeFromDatabase(key) // C-004: Also clean up database
      }
    }

    this.markDirty()
  }

  /**
   * Remove completed/failed/cancelled items from queue
   * B-DWN-004: Also removes from database for persistence consistency
   * C-004: Also clears cancelled items; collects keys before deletion to avoid Map mutation during iteration
   */
  clearCompleted(): void {
    const toDelete: string[] = []
    for (const [key, item] of this.state.queue) {
      if (item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') {
        toDelete.push(key)
      }
    }
    for (const key of toDelete) {
      this.removeFromDatabase(key) // B-DWN-004: remove from database too
      this.state.queue.delete(key)
    }
    this.markDirty()
    this.emitStateUpdate(true) // C-004: immediate emit for clear
  }

  /**
   * Cancel all pending + in-progress downloads.
   * B-DWN-005: Persist cancelled state for each item
   * C-004: Uses 'cancelled' status instead of 'failed' for user-initiated cancellation
   * AUD4-008: Re-entrancy guard + batch SQLite writes in a transaction
   *
   * Phase-1 cancellation: also aborts the in-flight USB transfer (via the shared
   * download-transfer-controller) and resolves only AFTER the device has settled, so
   * the whole queue — including the one file actively streaming — is truly stopped.
   * Emptying the pending set additionally lets the renderer's download loop end
   * naturally (it finds nothing left to process).
   */
  async cancelAll(): Promise<void> {
    if (this.cancelLock) return
    try {
      this.cancelLock = true
      this.state.isPaused = true

      const activeFilename = getActiveTransferFilename()
      const activeItem = activeFilename ? this.state.queue.get(activeFilename) : undefined
      const itemsToCancel: DownloadQueueItem[] = []
      for (const item of this.state.queue.values()) {
        if (item.status === 'pending' || item.status === 'downloading') {
          // The file actively streaming on the bus takes the SAME transient
          // 'cancelling' → 'cancelled' path as single-cancel: it is not yet terminal
          // until the USB transfer has drained/settled below. Marking it 'cancelled'
          // here (as pending items correctly are) would let the renderer's 3.5s
          // flash-dismiss drop the row before the device has settled on a large file.
          if (item === activeItem) {
            item.status = 'cancelling' // transient — settled to 'cancelled' after the drain
            continue
          }
          item.status = 'cancelled'
          item.error = 'Cancelled by user'
          item.cancelReason = 'user' // HIGH-3: deliberate cancel — terminal until manual retry
          item.completedAt = new Date() // terminal-state stamp: prune age source (pending cancels too)
          itemsToCancel.push(item)
        }
      }

      if (itemsToCancel.length > 0) {
        runInTransaction(() => {
          for (const item of itemsToCancel) {
            this.persistQueueItem(item)
          }
        })
      }

      if (this.state.currentSession) {
        this.state.currentSession.status = 'cancelled'
      }

      this.markDirty()
      this.emitStateUpdate(true) // emit the transient 'cancelling' row + terminal others

      // Abort the file actively streaming on the bus and wait for USB settlement.
      // markFailed() is guarded against clobbering the 'cancelled' state the renderer's
      // abort-triggered error path would otherwise set to 'failed'.
      if (activeFilename) {
        await cancelActiveTransfer('user-cancel')
      }

      // Now settle the active row to its terminal 'cancelled' state (after the drain),
      // mirroring single-cancel. Guarded so a raced completion isn't clobbered.
      if (activeItem && activeItem.status === 'cancelling') {
        activeItem.status = 'cancelled'
        activeItem.error = 'Cancelled by user'
        activeItem.cancelReason = 'user'
        activeItem.completedAt = new Date()
        this.persistQueueItem(activeItem)
        itemsToCancel.push(activeItem)
        this.markDirty()
        this.emitStateUpdate(true)
      }

      if (itemsToCancel.length > 0) {
        emitActivityLog('info', 'All downloads cancelled', `${itemsToCancel.length} items`)
      }

      // HIGH-3: NO delayed cleanup — the retained user-cancelled rows are the
      // durable terminal-suppression markers (see cancelDownload). They clear via
      // manual Retry, explicit re-download, clearCompleted(), or the 24h prune.
    } finally {
      this.cancelLock = false
    }
  }

  /**
   * Get current state
   * B-DWN-009: Uses dirty-flag caching to avoid creating new array on every call
   */
  getState(): {
    queue: DownloadQueueItem[]
    session: SyncSession | null
    isProcessing: boolean
    isPaused: boolean
  } {
    if (this.dirty) {
      this.cachedQueueArray = Array.from(this.state.queue.values())
      this.dirty = false
    }
    return {
      queue: this.cachedQueueArray,
      session: this.state.currentSession,
      isProcessing: this.state.isProcessing,
      isPaused: this.state.isPaused
    }
  }

  /**
   * Get sync statistics
   * C-004: Separates cancelled from failed in counting
   */
  getSyncStats(): {
    totalSynced: number
    pendingInQueue: number
    failedInQueue: number
    cancelledInQueue: number
  } {
    const syncedFiles = getSyncedFilenames()
    let pending = 0
    let failed = 0
    let cancelled = 0

    for (const item of this.state.queue.values()) {
      if (item.status === 'pending' || item.status === 'downloading') {
        pending++
      } else if (item.status === 'failed') {
        failed++
      } else if (item.status === 'cancelled') {
        cancelled++
      }
    }

    return {
      totalSynced: syncedFiles.size,
      pendingInQueue: pending,
      failedInQueue: failed,
      cancelledInQueue: cancelled
    }
  }

  /**
   * Emit state update to all renderer windows
   * Throttled to prevent IPC spam (max once every 250ms for progress updates)
   *
   * TODO: DL-09: The 250ms throttle can cause visual mismatch between actual progress
   * and displayed progress. Consider event-based progress updates (emit on meaningful
   * state changes like status transitions) instead of time-based throttling.
   */
  private emitPending = false
  private emitTimer: ReturnType<typeof setTimeout> | null = null

  private emitStateUpdate(immediate: boolean = false): void {
    if (immediate || !this.emitTimer) {
      this.emitPending = false
      if (this.emitTimer) {
        clearTimeout(this.emitTimer)
      }

      const state = this.getState()
      const windows = BrowserWindow.getAllWindows()

      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('download-service:state-update', state)
        }
      }

      // Set a throttle window
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null
        if (this.emitPending) {
          this.emitStateUpdate(true)
        }
      }, 250)
    } else {
      // Mark as pending - will be sent when throttle window expires
      this.emitPending = true
    }
  }
}

/**
 * B-DWN-003: Normalize .hda filenames to .mp3 extension (exported for testing)
 */
export const normalizeHdaFilename = DownloadService.normalizeFilename

// Singleton instance
let downloadServiceInstance: DownloadService | null = null

export function getDownloadService(): DownloadService {
  if (!downloadServiceInstance) {
    downloadServiceInstance = new DownloadService()
  }
  return downloadServiceInstance
}

/**
 * Register IPC handlers for download service
 */
export function registerDownloadServiceHandlers(): void {
  const service = getDownloadService()

  // Get current state
  ipcMain.handle('download-service:get-state', () => {
    return service.getState()
  })

  // Check if file is synced
  ipcMain.handle('download-service:is-file-synced', (_, filename: string) => {
    return service.isFileAlreadySynced(filename)
  })

  // Get files to sync from a list
  ipcMain.handle('download-service:get-files-to-sync', (_, files: Array<{ filename: string; size: number; duration: number; dateCreated: Date }>) => {
    return service.getFilesToSync(files)
  })

  // Queue downloads (with optional dateCreated for preserving original recording dates)
  // HIGH-3: this channel is only invoked by EXPLICIT user actions (Library "Download"
  // buttons via useOperations) — auto-sync goes through start-session — so it passes
  // explicit=true, which clears a user-cancel suppression for the requested files.
  ipcMain.handle('download-service:queue-downloads', (_, files: Array<{ filename: string; size: number; dateCreated?: string }>) => {
    // Convert ISO date strings back to Date objects
    const filesWithDates = files.map(f => ({
      ...f,
      dateCreated: f.dateCreated ? new Date(f.dateCreated) : undefined
    }))
    return service.queueDownloads(filesWithDates, true)
  })

  // Start sync session (with optional dateCreated for preserving original recording dates)
  ipcMain.handle('download-service:start-session', (_, files: Array<{ filename: string; size: number; dateCreated?: string }>) => {
    // Convert ISO date strings back to Date objects
    const filesWithDates = files.map(f => ({
      ...f,
      dateCreated: f.dateCreated ? new Date(f.dateCreated) : undefined
    }))
    return service.startSyncSession(filesWithDates)
  })

  // Process a completed download (data passed from renderer after USB transfer)
  ipcMain.handle('download-service:process-download', async (_, filename: string, data: number[] | Uint8Array) => {
    const buffer = Buffer.from(data)
    return service.processDownload(filename, buffer)
  })

  // Update progress
  ipcMain.handle('download-service:update-progress', (_, filename: string, bytesReceived: number) => {
    service.updateProgress(filename, bytesReceived)
  })

  // Mark as failed
  ipcMain.handle('download-service:mark-failed', (_, filename: string, error: string) => {
    service.markFailed(filename, error)
  })

  // Clear completed
  ipcMain.handle('download-service:clear-completed', () => {
    service.clearCompleted()
  })

  // Cancel single download (spec-004). Resolves after the in-flight USB transfer for
  // this file (if any) has been aborted and settled, so the renderer can await it.
  ipcMain.handle('download-service:cancel', async (_, filename: string) => {
    return service.cancelDownload(filename)
  })

  // Cancel all. Resolves after the in-flight USB transfer has been aborted and settled.
  ipcMain.handle('download-service:cancel-all', async () => {
    await service.cancelAll()
  })

  // Retry failed downloads
  // AUD4-016: Accepts deviceConnected flag from renderer to prevent retrying while disconnected
  // HIGH-3: interruptedOnly (reconnect auto-retry) re-queues ONLY disconnect-interrupted
  // items; user-cancelled stays terminal. Manual retry omits it (retries everything).
  ipcMain.handle('download-service:retry-failed', (_, deviceConnected?: boolean, interruptedOnly?: boolean) => {
    return service.retryFailed(deviceConnected ?? true, interruptedOnly ?? false)
  })

  // Get sync stats
  ipcMain.handle('download-service:get-stats', () => {
    return service.getSyncStats()
  })

  // spec-007: Check for stalled downloads
  ipcMain.handle('download-service:check-stalled', () => {
    return service.checkForStalledDownloads()
  })

  // spec-007: Cancel active downloads (e.g., on disconnect)
  ipcMain.handle('download-service:cancel-active', (_, reason?: string) => {
    return service.cancelActiveDownloads(reason)
  })

  // C-004: Show native OS notification when sync session completes
  ipcMain.handle('download-service:notify-completion', (_, stats: { completed: number; failed: number; aborted: boolean }) => {
    try {
      if (!Notification.isSupported()) return
      if (stats.completed === 0 && stats.failed === 0) return

      const title = stats.aborted
        ? 'Sync cancelled'
        : stats.failed > 0
          ? 'Sync completed with errors'
          : 'Sync complete'

      const body = stats.aborted
        ? `Downloaded ${stats.completed} file${stats.completed !== 1 ? 's' : ''} before cancellation`
        : stats.failed > 0
          ? `Downloaded ${stats.completed}, failed ${stats.failed}`
          : `Downloaded ${stats.completed} file${stats.completed !== 1 ? 's' : ''}`

      const notification = new Notification({ title, body })
      notification.show()
    } catch (e) {
      console.warn('[DownloadService] Failed to show notification:', e)
    }
  })

  console.log('[DownloadService] IPC handlers registered')
}
