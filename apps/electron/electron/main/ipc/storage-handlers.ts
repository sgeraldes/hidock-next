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

export function registerStorageHandlers(): void {
  // Get storage info
  ipcMain.handle('storage:get-info', async () => {
    return getStorageInfo()
  })

  // Open folder in file explorer
  ipcMain.handle('storage:open-folder', async (_, folder: 'recordings' | 'transcripts' | 'data') => {
    let path: string

    switch (folder) {
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
    return true
  })

  // Read recording file as base64 (for audio playback)
  ipcMain.handle('storage:read-recording', async (_, filePath: string) => {
    const buffer = readRecordingFile(filePath)
    if (buffer) {
      return buffer.toString('base64')
    }
    return null
  })

  // Delete recording file
  ipcMain.handle('storage:delete-recording', async (_, filePath: string) => {
    return deleteRecording(filePath)
  })

  // Save recording from device and add to database/transcription queue
  ipcMain.handle('storage:save-recording', async (_, filename: string, data: number[]) => {
    const buffer = Buffer.from(data)
    const filePath = await saveRecording(filename, buffer)

    // Parse date from filename if possible
    const dateMatch = filename.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
    let dateRecorded: string
    if (dateMatch) {
      const [, year, month, day, hour, minute, second] = dateMatch
      dateRecorded = `${year}-${month}-${day}T${hour}:${minute}:${second}`
    } else {
      dateRecorded = new Date().toISOString()
    }

    // Generate ID from filename
    const recordingId = `rec_${filename.replace(/[^a-zA-Z0-9]/g, '_')}`

    // Insert into database
    const recording: Omit<Recording, 'created_at'> = {
      id: recordingId,
      filename,
      original_filename: filename,
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
    addSyncedFile(filename, filename, filePath, buffer.length)

    console.log(`Recording saved and queued for transcription: ${filename}`)
    return filePath
  })
}
