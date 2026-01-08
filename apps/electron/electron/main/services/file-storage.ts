import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync } from 'fs'
import { join, basename, extname, resolve, normalize } from 'path'
import { getDataPath } from './config'

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

/**
 * Create a WAV header for raw PCM audio data.
 * HiDock devices output 16kHz, mono, 16-bit PCM audio.
 */
function createWavHeader(dataLength: number, sampleRate = 16000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  const header = Buffer.alloc(44)

  // RIFF chunk descriptor
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4) // File size - 8
  header.write('WAVE', 8)

  // fmt sub-chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // Subchunk1 size (16 for PCM)
  header.writeUInt16LE(1, 20) // Audio format (1 = PCM)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)

  // data sub-chunk
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)

  return header
}

/**
 * Check if a buffer already has a valid WAV header.
 */
function hasWavHeader(data: Buffer): boolean {
  if (data.length < 44) return false
  const riff = data.toString('ascii', 0, 4)
  const wave = data.toString('ascii', 8, 12)
  return riff === 'RIFF' && wave === 'WAVE'
}

export async function saveRecording(
  filename: string,
  data: Buffer,
  _meetingSubject?: string,
  originalDate?: Date
): Promise<string> {
  const recordingsPath = getRecordingsPath()

  // Extract just the base filename without path
  const baseFilename = basename(filename)

  // Validate input filename to prevent any path traversal in the source
  validateFilename(baseFilename)

  // Preserve the original device filename, just change .hda to .wav
  // Device format: 2025Dec15-100105-Rec22.hda -> 2025Dec15-100105-Rec22.wav
  let cleanFilename = baseFilename
  const ext = extname(baseFilename).toLowerCase()
  const isHdaFile = ext === '.hda'
  if (isHdaFile) {
    cleanFilename = baseFilename.slice(0, -4) + '.wav'
  }

  // Validate the final path stays within recordings directory
  let filePath = validatePath(recordingsPath, cleanFilename)

  // Handle filename collision - add suffix if file already exists
  if (existsSync(filePath)) {
    const nameWithoutExt = cleanFilename.slice(0, cleanFilename.lastIndexOf('.'))
    const extension = cleanFilename.slice(cleanFilename.lastIndexOf('.'))
    let counter = 1
    while (existsSync(filePath)) {
      cleanFilename = `${nameWithoutExt}-${counter}${extension}`
      filePath = validatePath(recordingsPath, cleanFilename)
      counter++
    }
  }

  // For HDA files (raw PCM from HiDock device), add WAV header if not already present
  // HiDock outputs 16kHz, mono, 16-bit PCM audio
  let dataToWrite = data
  if (isHdaFile && !hasWavHeader(data)) {
    const wavHeader = createWavHeader(data.length)
    dataToWrite = Buffer.concat([wavHeader, data])
    console.log(`[FileStorage] Added WAV header to ${cleanFilename} (${data.length} bytes PCM -> ${dataToWrite.length} bytes WAV)`)
  }

  writeFileSync(filePath, dataToWrite)

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

    // Count unique recordings by base filename (pair .hda + .wav = 1 recording)
    const recordingMap = new Set<string>()
    for (const file of files) {
      const filePath = join(recordingsPath, file)
      const stats = statSync(filePath)
      totalSizeBytes += stats.size

      // Extract base filename without extension to count unique recordings
      const baseName = file.replace(/\.(hda|wav|mp3|m4a|aac|ogg|flac|webm|pptx|docx|md|txt|pdf)$/i, '')
      recordingMap.add(baseName)
    }
    recordingsCount = recordingMap.size
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

/**
 * Delete all downloaded recordings with wrong naming format.
 * Wrong format: 2025-12-27_2252.wav (generated during download)
 * Correct format: 2025Dec15-100105-Rec22.wav (preserved from device)
 */
export function deleteWronglyNamedRecordings(): { deleted: string[]; kept: string[] } {
  const recordingsPath = getRecordingsPath()
  const deleted: string[] = []
  const kept: string[] = []

  if (!existsSync(recordingsPath)) {
    return { deleted, kept }
  }

  const files = readdirSync(recordingsPath)
  // Wrong format pattern: YYYY-MM-DD_HHMM (e.g., 2025-12-27_2252)
  const wrongFormatPattern = /^\d{4}-\d{2}-\d{2}_\d{4}/

  for (const file of files) {
    if (wrongFormatPattern.test(file)) {
      const filePath = join(recordingsPath, file)
      try {
        unlinkSync(filePath)
        deleted.push(file)
        console.log(`Deleted wrongly-named file: ${file}`)
      } catch (error) {
        console.error(`Failed to delete ${file}:`, error)
      }
    } else {
      kept.push(file)
    }
  }

  console.log(`Cleanup complete: deleted ${deleted.length} files, kept ${kept.length} files`)
  return { deleted, kept }
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
      let data = readFileSync(filePath)

      // For .wav files that are missing WAV header (legacy HiDock downloads),
      // add header on-the-fly to make them playable
      const ext = extname(filePath).toLowerCase()
      if (ext === '.wav' && !hasWavHeader(data)) {
        console.log(`[FileStorage] Adding WAV header on-the-fly for playback: ${basename(filePath)}`)
        const wavHeader = createWavHeader(data.length)
        data = Buffer.concat([wavHeader, data])
      }

      return data
    }
    return null
  } catch (error) {
    console.error('Error reading recording file:', error)
    return null
  }
}
