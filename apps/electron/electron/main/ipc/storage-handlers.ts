import { ipcMain, shell } from 'electron'
import {
  getStorageInfo,
  getRecordingsPath,
  getTranscriptsPath,
  readRecordingFile,
  deleteRecording,
  saveRecording
} from '../services/file-storage'
import {
  insertRecording,
  addToQueue,
  getMeetings,
  linkRecordingToMeeting,
  addSyncedFile,
  type Recording
} from '../services/database'
import {
  OpenFolderSchema,
  ReadRecordingFileSchema,
  DeleteRecordingFileSchema,
  SaveRecordingSchema
} from './validation'

export function registerStorageHandlers(): void {
  // Get storage info
  ipcMain.handle('storage:get-info', async () => {
    try {
      return { success: true, data: getStorageInfo() }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Open folder in file explorer
  ipcMain.handle('storage:open-folder', async (_, folder: unknown) => {
    try {
      const result = OpenFolderSchema.safeParse({ folder })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid folder type' }
      }

      let path: string
      switch (result.data.folder) {
        case 'recordings':
          path = getRecordingsPath()
          break
        case 'transcripts':
          path = getTranscriptsPath()
          break
        case 'data':
          path = getStorageInfo().dataPath
          break
      }

      await shell.openPath(path)
      return { success: true, data: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Read recording file as base64 (for audio playback)
  ipcMain.handle('storage:read-recording', async (_, filePath: unknown) => {
    try {
      const result = ReadRecordingFileSchema.safeParse({ filePath })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid file path' }
      }

      const buffer = readRecordingFile(result.data.filePath)
      if (buffer) {
        return { success: true, data: buffer.toString('base64') }
      }
      return { success: false, error: 'File not found' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Delete recording file
  ipcMain.handle('storage:delete-recording', async (_, filePath: unknown) => {
    try {
      const result = DeleteRecordingFileSchema.safeParse({ filePath })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid file path' }
      }

      const deleted = deleteRecording(result.data.filePath)
      return { success: true, data: deleted }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Save recording from device and add to database/transcription queue
  ipcMain.handle('storage:save-recording', async (_, filename: unknown, data: unknown) => {
    try {
      const result = SaveRecordingSchema.safeParse({ filename, data })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid save recording request' }
      }

      const buffer = Buffer.from(result.data.data)
      const filePath = await saveRecording(result.data.filename, buffer)

      // Parse date from filename if possible
      const dateMatch = result.data.filename.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
      let dateRecorded: string
      if (dateMatch) {
        const [, year, month, day, hour, minute, second] = dateMatch
        dateRecorded = `${year}-${month}-${day}T${hour}:${minute}:${second}`
      } else {
        dateRecorded = new Date().toISOString()
      }

      // Generate ID from filename
      const recordingId = `rec_${result.data.filename.replace(/[^a-zA-Z0-9]/g, '_')}`

      // Insert into database
      const recording: Omit<Recording, 'created_at'> = {
        id: recordingId,
        filename: result.data.filename,
        original_filename: result.data.filename,
        file_path: filePath,
        file_size: buffer.length,
        duration_seconds: undefined, // Will be calculated after processing
        date_recorded: dateRecorded,
        meeting_id: undefined,
        correlation_confidence: undefined,
        correlation_method: undefined,
        status: 'pending'
      }

      insertRecording(recording)

      // Try to correlate with a meeting
      const recordingDate = new Date(dateRecorded)
      const startRange = new Date(recordingDate.getTime() - 2 * 60 * 60 * 1000)
      const endRange = new Date(recordingDate.getTime() + 2 * 60 * 60 * 1000)
      const meetings = getMeetings(startRange.toISOString(), endRange.toISOString())

      for (const meeting of meetings) {
        const meetingStart = new Date(meeting.start_time)
        const meetingEnd = new Date(meeting.end_time)

        if (recordingDate >= meetingStart && recordingDate <= meetingEnd) {
          linkRecordingToMeeting(recordingId, meeting.id, 0.9, 'time_overlap')
          break
        }
      }

      // Add to transcription queue
      addToQueue(recordingId)

      // Track this file as synced so we don't re-download it
      addSyncedFile(result.data.filename, result.data.filename, filePath, buffer.length)

      console.log(`Recording saved and queued for transcription: ${result.data.filename}`)
      return { success: true, data: filePath }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })
}
