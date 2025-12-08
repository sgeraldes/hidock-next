import { ipcMain } from 'electron'
import {
  getRecordings,
  getRecordingById,
  getRecordingsForMeeting,
  updateRecordingStatus,
  linkRecordingToMeeting,
  getTranscriptByRecordingId,
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

export interface RecordingWithTranscript extends Recording {
  transcript?: Transcript
}

export function registerRecordingHandlers(): void {
  // Get all recordings
  ipcMain.handle('recordings:getAll', async (): Promise<Recording[]> => {
    return getRecordings()
  })

  // Get recording by ID
  ipcMain.handle('recordings:getById', async (_, id: string): Promise<Recording | undefined> => {
    return getRecordingById(id)
  })

  // Get recordings for a specific meeting
  ipcMain.handle(
    'recordings:getForMeeting',
    async (_, meetingId: string): Promise<RecordingWithTranscript[]> => {
      const recordings = getRecordingsForMeeting(meetingId)
      return recordings.map((recording) => ({
        ...recording,
        transcript: getTranscriptByRecordingId(recording.id)
      }))
    }
  )

  // Get all recordings with their transcripts
  ipcMain.handle('recordings:getAllWithTranscripts', async (): Promise<RecordingWithTranscript[]> => {
    const recordings = getRecordings()
    return recordings.map((recording) => ({
      ...recording,
      transcript: getTranscriptByRecordingId(recording.id)
    }))
  })

  // Delete a recording
  ipcMain.handle('recordings:delete', async (_, id: string): Promise<boolean> => {
    const recording = getRecordingById(id)
    if (recording) {
      const deleted = deleteRecordingFile(recording.file_path)
      if (deleted) {
        updateRecordingStatus(id, 'deleted')
      }
      return deleted
    }
    return false
  })

  // Link recording to meeting manually
  ipcMain.handle(
    'recordings:linkToMeeting',
    async (_, recordingId: string, meetingId: string): Promise<void> => {
      linkRecordingToMeeting(recordingId, meetingId, 1.0, 'manual')
    }
  )

  // Unlink recording from meeting
  ipcMain.handle('recordings:unlinkFromMeeting', async (_, recordingId: string): Promise<void> => {
    linkRecordingToMeeting(recordingId, '', 0, '')
  })

  // Get transcript for a recording
  ipcMain.handle(
    'recordings:getTranscript',
    async (_, recordingId: string): Promise<Transcript | undefined> => {
      return getTranscriptByRecordingId(recordingId)
    }
  )

  // Transcribe a recording manually
  ipcMain.handle('recordings:transcribe', async (_, recordingId: string): Promise<void> => {
    await transcribeManually(recordingId)
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

  console.log('Recording IPC handlers registered')
}
