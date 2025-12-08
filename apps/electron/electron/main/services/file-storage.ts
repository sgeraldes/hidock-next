import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join, basename, extname } from 'path'
import { getConfig, getDataPath } from './config'

export interface StorageInfo {
  dataPath: string
  recordingsPath: string
  transcriptsPath: string
  cachePath: string
  databasePath: string
  totalSizeBytes: number
  recordingsCount: number
}

export async function initializeFileStorage(): Promise<void> {
  const dataPath = getDataPath()

  const directories = [
    dataPath,
    join(dataPath, 'data'),
    join(dataPath, 'recordings'),
    join(dataPath, 'transcripts'),
    join(dataPath, 'cache')
  ]

  for (const dir of directories) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      console.log(`Created directory: ${dir}`)
    }
  }
}

export function getRecordingsPath(): string {
  return join(getDataPath(), 'recordings')
}

export function getTranscriptsPath(): string {
  return join(getDataPath(), 'transcripts')
}

export function getCachePath(): string {
  return join(getDataPath(), 'cache')
}

export function getDatabasePath(): string {
  return join(getDataPath(), 'data', 'hidock.db')
}

export async function saveRecording(
  filename: string,
  data: Buffer,
  meetingSubject?: string
): Promise<string> {
  const recordingsPath = getRecordingsPath()

  // Generate a clean filename with date prefix
  const date = new Date()
  const datePrefix = date.toISOString().split('T')[0]
  const timePrefix = date.toTimeString().slice(0, 5).replace(':', '')

  // Clean meeting subject for filename
  const subjectPart = meetingSubject
    ? '-' + meetingSubject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
    : ''

  const ext = extname(filename) || '.wav'
  const cleanFilename = `${datePrefix}_${timePrefix}${subjectPart}${ext}`

  const filePath = join(recordingsPath, cleanFilename)

  writeFileSync(filePath, data)

  return filePath
}

export async function saveTranscript(
  recordingFilename: string,
  transcript: string,
  format: 'txt' | 'json' = 'txt'
): Promise<string> {
  const transcriptsPath = getTranscriptsPath()

  // Use same base name as recording
  const baseName = basename(recordingFilename, extname(recordingFilename))
  const filename = `${baseName}.${format}`
  const filePath = join(transcriptsPath, filename)

  writeFileSync(filePath, transcript, 'utf-8')

  return filePath
}

export function readTranscript(filename: string): string | null {
  const transcriptsPath = getTranscriptsPath()
  const filePath = join(transcriptsPath, filename)

  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8')
  }

  return null
}

export function getRecordingFiles(): string[] {
  const recordingsPath = getRecordingsPath()

  if (!existsSync(recordingsPath)) {
    return []
  }

  return readdirSync(recordingsPath)
    .filter((file) => {
      const ext = extname(file).toLowerCase()
      return ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.hda'].includes(ext)
    })
    .map((file) => join(recordingsPath, file))
}

export function getStorageInfo(): StorageInfo {
  const dataPath = getDataPath()
  const recordingsPath = getRecordingsPath()
  const transcriptsPath = getTranscriptsPath()
  const cachePath = getCachePath()
  const databasePath = getDatabasePath()

  let totalSizeBytes = 0
  let recordingsCount = 0

  // Calculate recordings size
  if (existsSync(recordingsPath)) {
    const files = readdirSync(recordingsPath)
    recordingsCount = files.length
    for (const file of files) {
      const filePath = join(recordingsPath, file)
      const stats = statSync(filePath)
      totalSizeBytes += stats.size
    }
  }

  // Add transcripts size
  if (existsSync(transcriptsPath)) {
    const files = readdirSync(transcriptsPath)
    for (const file of files) {
      const filePath = join(transcriptsPath, file)
      const stats = statSync(filePath)
      totalSizeBytes += stats.size
    }
  }

  // Add database size
  if (existsSync(databasePath)) {
    const stats = statSync(databasePath)
    totalSizeBytes += stats.size
  }

  return {
    dataPath,
    recordingsPath,
    transcriptsPath,
    cachePath,
    databasePath,
    totalSizeBytes,
    recordingsCount
  }
}

export function deleteRecording(filePath: string): boolean {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      return true
    }
    return false
  } catch (error) {
    console.error('Error deleting recording:', error)
    return false
  }
}

export function readRecordingFile(filePath: string): Buffer | null {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath)
    }
    return null
  } catch (error) {
    console.error('Error reading recording file:', error)
    return null
  }
}
