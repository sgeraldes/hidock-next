import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  getRecordings,
  getRecordingById,
  getRecordingsForMeeting,
  updateRecordingStatus,
  updateRecordingTranscriptionStatus,
  linkRecordingToMeeting,
  getTranscriptByRecordingId,
  getCandidatesForRecordingWithDetails,
  getMeetingsNearDate,
  insertRecording,
  type Recording,
  type Transcript
} from '../services/database'
import { getRecordingFiles, deleteRecording as deleteRecordingFile, getRecordingsPath } from '../services/file-storage'
import { copyFileSync, existsSync, statSync } from 'fs'
import { basename, join, extname } from 'path'
import { randomUUID } from 'crypto'
import {
  startRecordingWatcher,
  stopRecordingWatcher,
  getWatcherStatus
} from '../services/recording-watcher'
import {
  transcribeManually,
  getTranscriptionStatus,
  startTranscriptionProcessor,
  stopTranscriptionProcessor,
  cancelTranscription,
  cancelAllTranscriptions,
  processQueueManually
} from '../services/transcription'
import { getQueueItems, addToQueue, updateQueueItem } from '../services/database'
import { getConfig } from '../services/config'
import {
  GetRecordingByIdSchema,
  DeleteRecordingSchema,
  DeleteBatchRecordingsSchema,
  LinkRecordingToMeetingSchema,
  UnlinkRecordingFromMeetingSchema,
  TranscribeRecordingSchema,
  UpdateRecordingStatusSchema,
  UpdateTranscriptionStatusSchema
} from './validation'

export interface RecordingWithTranscript extends Recording {
  transcript?: Transcript
}

export function registerRecordingHandlers(): void {
  // Get all recordings
  ipcMain.handle('recordings:getAll', async (): Promise<Recording[]> => {
    try {
      return getRecordings()
    } catch (error) {
      console.error('recordings:getAll error:', error)
      return []
    }
  })

  // Get recording by ID
  ipcMain.handle('recordings:getById', async (_, id: unknown): Promise<Recording | undefined> => {
    try {
      const result = GetRecordingByIdSchema.safeParse({ id })
      if (!result.success) {
        console.error('recordings:getById validation error:', result.error)
        return undefined
      }
      return getRecordingById(result.data.id)
    } catch (error) {
      console.error('recordings:getById error:', error)
      return undefined
    }
  })

  // Get recordings for a specific meeting
  ipcMain.handle(
    'recordings:getForMeeting',
    async (_, meetingId: unknown): Promise<RecordingWithTranscript[]> => {
      try {
        // Validate meeting ID (reuse GetRecordingByIdSchema since it's the same UUID format)
        const result = GetRecordingByIdSchema.safeParse({ id: meetingId })
        if (!result.success) {
          console.error('recordings:getForMeeting validation error:', result.error)
          return []
        }

        const recordings = getRecordingsForMeeting(result.data.id)
        return recordings.map((recording) => ({
          ...recording,
          transcript: getTranscriptByRecordingId(recording.id)
        }))
      } catch (error) {
        console.error('recordings:getForMeeting error:', error)
        return []
      }
    }
  )

  // Get all recordings with their transcripts
  ipcMain.handle('recordings:getAllWithTranscripts', async (): Promise<RecordingWithTranscript[]> => {
    try {
      const recordings = getRecordings()
      return recordings.map((recording) => ({
        ...recording,
        transcript: getTranscriptByRecordingId(recording.id)
      }))
    } catch (error) {
      console.error('recordings:getAllWithTranscripts error:', error)
      return []
    }
  })

  // Delete a recording
  ipcMain.handle('recordings:delete', async (_, id: unknown): Promise<boolean> => {
    try {
      const result = DeleteRecordingSchema.safeParse({ id })
      if (!result.success) {
        console.error('recordings:delete validation error:', result.error)
        return false
      }

      const recording = getRecordingById(result.data.id)
      if (recording && recording.file_path) {
        const deleted = deleteRecordingFile(recording.file_path)
        if (deleted) {
          updateRecordingStatus(result.data.id, 'deleted')
        }
        return deleted
      }
      return false
    } catch (error) {
      console.error('recordings:delete error:', error)
      return false
    }
  })

  // Batch delete recordings (B-LIB-007)
  ipcMain.handle('recordings:deleteBatch', async (_, ids: unknown): Promise<{
    success: boolean
    deleted: number
    failed: number
    errors: Array<{ id: string; error: string }>
  }> => {
    try {
      const result = DeleteBatchRecordingsSchema.safeParse({ ids })
      if (!result.success) {
        console.error('recordings:deleteBatch validation error:', result.error)
        return { success: false, deleted: 0, failed: 0, errors: [{ id: '', error: result.error.issues[0]?.message || 'Invalid request' }] }
      }

      let deleted = 0
      let failed = 0
      const errors: Array<{ id: string; error: string }> = []

      for (const id of result.data.ids) {
        try {
          const recording = getRecordingById(id)
          if (recording && recording.file_path) {
            const wasDeleted = deleteRecordingFile(recording.file_path)
            if (wasDeleted) {
              updateRecordingStatus(id, 'deleted')
              deleted++
            } else {
              failed++
              errors.push({ id, error: 'File deletion failed' })
            }
          } else {
            failed++
            errors.push({ id, error: 'Recording not found or no file path' })
          }
        } catch (e) {
          failed++
          errors.push({ id, error: e instanceof Error ? e.message : 'Unknown error' })
        }
      }

      return { success: failed === 0, deleted, failed, errors }
    } catch (error) {
      console.error('recordings:deleteBatch error:', error)
      return { success: false, deleted: 0, failed: 0, errors: [{ id: '', error: error instanceof Error ? error.message : 'Unknown error' }] }
    }
  })

  // Link recording to meeting manually
  ipcMain.handle(
    'recordings:linkToMeeting',
    async (_, recordingId: unknown, meetingId: unknown): Promise<void> => {
      try {
        const result = LinkRecordingToMeetingSchema.safeParse({ recordingId, meetingId })
        if (!result.success) {
          console.error('recordings:linkToMeeting validation error:', result.error)
          throw new Error(result.error.issues[0]?.message || 'Invalid request')
        }

        linkRecordingToMeeting(result.data.recordingId, result.data.meetingId, 1.0, 'manual')
      } catch (error) {
        console.error('recordings:linkToMeeting error:', error)
        throw error
      }
    }
  )

  // Unlink recording from meeting
  ipcMain.handle('recordings:unlinkFromMeeting', async (_, recordingId: unknown): Promise<void> => {
    try {
      const result = UnlinkRecordingFromMeetingSchema.safeParse({ recordingId })
      if (!result.success) {
        console.error('recordings:unlinkFromMeeting validation error:', result.error)
        throw new Error(result.error.issues[0]?.message || 'Invalid request')
      }

      linkRecordingToMeeting(result.data.recordingId, '', 0, '')
    } catch (error) {
      console.error('recordings:unlinkFromMeeting error:', error)
      throw error
    }
  })

  // Get transcript for a recording
  ipcMain.handle(
    'recordings:getTranscript',
    async (_, recordingId: unknown): Promise<Transcript | undefined> => {
      try {
        const result = GetRecordingByIdSchema.safeParse({ id: recordingId })
        if (!result.success) {
          console.error('recordings:getTranscript validation error:', result.error)
          return undefined
        }

        return getTranscriptByRecordingId(result.data.id)
      } catch (error) {
        console.error('recordings:getTranscript error:', error)
        return undefined
      }
    }
  )

  // Transcribe a recording manually
  ipcMain.handle('recordings:transcribe', async (_, recordingId: unknown): Promise<void> => {
    try {
      const result = TranscribeRecordingSchema.safeParse({ recordingId })
      if (!result.success) {
        console.error('recordings:transcribe validation error:', result.error)
        throw new Error(result.error.issues[0]?.message || 'Invalid request')
      }

      await transcribeManually(result.data.recordingId)
    } catch (error) {
      console.error('recordings:transcribe error:', error)
      throw error
    }
  })

  // Get watcher status
  ipcMain.handle(
    'recordings:getWatcherStatus',
    async (): Promise<{ isWatching: boolean; path: string }> => {
      return getWatcherStatus()
    }
  )

  // Start/stop watcher
  ipcMain.handle('recordings:startWatcher', async (): Promise<void> => {
    startRecordingWatcher()
  })

  ipcMain.handle('recordings:stopWatcher', async (): Promise<void> => {
    stopRecordingWatcher()
  })

  // Get transcription status
  ipcMain.handle(
    'recordings:getTranscriptionStatus',
    async (): Promise<{
      isProcessing: boolean
      pendingCount: number
      processingCount: number
    }> => {
      return getTranscriptionStatus()
    }
  )

  // Start/stop transcription processor
  ipcMain.handle('recordings:startTranscriptionProcessor', async (): Promise<void> => {
    startTranscriptionProcessor()
  })

  ipcMain.handle('recordings:stopTranscriptionProcessor', async (): Promise<void> => {
    stopTranscriptionProcessor()
  })

  ipcMain.handle('transcription:cancel', async (_, recordingId: string): Promise<{ success: boolean }> => {
    try {
      cancelTranscription(recordingId)
      return { success: true }
    } catch (error) {
      console.error('transcription:cancel error:', error)
      return { success: false }
    }
  })

  ipcMain.handle('transcription:cancelAll', async (): Promise<{ success: boolean; count: number }> => {
    try {
      const count = cancelAllTranscriptions()
      return { success: true, count }
    } catch (error) {
      console.error('transcription:cancelAll error:', error)
      return { success: false, count: 0 }
    }
  })

  ipcMain.handle('transcription:getQueue', async (): Promise<any[]> => {
    try {
      return getQueueItems()
    } catch (error) {
      console.error('transcription:getQueue error:', error)
      return []
    }
  })

  ipcMain.handle('transcription:updateQueueItem', async (_, id: string, status: string, errorMessage?: string): Promise<boolean> => {
    try {
      updateQueueItem(id, status, errorMessage)
      return true
    } catch (error) {
      console.error('transcription:updateQueueItem error:', error)
      return false
    }
  })

  // Scan recordings folder
  ipcMain.handle('recordings:scanFolder', async (): Promise<string[]> => {
    return getRecordingFiles()
  })

  // Get meeting candidates for a recording (for manual linking)
  ipcMain.handle('recordings:getCandidates', async (_, recordingId: unknown) => {
    try {
      const result = GetRecordingByIdSchema.safeParse({ id: recordingId })
      if (!result.success) {
        console.error('recordings:getCandidates validation error:', result.error)
        return []
      }
      return getCandidatesForRecordingWithDetails(result.data.id)
    } catch (error) {
      console.error('recordings:getCandidates error:', error)
      return []
    }
  })

  // Get meetings near a specific date (for manual linking)
  ipcMain.handle('recordings:getMeetingsNearDate', async (_, dateStr: unknown) => {
    try {
      if (typeof dateStr !== 'string') {
        console.error('recordings:getMeetingsNearDate invalid date:', dateStr)
        return []
      }
      return getMeetingsNearDate(dateStr)
    } catch (error) {
      console.error('recordings:getMeetingsNearDate error:', error)
      return []
    }
  })

  // Add external recording (from file dialog)
  ipcMain.handle('recordings:addExternal', async (): Promise<{ success: boolean; recording?: Recording; error?: string }> => {
    try {
      // Get the focused window for the dialog parent
      const focusedWindow = BrowserWindow.getFocusedWindow()

      // Open file dialog to select an audio file
      const result = await dialog.showOpenDialog(focusedWindow || BrowserWindow.getAllWindows()[0], {
        title: 'Select Audio File',
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'm4a', 'wav', 'ogg', 'flac'] }
        ],
        properties: ['openFile']
      })

      // Check if user cancelled the dialog
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'No file selected' }
      }

      const sourcePath = result.filePaths[0]

      // Check if file exists
      if (!existsSync(sourcePath)) {
        return { success: false, error: 'Selected file does not exist' }
      }

      // Get file stats
      const stats = statSync(sourcePath)
      const originalFilename = basename(sourcePath)
      const fileExtension = extname(originalFilename)

      // Generate a unique filename for the recordings folder
      const recordingsPath = getRecordingsPath()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')
      const newFilename = `external-${timestamp[0]}-${timestamp[1].substring(0, 8)}${fileExtension}`
      const destinationPath = join(recordingsPath, newFilename)

      // Copy the file to the recordings folder
      copyFileSync(sourcePath, destinationPath)

      // Create database entry
      const recordingId = randomUUID()

      const recording: Omit<Recording, 'created_at'> = {
        id: recordingId,
        filename: newFilename,
        original_filename: originalFilename,
        file_path: destinationPath,
        file_size: stats.size,
        duration_seconds: undefined, // Will be populated later if needed
        date_recorded: stats.mtime.toISOString(),
        meeting_id: undefined,
        correlation_confidence: undefined,
        correlation_method: undefined,
        status: 'ready',
        location: 'local-only',
        transcription_status: 'none',
        on_device: 0,
        device_last_seen: undefined,
        on_local: 1,
        source: 'external',
        is_imported: 1
      }

      insertRecording(recording)

      // Get the full recording with created_at timestamp
      const insertedRecording = getRecordingById(recordingId)

      if (!insertedRecording) {
        return { success: false, error: 'Failed to retrieve recording after insert' }
      }

      return { success: true, recording: insertedRecording }
    } catch (error) {
      console.error('recordings:addExternal error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  })

  // Add external recording by file path (used by drag-and-drop import)
  ipcMain.handle('recordings:addExternalByPath', async (_, filePath: string): Promise<{ success: boolean; recording?: Recording; error?: string }> => {
    try {
      // Validate file extension
      const allowedExtensions = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.webm', '.hda']
      const fileExtension = extname(filePath).toLowerCase()
      if (!allowedExtensions.includes(fileExtension)) {
        return { success: false, error: `Unsupported file type: ${fileExtension}. Supported: ${allowedExtensions.join(', ')}` }
      }

      // Check if file exists
      if (!existsSync(filePath)) {
        return { success: false, error: 'File does not exist' }
      }

      // Get file stats
      const stats = statSync(filePath)
      const originalFilename = basename(filePath)

      // Generate a unique filename for the recordings folder
      const recordingsPath = getRecordingsPath()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')
      const newFilename = `external-${timestamp[0]}-${timestamp[1].substring(0, 8)}${fileExtension}`
      const destinationPath = join(recordingsPath, newFilename)

      // Copy the file to the recordings folder
      copyFileSync(filePath, destinationPath)

      // Create database entry
      const recordingId = randomUUID()

      const recording: Omit<Recording, 'created_at'> = {
        id: recordingId,
        filename: newFilename,
        original_filename: originalFilename,
        file_path: destinationPath,
        file_size: stats.size,
        duration_seconds: undefined,
        date_recorded: stats.mtime.toISOString(),
        meeting_id: undefined,
        correlation_confidence: undefined,
        correlation_method: undefined,
        status: 'ready',
        location: 'local-only',
        transcription_status: 'none',
        on_device: 0,
        device_last_seen: undefined,
        on_local: 1,
        source: 'external',
        is_imported: 1
      }

      insertRecording(recording)

      const insertedRecording = getRecordingById(recordingId)
      if (!insertedRecording) {
        return { success: false, error: 'Failed to retrieve recording after insert' }
      }

      return { success: true, recording: insertedRecording }
    } catch (error) {
      console.error('recordings:addExternalByPath error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  })

  // Select a meeting for a recording (manual linking from dialog)
  ipcMain.handle('recordings:selectMeeting', async (_, recordingId: string, meetingId: string | null) => {
    try {
      if (meetingId) {
        linkRecordingToMeeting(recordingId, meetingId, 1.0, 'manual')
      } else {
        linkRecordingToMeeting(recordingId, '', 0, '')
      }
      return { success: true }
    } catch (error) {
      console.error('recordings:selectMeeting error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Add a recording to the transcription queue
  ipcMain.handle('recordings:addToQueue', async (_, recordingId: string) => {
    try {
      // Validate API key is configured before queueing
      const config = getConfig()
      if (!config.transcription.geminiApiKey) {
        return {
          success: false,
          error: 'Transcription API key not configured. Please add your API key in Settings.'
        }
      }

      const queueItemId = addToQueue(recordingId)
      updateRecordingTranscriptionStatus(recordingId, 'queued')
      // spec-005: Trigger immediate queue processing after adding
      processQueueManually()
      return queueItemId
    } catch (error) {
      console.error('recordings:addToQueue error:', error)
      return false
    }
  })

  // Start processing the transcription queue
  ipcMain.handle('recordings:processQueue', async () => {
    try {
      startTranscriptionProcessor()
      return true
    } catch (error) {
      console.error('recordings:processQueue error:', error)
      return false
    }
  })

  // spec-005: Retry a failed transcription
  ipcMain.handle('transcription:retry', async (_, recordingId: string) => {
    try {
      const result = TranscribeRecordingSchema.safeParse({ recordingId })
      if (!result.success) {
        console.error('transcription:retry validation error:', result.error)
        return { success: false, error: result.error.issues[0]?.message || 'Invalid request' }
      }

      const queueItemId = addToQueue(result.data.recordingId)
      updateRecordingTranscriptionStatus(result.data.recordingId, 'pending')
      processQueueManually()
      return { success: true, queueItemId }
    } catch (error) {
      console.error('transcription:retry error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Update recording status
  ipcMain.handle('recordings:updateStatus', async (_, id: unknown, status: unknown): Promise<{ success: boolean; data?: Recording; error?: string }> => {
    try {
      const result = UpdateRecordingStatusSchema.safeParse({ id, status })
      if (!result.success) {
        console.error('recordings:updateStatus validation error:', result.error)
        return { success: false, error: result.error.issues[0]?.message || 'Invalid request parameters' }
      }
      updateRecordingStatus(result.data.id, result.data.status)
      const recording = getRecordingById(result.data.id)
      if (!recording) {
        return { success: false, error: 'Recording not found after status update' }
      }
      return { success: true, data: recording }
    } catch (error) {
      console.error('recordings:updateStatus error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' }
    }
  })

  // Update transcription status
  ipcMain.handle('recordings:updateTranscriptionStatus', async (_, id: unknown, status: unknown): Promise<{ success: boolean; data?: Recording; error?: string }> => {
    try {
      const result = UpdateTranscriptionStatusSchema.safeParse({ id, status })
      if (!result.success) {
        console.error('recordings:updateTranscriptionStatus validation error:', result.error)
        return { success: false, error: result.error.issues[0]?.message || 'Invalid request parameters' }
      }
      updateRecordingTranscriptionStatus(result.data.id, result.data.status)
      const recording = getRecordingById(result.data.id)
      if (!recording) {
        return { success: false, error: 'Recording not found after transcription status update' }
      }
      return { success: true, data: recording }
    } catch (error) {
      console.error('recordings:updateTranscriptionStatus error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' }
    }
  })

  console.log('Recording IPC handlers registered')
}
