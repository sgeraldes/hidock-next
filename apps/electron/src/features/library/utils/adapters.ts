/**
 * Adapters for converting between data models
 */

import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { AudioSource, ProcessingStatus, SourceLocation } from '../types/source'

/**
 * Convert UnifiedRecording to AudioSource
 *
 * This adapter allows gradual migration from the current UnifiedRecording model
 * to the new Source model while maintaining backward compatibility.
 */
export function unifiedRecordingToAudioSource(recording: UnifiedRecording): AudioSource {
  // Map location
  let location: SourceLocation
  switch (recording.location) {
    case 'device-only':
      location = 'device-only'
      break
    case 'local-only':
      location = 'local-only'
      break
    case 'both':
      location = 'both'
      break
    default:
      location = 'local-only'
  }

  // Map processing status
  let processingStatus: ProcessingStatus
  switch (recording.transcriptionStatus) {
    case 'complete':
      processingStatus = 'ready'
      break
    case 'processing':
      processingStatus = 'processing'
      break
    case 'pending':
      processingStatus = 'queued'
      break
    case 'error':
      processingStatus = 'error'
      break
    default:
      processingStatus = 'none'
  }

  const source: AudioSource = {
    id: recording.id,
    type: 'audio',
    title: recording.title || recording.filename,
    capturedAt: recording.dateRecorded.toISOString(),
    location,
    processingStatus,
    filename: recording.filename,
    transcriptionStatus: recording.transcriptionStatus,
    size: recording.size,
    duration: recording.duration,
    quality: recording.quality,
    category: recording.category as AudioSource['category'],
    summary: recording.summary
  }

  // Add location-specific fields
  if (hasLocalPath(recording)) {
    source.localPath = recording.localPath
  }

  if (isDeviceOnly(recording) || recording.location === 'both') {
    source.deviceFilename = recording.deviceFilename
  }

  // Add linked entities
  if (recording.meetingId) {
    source.meetingId = recording.meetingId
  }

  if (recording.knowledgeCaptureId) {
    source.knowledgeCaptureId = recording.knowledgeCaptureId
  }

  return source
}

/**
 * Convert array of UnifiedRecordings to AudioSources
 */
export function unifiedRecordingsToAudioSources(recordings: UnifiedRecording[]): AudioSource[] {
  return recordings.map(unifiedRecordingToAudioSource)
}

/**
 * Get a display title for a source
 */
export function getSourceDisplayTitle(source: AudioSource): string {
  return source.title || source.filename
}

/**
 * Get a formatted date string for a source
 */
export function getSourceDateDisplay(source: AudioSource): string {
  const date = new Date(source.capturedAt)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
