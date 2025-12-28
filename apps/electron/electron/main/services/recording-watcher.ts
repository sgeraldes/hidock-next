import { watch, existsSync, statSync, readdirSync } from 'fs'
import { join, extname, basename } from 'path'
import { getRecordingsPath } from './file-storage'
import {
  getRecordingById,
  insertRecording,
  getMeetings,
  linkRecordingToMeeting,
  addToQueue,
  Recording
} from './database'
import { BrowserWindow } from 'electron'
import { getConfig } from './config'

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.hda']

let watcher: ReturnType<typeof watch> | null = null
let mainWindow: BrowserWindow | null = null
let isWatching = false

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function startRecordingWatcher(): void {
  if (isWatching) {
    console.log('Recording watcher already running')
    return
  }

  const recordingsPath = getRecordingsPath()

  if (!existsSync(recordingsPath)) {
    console.log('Recordings path does not exist:', recordingsPath)
    return
  }

  console.log('Starting recording watcher at:', recordingsPath)

  // First, scan existing files that haven't been processed
  scanExistingRecordings()

  // Watch for new files
  watcher = watch(recordingsPath, { persistent: true }, (eventType, filename) => {
    if (eventType === 'rename' && filename) {
      const ext = extname(filename).toLowerCase()
      if (AUDIO_EXTENSIONS.includes(ext)) {
        const filePath = join(recordingsPath, filename)
        // Wait a moment for file to be fully written
        setTimeout(() => {
          if (existsSync(filePath)) {
            processNewRecording(filePath)
          }
        }, 1000)
      }
    }
  })

  isWatching = true
  console.log('Recording watcher started')
}

export function stopRecordingWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    isWatching = false
    console.log('Recording watcher stopped')
  }
}

async function scanExistingRecordings(): Promise<void> {
  const recordingsPath = getRecordingsPath()

  if (!existsSync(recordingsPath)) return

  const files = readdirSync(recordingsPath)

  for (const file of files) {
    const ext = extname(file).toLowerCase()
    if (!AUDIO_EXTENSIONS.includes(ext)) continue

    const filePath = join(recordingsPath, file)
    const recordingId = generateRecordingId(filePath)

    // Check if already in database
    const existing = getRecordingById(recordingId)
    if (!existing) {
      await processNewRecording(filePath)
    }
  }
}

function generateRecordingId(filePath: string): string {
  const filename = basename(filePath)
  // Use filename as base for ID (removes path variations)
  return `rec_${filename.replace(/[^a-zA-Z0-9]/g, '_')}`
}

async function processNewRecording(filePath: string): Promise<void> {
  try {
    const filename = basename(filePath)
    const stats = statSync(filePath)
    const recordingId = generateRecordingId(filePath)

    // Check if already processed
    const existing = getRecordingById(recordingId)
    if (existing) {
      console.log('Recording already in database:', filename)
      return
    }

    console.log('Processing new recording:', filename)

    // Parse date from filename if possible (format: YYYY-MM-DD_HHMM-description.ext)
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})/)
    let dateRecorded: string

    if (dateMatch) {
      const [, date, time] = dateMatch
      const hours = time.slice(0, 2)
      const minutes = time.slice(2, 4)
      dateRecorded = `${date}T${hours}:${minutes}:00`
    } else {
      // Use file modification time
      dateRecorded = stats.mtime.toISOString()
    }

    // Insert recording into database
    const recording: Omit<Recording, 'created_at'> = {
      id: recordingId,
      filename: filename,
      original_filename: filename,
      file_path: filePath,
      file_size: stats.size,
      duration_seconds: undefined, // Will be updated after processing
      date_recorded: dateRecorded,
      meeting_id: undefined,
      correlation_confidence: undefined,
      correlation_method: undefined,
      status: 'pending',
      location: 'local-only',
      on_device: 0,
      on_local: 1,
      transcription_status: 'pending',
      source: 'hidock',
      is_imported: 0
    }

    insertRecording(recording)
    console.log('Recording added to database:', recordingId)

    // Try to correlate with a meeting
    correlateWithMeeting(recordingId, new Date(dateRecorded))

    // Only add to transcription queue if auto-transcribe is enabled
    const config = getConfig()
    if (config.transcription.autoTranscribe) {
      addToQueue(recordingId)
      console.log('Recording added to transcription queue:', recordingId)
    } else {
      console.log('Auto-transcribe disabled, skipping queue for:', recordingId)
    }

    // Notify renderer
    notifyRenderer('recording:new', { recording })
  } catch (error) {
    console.error('Error processing recording:', error)
  }
}

function correlateWithMeeting(recordingId: string, recordingDate: Date): void {
  try {
    // Get meetings around the recording time (within 2 hours before/after)
    const startRange = new Date(recordingDate.getTime() - 2 * 60 * 60 * 1000)
    const endRange = new Date(recordingDate.getTime() + 2 * 60 * 60 * 1000)

    const meetings = getMeetings(startRange.toISOString(), endRange.toISOString())

    if (meetings.length === 0) {
      console.log('No meetings found for correlation')
      return
    }

    // Find the best matching meeting
    let bestMatch: { meetingId: string; confidence: number; method: string } | null = null

    for (const meeting of meetings) {
      const meetingStart = new Date(meeting.start_time)
      const meetingEnd = new Date(meeting.end_time)

      // Check if recording falls within meeting time
      if (recordingDate >= meetingStart && recordingDate <= meetingEnd) {
        // Recording is during meeting - high confidence
        const confidence = 0.9
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = {
            meetingId: meeting.id,
            confidence,
            method: 'time_overlap'
          }
        }
      } else {
        // Check if recording is close to meeting start/end
        const timeDiff = Math.min(
          Math.abs(recordingDate.getTime() - meetingStart.getTime()),
          Math.abs(recordingDate.getTime() - meetingEnd.getTime())
        )

        // Within 15 minutes of meeting
        if (timeDiff <= 15 * 60 * 1000) {
          const confidence = 0.7 - timeDiff / (30 * 60 * 1000) * 0.3
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = {
              meetingId: meeting.id,
              confidence,
              method: 'time_proximity'
            }
          }
        }
      }
    }

    if (bestMatch && bestMatch.confidence >= 0.5) {
      linkRecordingToMeeting(
        recordingId,
        bestMatch.meetingId,
        bestMatch.confidence,
        bestMatch.method
      )
      console.log(
        `Linked recording ${recordingId} to meeting ${bestMatch.meetingId} (confidence: ${bestMatch.confidence})`
      )
    }
  } catch (error) {
    console.error('Error correlating recording with meeting:', error)
  }
}

function notifyRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

export function getWatcherStatus(): { isWatching: boolean; path: string } {
  return {
    isWatching,
    path: getRecordingsPath()
  }
}
