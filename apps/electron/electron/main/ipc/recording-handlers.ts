import { ipcMain } from 'electron'
import {
  getRecordings,
  getRecordingById,
  getRecordingsForMeeting,
  updateRecordingStatus,
  linkRecordingToMeeting,
  getTranscriptByRecordingId,
  getCandidatesForRecordingWithDetails,
  getMeetingsNearDate,
  type Recording,
  type Transcript
} from '../services/database'
import { getRecordingFiles, deleteRecording as deleteRecordingFile } from '../services/file-storage'
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
      if (recording) {
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

  console.log('Recording IPC handlers registered')
}
