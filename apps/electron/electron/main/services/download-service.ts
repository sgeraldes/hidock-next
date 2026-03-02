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

import { BrowserWindow, ipcMain } from 'electron'
import {
  markRecordingDownloaded,
  addSyncedFile,
  isFileSynced,
  getRecordingByFilename,
  getSyncedFilenames,
  queryOne,
  queryAll,
  run
} from './database'
import { saveRecording, getRecordingsPath } from './file-storage'
import { existsSync } from 'fs'
import { join, basename } from 'path'

// Download queue item
export interface DownloadQueueItem {
  id: string
  filename: string
  fileSize: number
  progress: number
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  error?: string
  startedAt?: Date
  completedAt?: Date
  recordingDate?: Date // Original recording date from device
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

class DownloadService {
  private state: DownloadServiceState = {
    queue: new Map(),
    currentSession: null,
    isProcessing: false,
    isPaused: false
  }
  private stalledCheckInterval: NodeJS.Timeout | null = null // spec-007: periodic stalled check

  // B-DWN-009: Dirty-flag caching for getState() to avoid creating new arrays on every call
  private dirty = true
  private cachedQueueArray: DownloadQueueItem[] = []

  constructor() {
    console.log('[DownloadService] Initialized')
    this.loadQueueFromDatabase()
    this.startStalledCheckInterval() // spec-007: start periodic timeout detection
  }

  /**
   * B-DWN-009: Mark the cached queue array as dirty so getState() rebuilds it
   */
  private markDirty(): void {
    this.dirty = true
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
   * Load queue from database on startup (spec-007: persistence)
   */
  private loadQueueFromDatabase(): void {
    try {
      const items = queryAll<{
        id: string
        filename: string
        file_size: number
        progress: number
        status: 'pending' | 'downloading' | 'completed' | 'failed'
        error: string | null
        started_at: string | null
        completed_at: string | null
        recording_date: string | null
      }>(`
        SELECT id, filename, file_size, progress, status, error, started_at, completed_at, recording_date
        FROM download_queue
        WHERE status IN ('pending', 'downloading')
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
          recordingDate: item.recording_date ? new Date(item.recording_date) : undefined
        }
        this.state.queue.set(item.filename, queueItem)
      }

      this.markDirty()
      console.log(`[DownloadService] Loaded ${items.length} items from database`)
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
        (id, filename, file_size, progress, status, error, started_at, completed_at, recording_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM download_queue WHERE id = ?), datetime('now')))
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
   */
  isFileAlreadySynced(filename: string): { synced: boolean; reason: string } {
    // Check 1: Is it in synced_files table?
    if (isFileSynced(filename)) {
      return { synced: true, reason: 'In synced_files table' }
    }

    // Check 2: Convert .hda to .wav and check both
    const wavFilename = filename.replace(/\.hda$/i, '.wav')
    if (wavFilename !== filename && isFileSynced(wavFilename)) {
      return { synced: true, reason: 'WAV version in synced_files' }
    }

    // Check 3: Check if file exists on disk
    const recordingsPath = getRecordingsPath()
    const filePath = join(recordingsPath, wavFilename)
    if (existsSync(filePath)) {
      // File exists but not in synced_files - add it!
      console.log(`[DownloadService] Found orphaned file on disk: ${wavFilename}, adding to synced_files`)
      addSyncedFile(filename, wavFilename, filePath)
      return { synced: true, reason: 'File exists on disk (reconciled)' }
    }

    // Check 4: Check recordings table
    const recording = getRecordingByFilename(filename) || getRecordingByFilename(wavFilename)
    if (recording && recording.file_path && existsSync(recording.file_path)) {
      // Recording exists with valid file path
      console.log(`[DownloadService] Found in recordings table: ${filename}`)
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

    for (const file of deviceFiles) {
      const { synced, reason } = this.isFileAlreadySynced(file.filename)
      if (synced) {
        console.log(`[DownloadService] Skipping ${file.filename}: ${reason}`)
      }
      results.push({ ...file, skipReason: synced ? reason : undefined })
    }

    return results
  }

  /**
   * Add files to download queue (spec-007: database duplicate check)
   */
  queueDownloads(files: Array<{ filename: string; size: number; dateCreated?: Date }>): string[] {
    const queuedIds: string[] = []

    for (const file of files) {
      // B-DWN-003: Normalize .hda filenames to .mp3
      const normalizedFilename = DownloadService.normalizeFilename(file.filename)

      // spec-007: Check database for existing queue entry (check both original and normalized)
      const existingInDb = queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM download_queue WHERE (filename = ? OR filename = ?) AND status IN (?, ?)',
        [file.filename, normalizedFilename, 'pending', 'downloading']
      )

      if (existingInDb) {
        console.log(`[DownloadService] ${file.filename} already in database queue (${existingInDb.status}), skipping`)
        continue
      }

      // Skip if already in memory queue (check both original and normalized)
      if (this.state.queue.has(file.filename) || this.state.queue.has(normalizedFilename)) {
        console.log(`[DownloadService] ${file.filename} already in memory queue, skipping`)
        continue
      }

      // Skip if already synced (check both original and normalized)
      const { synced } = this.isFileAlreadySynced(file.filename)
      if (synced) {
        console.log(`[DownloadService] ${file.filename} already synced, skipping`)
        continue
      }
      if (normalizedFilename !== file.filename) {
        const { synced: normalizedSynced } = this.isFileAlreadySynced(normalizedFilename)
        if (normalizedSynced) {
          console.log(`[DownloadService] ${normalizedFilename} (normalized) already synced, skipping`)
          continue
        }
      }

      const item: DownloadQueueItem = {
        id: file.filename, // Use original filename as ID for simplicity
        filename: file.filename,
        fileSize: file.size,
        progress: 0,
        status: 'pending',
        recordingDate: file.dateCreated // Store the original recording date
      }

      this.state.queue.set(file.filename, item)
      this.persistQueueItem(item) // spec-007: persist to database
      queuedIds.push(file.filename)
      console.log(`[DownloadService] Queued: ${file.filename} (${(file.size / 1024 / 1024).toFixed(1)} MB)`)
    }

    this.markDirty()
    this.emitStateUpdate()
    return queuedIds
  }

  /**
   * Start a sync session
   */
  startSyncSession(files: Array<{ filename: string; size: number; dateCreated?: Date }>): SyncSession {
    // Queue the files (including recording dates for proper date preservation)
    this.queueDownloads(files)

    // Create session
    const session: SyncSession = {
      id: `sync_${Date.now()}`,
      totalFiles: this.state.queue.size,
      completedFiles: 0,
      failedFiles: 0,
      startedAt: new Date(),
      status: 'active'
    }

    this.state.currentSession = session
    this.emitStateUpdate()

    console.log(`[DownloadService] Started sync session ${session.id} with ${session.totalFiles} files`)
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

    try {
      item.status = 'downloading'
      item.startedAt = new Date()
      this.persistQueueItem(item) // spec-007: persist status change
      this.markDirty()
      this.emitStateUpdate()

      // Save the file with the original recording date if available
      const filePath = await saveRecording(filename, data, undefined, item.recordingDate)

      // Update database
      const wavFilename = filename.replace(/\.hda$/i, '.wav')
      addSyncedFile(filename, basename(filePath), filePath, data.length)
      markRecordingDownloaded(filename, filePath)

      // Also try to mark by wav name if different
      if (wavFilename !== filename) {
        markRecordingDownloaded(wavFilename, filePath)
      }

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
      this.emitStateUpdate()

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
      this.emitStateUpdate()
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Cancel a specific download (spec-004)
   * Note: This only updates the state in the main process.
   * The renderer must call deviceService.cancelDownload() to abort the actual USB transfer.
   */
  cancelDownload(filename: string): { success: boolean; error?: string } {
    const item = this.state.queue.get(filename)
    if (!item) {
      return { success: false, error: 'Download not found in queue' }
    }

    if (item.status !== 'pending' && item.status !== 'downloading') {
      return { success: false, error: `Cannot cancel download with status: ${item.status}` }
    }

    item.status = 'failed'
    item.error = 'Cancelled by user'
    this.persistQueueItem(item) // spec-007: persist cancellation
    console.log(`[DownloadService] Cancelled download: ${filename}`)
    this.markDirty()
    this.emitStateUpdate()

    // B-DWN-006: Delayed cleanup for cancelled items (5s)
    setTimeout(() => {
      this.state.queue.delete(filename)
      this.removeFromDatabase(filename)
      this.markDirty()
      this.emitStateUpdate()
    }, 5000)

    return { success: true }
  }

  /**
   * Update progress for a download (spec-007: persist progress periodically)
   */
  updateProgress(filename: string, bytesReceived: number): void {
    const item = this.state.queue.get(filename)
    if (item) {
      const oldProgress = item.progress
      if (item.status === 'pending') {
        item.status = 'downloading'
        item.startedAt = new Date()
      }
      item.progress = Math.round((bytesReceived / item.fileSize) * 100)

      // Persist every 10% to avoid database spam
      if (Math.floor(oldProgress / 10) !== Math.floor(item.progress / 10)) {
        this.persistQueueItem(item)
      }

      this.markDirty()
      this.emitStateUpdate()
    }
  }

  /**
   * Mark download as failed (spec-007: persist failure)
   */
  markFailed(filename: string, error: string): void {
    const item = this.state.queue.get(filename)
    if (item) {
      item.status = 'failed'
      item.error = error
      this.persistQueueItem(item) // spec-007: persist failure

      if (this.state.currentSession) {
        this.state.currentSession.failedFiles++
      }

      this.markDirty()
      this.emitStateUpdate()
    }
  }

  /**
   * spec-007: Check for stalled downloads and mark as failed
   * Called periodically to detect downloads that exceed timeout
   */
  checkForStalledDownloads(): number {
    const TIMEOUT_MS = 30000 // 30 seconds
    const now = Date.now()
    let stalledCount = 0
    const stalledFilenames: string[] = []

    for (const item of this.state.queue.values()) {
      if (item.status === 'downloading' && item.startedAt) {
        const elapsed = now - item.startedAt.getTime()
        if (elapsed > TIMEOUT_MS) {
          console.warn(`[DownloadService] Timeout detected for ${item.filename} (${Math.round(elapsed / 1000)}s)`)
          item.status = 'failed'
          item.error = 'Download timeout (30s exceeded)'
          this.persistQueueItem(item)

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
      this.emitStateUpdate()

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
   * spec-007: Cancel all active downloads (e.g., on device disconnect)
   */
  cancelActiveDownloads(reason: string = 'Cancelled'): number {
    let cancelledCount = 0

    for (const item of this.state.queue.values()) {
      if (item.status === 'downloading' || item.status === 'pending') {
        item.status = 'failed'
        item.error = reason
        this.persistQueueItem(item)

        if (this.state.currentSession) {
          this.state.currentSession.failedFiles++
        }

        cancelledCount++
        console.log(`[DownloadService] Cancelled: ${item.filename} - ${reason}`)
      }
    }

    if (cancelledCount > 0) {
      this.markDirty()
      this.emitStateUpdate()
    }

    return cancelledCount
  }

  /**
   * Re-queue all failed downloads as pending so they can be retried
   */
  /**
   * Re-queue all failed downloads as pending so they can be retried.
   * B-DWN-007: Checks if file is already synced before retrying.
   */
  retryFailed(): number {
    let count = 0
    const alreadySynced: string[] = []

    for (const [key, item] of this.state.queue) {
      if (item.status === 'failed') {
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
        item.startedAt = undefined
        item.completedAt = undefined
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
      this.emitStateUpdate()
    }

    return count
  }

  /**
   * DL-07: Prune completed items from queue, keeping at most maxRetained.
   * B-DWN-002: Reduced threshold to 10, also auto-prunes failed items older than 24h.
   */
  private pruneCompletedItems(maxRetained: number): void {
    const completed: string[] = []
    const now = Date.now()
    const FAILED_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

    for (const [key, item] of this.state.queue) {
      if (item.status === 'completed') {
        completed.push(key)
      }

      // B-DWN-002: Auto-prune failed items older than 24h to prevent memory leaks
      if (item.status === 'failed' && item.startedAt) {
        const age = now - item.startedAt.getTime()
        if (age > FAILED_MAX_AGE_MS) {
          this.state.queue.delete(key)
          this.removeFromDatabase(key)
        }
      }
    }

    // Remove oldest first (beyond the retention limit)
    if (completed.length > maxRetained) {
      const toRemove = completed.slice(0, completed.length - maxRetained)
      for (const key of toRemove) {
        this.state.queue.delete(key)
      }
    }

    this.markDirty()
  }

  /**
   * Remove completed/failed items from queue
   * B-DWN-004: Also removes from database for persistence consistency
   */
  clearCompleted(): void {
    for (const [key, item] of this.state.queue) {
      if (item.status === 'completed' || item.status === 'failed') {
        this.removeFromDatabase(key) // B-DWN-004: remove from database too
        this.state.queue.delete(key)
      }
    }
    this.markDirty()
    this.emitStateUpdate()
  }

  /**
   * Cancel all pending downloads
   * B-DWN-005: Persist cancelled state for each item
   */
  cancelAll(): void {
    this.state.isPaused = true

    for (const item of this.state.queue.values()) {
      if (item.status === 'pending' || item.status === 'downloading') {
        item.status = 'failed'
        item.error = 'Cancelled'
        this.persistQueueItem(item) // B-DWN-005: persist cancelled state
      }
    }

    if (this.state.currentSession) {
      this.state.currentSession.status = 'cancelled'
    }

    this.markDirty()
    this.emitStateUpdate()
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
   */
  getSyncStats(): {
    totalSynced: number
    pendingInQueue: number
    failedInQueue: number
  } {
    const syncedFiles = getSyncedFilenames()
    let pending = 0
    let failed = 0

    for (const item of this.state.queue.values()) {
      if (item.status === 'pending' || item.status === 'downloading') {
        pending++
      } else if (item.status === 'failed') {
        failed++
      }
    }

    return {
      totalSynced: syncedFiles.size,
      pendingInQueue: pending,
      failedInQueue: failed
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
  ipcMain.handle('download-service:queue-downloads', (_, files: Array<{ filename: string; size: number; dateCreated?: string }>) => {
    // Convert ISO date strings back to Date objects
    const filesWithDates = files.map(f => ({
      ...f,
      dateCreated: f.dateCreated ? new Date(f.dateCreated) : undefined
    }))
    return service.queueDownloads(filesWithDates)
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

  // Cancel single download (spec-004)
  ipcMain.handle('download-service:cancel', (_, filename: string) => {
    return service.cancelDownload(filename)
  })

  // Cancel all
  ipcMain.handle('download-service:cancel-all', () => {
    service.cancelAll()
  })

  // Retry failed downloads
  ipcMain.handle('download-service:retry-failed', () => {
    return service.retryFailed()
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

  console.log('[DownloadService] IPC handlers registered')
}
