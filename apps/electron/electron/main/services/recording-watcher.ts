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
  const audioFiles = files.filter(file => {
    const ext = extname(file).toLowerCase()
    return AUDIO_EXTENSIONS.includes(ext)
  })

  if (audioFiles.length === 0) return

  console.log(`[RecordingWatcher] Scanning ${audioFiles.length} existing recordings...`)

  // Batch check: which files need processing
  const filesToProcess: string[] = []

  for (const file of audioFiles) {
    const filePath = join(recordingsPath, file)
    const recordingId = generateRecordingId(filePath)

    // Check if already in database
    const existing = getRecordingById(recordingId)
    if (!existing) {
      filesToProcess.push(filePath)
    }
  }

  if (filesToProcess.length === 0) {
    console.log('[RecordingWatcher] All recordings already in database')
    return
  }

  console.log(`[RecordingWatcher] Processing ${filesToProcess.length} new recordings...`)

  // Process files - this is the slow part, but we need to check meeting correlation
  // Process in batches to avoid blocking the event loop too long
  const batchSize = 50
  for (let i = 0; i < filesToProcess.length; i += batchSize) {
    const batch = filesToProcess.slice(i, i + batchSize)
    await Promise.all(batch.map(filePath => processNewRecording(filePath)))

    // Log progress for large batches
    if (filesToProcess.length > 100 && (i + batchSize) % 100 === 0) {
      console.log(`[RecordingWatcher] Processed ${Math.min(i + batchSize, filesToProcess.length)}/${filesToProcess.length} recordings...`)
    }
  }

  console.log(`[RecordingWatcher] Finished scanning ${filesToProcess.length} recordings`)
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

    // Check if already in database (by ID or filename)
    // This prevents duplicates when files are downloaded (which have UUIDs) vs external files
    let existing = getRecordingById(recordingId)
    
    // If not found by generated ID, check by filename (how device files are stored)
    if (!existing) {
      // Import here to avoid circular dependencies if possible, or use the imported one
      const { getRecordingByFilename, updateRecordingLifecycle } = await import('./database')
      existing = getRecordingByFilename(filename)
      
      // If found by filename, it might be a device-only record becoming local
      if (existing) {
        // Individual recording logs disabled for performance
        
        // If it doesn't have a file path yet, update it
        if (!existing.file_path) {
          updateRecordingLifecycle(existing.id, {
            file_path: filePath,
            on_local: 1,
            // If it was device-only, now it's both. If it was deleted/unknown, now local-only.
            location: existing.on_device ? 'both' : 'local-only'
          })
          // Individual recording logs disabled for performance
        }
        return
      }
    } else {
      // Individual recording logs disabled for performance
      return
    }

    // Individual recording logs disabled for performance

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
    // Individual recording logs disabled for performance

    // Try to correlate with a meeting
    correlateWithMeeting(recordingId, new Date(dateRecorded))

    // Only add to transcription queue if auto-transcribe is enabled
    const config = getConfig()
    if (config.transcription.autoTranscribe) {
      addToQueue(recordingId)
      // Individual recording logs disabled for performance
    } else {
      // Individual recording logs disabled for performance
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
