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
  getSyncedFilenames
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

  constructor() {
    console.log('[DownloadService] Initialized')
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
   * Add files to download queue
   */
  queueDownloads(files: Array<{ filename: string; size: number; dateCreated?: Date }>): string[] {
    const queuedIds: string[] = []

    for (const file of files) {
      // Skip if already in queue
      if (this.state.queue.has(file.filename)) {
        console.log(`[DownloadService] ${file.filename} already in queue, skipping`)
        continue
      }

      // Skip if already synced
      const { synced } = this.isFileAlreadySynced(file.filename)
      if (synced) {
        console.log(`[DownloadService] ${file.filename} already synced, skipping`)
        continue
      }

      const item: DownloadQueueItem = {
        id: file.filename, // Use filename as ID for simplicity
        filename: file.filename,
        fileSize: file.size,
        progress: 0,
        status: 'pending',
        recordingDate: file.dateCreated // Store the original recording date
      }

      this.state.queue.set(file.filename, item)
      queuedIds.push(file.filename)
      console.log(`[DownloadService] Queued: ${file.filename} (${(file.size / 1024 / 1024).toFixed(1)} MB)`)
    }

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

      // Update session
      if (this.state.currentSession) {
        this.state.currentSession.completedFiles++
      }

      this.emitStateUpdate()

      console.log(`[DownloadService] Completed: ${filename}`)
      return { success: true, filePath }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[DownloadService] Failed: ${filename} - ${errorMsg}`)

      item.status = 'failed'
      item.error = errorMsg

      if (this.state.currentSession) {
        this.state.currentSession.failedFiles++
      }

      this.emitStateUpdate()
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Update progress for a download
   */
  updateProgress(filename: string, bytesReceived: number): void {
    const item = this.state.queue.get(filename)
    if (item) {
      item.progress = Math.round((bytesReceived / item.fileSize) * 100)
      this.emitStateUpdate()
    }
  }

  /**
   * Mark download as failed
   */
  markFailed(filename: string, error: string): void {
    const item = this.state.queue.get(filename)
    if (item) {
      item.status = 'failed'
      item.error = error

      if (this.state.currentSession) {
        this.state.currentSession.failedFiles++
      }

      this.emitStateUpdate()
    }
  }

  /**
   * Remove completed/failed items from queue
   */
  clearCompleted(): void {
    for (const [key, item] of this.state.queue) {
      if (item.status === 'completed' || item.status === 'failed') {
        this.state.queue.delete(key)
      }
    }
    this.emitStateUpdate()
  }

  /**
   * Cancel all pending downloads
   */
  cancelAll(): void {
    this.state.isPaused = true

    for (const item of this.state.queue.values()) {
      if (item.status === 'pending') {
        item.status = 'failed'
        item.error = 'Cancelled'
      }
    }

    if (this.state.currentSession) {
      this.state.currentSession.status = 'cancelled'
    }

    this.emitStateUpdate()
  }

  /**
   * Get current state
   */
  getState(): {
    queue: DownloadQueueItem[]
    session: SyncSession | null
    isProcessing: boolean
    isPaused: boolean
  } {
    return {
      queue: Array.from(this.state.queue.values()),
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
   */
  private emitStateUpdate(): void {
    const state = this.getState()
    const windows = BrowserWindow.getAllWindows()

    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('download-service:state-update', state)
      }
    }
  }
}

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
  ipcMain.handle('download-service:process-download', async (_, filename: string, data: number[]) => {
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

  // Cancel all
  ipcMain.handle('download-service:cancel-all', () => {
    service.cancelAll()
  })

  // Get sync stats
  ipcMain.handle('download-service:get-stats', () => {
    return service.getSyncStats()
  })

  console.log('[DownloadService] IPC handlers registered')
}
