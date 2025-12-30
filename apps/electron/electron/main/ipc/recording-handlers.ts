import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  getRecordings,
  getRecordingById,
  getRecordingsForMeeting,
  updateRecordingStatus,
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
  stopTranscriptionProcessor
} from '../services/transcription'
import {
  GetRecordingByIdSchema,
  DeleteRecordingSchema,
  LinkRecordingToMeetingSchema,
  UnlinkRecordingFromMeetingSchema,
  TranscribeRecordingSchema
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

  console.log('Recording IPC handlers registered')
}
