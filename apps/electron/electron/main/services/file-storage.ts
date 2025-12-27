import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync } from 'fs'
import { join, basename, extname, resolve, normalize } from 'path'
import { getConfig, getDataPath } from './config'

/**
 * Validate that a path stays within the allowed base directory.
 * Prevents path traversal attacks (e.g., "../../../etc/passwd").
 */
export function validatePath(basePath: string, userPath: string): string {
  // Normalize and resolve the paths
  const normalizedBase = normalize(resolve(basePath))
  const resolvedPath = normalize(resolve(basePath, userPath))

  // Check if the resolved path starts with the base path
  if (!resolvedPath.startsWith(normalizedBase)) {
    throw new Error(`Invalid path: path traversal detected. Path must stay within ${normalizedBase}`)
  }

  return resolvedPath
}

/**
 * Validate a filename to prevent path traversal and invalid characters.
 */
export function validateFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename: filename is required')
  }

  // Remove any path separators and dangerous characters
  const sanitized = filename.replace(/[\\/:*?"<>|]/g, '')

  // Check for path traversal attempts
  if (filename.includes('..') || filename !== sanitized || !sanitized.length) {
    throw new Error('Invalid filename: contains illegal characters or path traversal attempt')
  }

  // Limit filename length
  if (sanitized.length > 255) {
    throw new Error('Invalid filename: exceeds maximum length of 255 characters')
  }

  return sanitized
}

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
  meetingSubject?: string,
  originalDate?: Date
): Promise<string> {
  const recordingsPath = getRecordingsPath()

  // Validate input filename to prevent any path traversal in the source
  validateFilename(basename(filename))

  // Use the original recording date from device, or fall back to current date
  const date = originalDate || new Date()
  const datePrefix = date.toISOString().split('T')[0]
  const timePrefix = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`

  // Clean meeting subject for filename
  const subjectPart = meetingSubject
    ? '-' + meetingSubject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
    : ''

  // Convert .hda to .wav since HDA files are actually WAV format
  let ext = extname(filename) || '.wav'
  if (ext.toLowerCase() === '.hda') {
    ext = '.wav'
  }
  const cleanFilename = `${datePrefix}_${timePrefix}${subjectPart}${ext}`

  // Validate the final path stays within recordings directory
  const filePath = validatePath(recordingsPath, cleanFilename)

  writeFileSync(filePath, data)

  // Set the file's modification time to the original recording date
  // This ensures file explorer shows the correct date
  if (originalDate) {
    try {
      utimesSync(filePath, originalDate, originalDate)
    } catch (error) {
      console.warn('Failed to set file modification time:', error)
    }
  }

  return filePath
}

export async function saveTranscript(
  recordingFilename: string,
  transcript: string,
  format: 'txt' | 'json' = 'txt'
): Promise<string> {
  const transcriptsPath = getTranscriptsPath()

  // Extract just the filename without any path components
  const rawBaseName = basename(recordingFilename, extname(recordingFilename))

  // Validate the base name to prevent path traversal
  const safeName = validateFilename(rawBaseName)
  const filename = `${safeName}.${format}`

  // Validate the final path stays within transcripts directory
  const filePath = validatePath(transcriptsPath, filename)

  writeFileSync(filePath, transcript, 'utf-8')

  return filePath
}

export function readTranscript(filename: string): string | null {
  const transcriptsPath = getTranscriptsPath()

  // Validate filename to prevent path traversal
  const validFilename = validateFilename(filename)
  const filePath = validatePath(transcriptsPath, validFilename)

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
    // Validate that the path is within allowed directories
    const recordingsPath = getRecordingsPath()
    const transcriptsPath = getTranscriptsPath()

    // Normalize the path for comparison
    const normalizedPath = normalize(resolve(filePath))
    const normalizedRecordings = normalize(resolve(recordingsPath))
    const normalizedTranscripts = normalize(resolve(transcriptsPath))

    // Only allow deletion of files within recordings or transcripts directories
    if (!normalizedPath.startsWith(normalizedRecordings) && !normalizedPath.startsWith(normalizedTranscripts)) {
      console.error('Attempted to delete file outside allowed directories:', filePath)
      return false
    }

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
    // Validate that the path is within allowed directories
    const recordingsPath = getRecordingsPath()
    const transcriptsPath = getTranscriptsPath()

    // Normalize the path for comparison
    const normalizedPath = normalize(resolve(filePath))
    const normalizedRecordings = normalize(resolve(recordingsPath))
    const normalizedTranscripts = normalize(resolve(transcriptsPath))

    // Only allow reading files within recordings or transcripts directories
    if (!normalizedPath.startsWith(normalizedRecordings) && !normalizedPath.startsWith(normalizedTranscripts)) {
      console.error('Attempted to read file outside allowed directories:', filePath)
      return null
    }

    if (existsSync(filePath)) {
      return readFileSync(filePath)
    }
    return null
  } catch (error) {
    console.error('Error reading recording file:', error)
    return null
  }
}
