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

// Month name mapping for HiDock filename parsing
const MONTH_NAMES: Record<string, number> = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
  'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
}

/**
 * Parse recording date from HiDock filename formats.
 * Supports:
 * - 2025Jul08-160405-Rec59.hda (YYYYMonDD-HHMMSS format)
 * - HDA_20250708_160405.hda (HDA_YYYYMMDD_HHMMSS format)
 * - 2025-07-08_1604.hda (YYYY-MM-DD_HHMM format)
 */
function parseHiDockFilenameDate(filename: string): Date | undefined {
  // Format 1: 2025Jul08-160405-Rec59.hda (YYYYMonDD-HHMMSS)
  const monthNameMatch = filename.match(/(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})-(\d{2})(\d{2})(\d{2})/)
  if (monthNameMatch) {
    const [, year, monthName, day, hour, minute, second] = monthNameMatch
    const month = MONTH_NAMES[monthName]
    if (month !== undefined) {
      return new Date(
        parseInt(year),
        month,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      )
    }
  }

  // Format 2: HDA_20250708_160405.hda or YYYYMMDDHHMMSS
  const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})(\d{2})(\d{2})/)
  if (numericMatch) {
    const [, year, month, day, hour, minute, second] = numericMatch
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    )
  }

  // Format 3: 2025-07-08_1604.hda (YYYY-MM-DD_HHMM)
  const shortMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/)
  if (shortMatch) {
    const [, year, month, day, hour, minute] = shortMatch
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      0
    )
  }

  return undefined
}

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
  // recordingDateIso is the original recording date from the device (optional)
  ipcMain.handle('storage:save-recording', async (_, filename: unknown, data: unknown, recordingDateIso?: string) => {
    try {
      const result = SaveRecordingSchema.safeParse({ filename, data })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid save recording request' }
      }

      // Parse the original recording date if provided
      let originalDate: Date | undefined
      if (recordingDateIso) {
        originalDate = new Date(recordingDateIso)
        if (isNaN(originalDate.getTime())) {
          console.warn('Invalid recording date provided:', recordingDateIso)
          originalDate = undefined
        }
      }

      // If no date was passed, try to parse from HiDock filename formats
      if (!originalDate) {
        originalDate = parseHiDockFilenameDate(result.data.filename)
      }

      const buffer = Buffer.from(result.data.data)
      const filePath = await saveRecording(result.data.filename, buffer, undefined, originalDate)

      // Use the parsed date or fall back to current time
      const dateRecorded = originalDate?.toISOString() || new Date().toISOString()

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
