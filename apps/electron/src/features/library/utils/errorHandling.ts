/**
 * Error Handling Utilities for Library
 *
 * Provides consistent error handling for audio playback, downloads, and transcription.
 */

export type LibraryErrorType =
  | 'audio_not_found'
  | 'audio_codec_error'
  | 'audio_permission_denied'
  | 'download_failed'
  | 'download_interrupted'
  | 'download_disk_full'
  | 'transcription_failed'
  | 'transcription_timeout'
  | 'transcription_rate_limit'
  | 'device_disconnected'
  | 'network_error'
  | 'unknown'

export interface LibraryError {
  type: LibraryErrorType
  message: string
  recoverable: boolean
  retryable: boolean
  details?: string
  sourceId?: string
}

/**
 * Parse an error and return a structured LibraryError
 */
export function parseError(error: unknown, context: string = ''): LibraryError {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorName = error instanceof Error ? error.name : ''

  // Audio playback errors
  if (context.includes('audio') || context.includes('play')) {
    if (errorName === 'NotFoundError' || errorMessage.includes('not found')) {
      return {
        type: 'audio_not_found',
        message: 'Audio file not found',
        recoverable: false,
        retryable: false,
        details: 'The audio file may have been moved or deleted.'
      }
    }
    if (errorName === 'NotSupportedError' || errorMessage.includes('codec') || errorMessage.includes('format')) {
      return {
        type: 'audio_codec_error',
        message: 'Audio format not supported',
        recoverable: false,
        retryable: false,
        details: 'Try re-downloading the file or converting to a supported format.'
      }
    }
    if (errorName === 'NotAllowedError' || errorMessage.includes('permission')) {
      return {
        type: 'audio_permission_denied',
        message: 'Permission denied to play audio',
        recoverable: true,
        retryable: true,
        details: 'Check your browser permissions for audio playback.'
      }
    }
  }

  // Download errors
  if (context.includes('download')) {
    if (errorMessage.includes('disk') || errorMessage.includes('space') || errorMessage.includes('full')) {
      return {
        type: 'download_disk_full',
        message: 'Not enough disk space',
        recoverable: true,
        retryable: true,
        details: 'Free up some disk space and try again.'
      }
    }
    if (errorMessage.includes('disconnect') || errorMessage.includes('USB')) {
      return {
        type: 'download_interrupted',
        message: 'Download interrupted',
        recoverable: true,
        retryable: true,
        details: 'Device was disconnected during download. Reconnect and try again.'
      }
    }
    return {
      type: 'download_failed',
      message: 'Download failed',
      recoverable: true,
      retryable: true,
      details: errorMessage
    }
  }

  // Transcription errors
  if (context.includes('transcri') || context.includes('process')) {
    if (errorMessage.includes('timeout')) {
      return {
        type: 'transcription_timeout',
        message: 'Transcription timed out',
        recoverable: true,
        retryable: true,
        details: 'The transcription service took too long. Try again or use a shorter audio file.'
      }
    }
    if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      return {
        type: 'transcription_rate_limit',
        message: 'Transcription service busy',
        recoverable: true,
        retryable: true,
        details: 'Too many requests. Please wait a moment and try again.'
      }
    }
    return {
      type: 'transcription_failed',
      message: 'Transcription failed',
      recoverable: true,
      retryable: true,
      details: errorMessage
    }
  }

  // Device errors
  if (errorMessage.includes('device') || errorMessage.includes('USB') || errorMessage.includes('disconnect')) {
    return {
      type: 'device_disconnected',
      message: 'Device disconnected',
      recoverable: true,
      retryable: true,
      details: 'Reconnect your HiDock device to continue.'
    }
  }

  // Network errors
  if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('connection')) {
    return {
      type: 'network_error',
      message: 'Network error',
      recoverable: true,
      retryable: true,
      details: 'Check your internet connection and try again.'
    }
  }

  // Unknown error
  return {
    type: 'unknown',
    message: 'An error occurred',
    recoverable: true,
    retryable: true,
    details: errorMessage
  }
}

/**
 * Get user-friendly message for an error type
 */
export function getErrorMessage(type: LibraryErrorType): string {
  const messages: Record<LibraryErrorType, string> = {
    audio_not_found: 'Audio file not found. The file may have been moved or deleted.',
    audio_codec_error: 'This audio format is not supported. Try re-downloading the file.',
    audio_permission_denied: 'Permission denied to play audio. Check your browser settings.',
    download_failed: 'Download failed. Please try again.',
    download_interrupted: 'Download interrupted. Reconnect your device and try again.',
    download_disk_full: 'Not enough disk space. Free up some space and try again.',
    transcription_failed: 'Transcription failed. Please try again.',
    transcription_timeout: 'Transcription timed out. Try again with a shorter audio file.',
    transcription_rate_limit: 'Transcription service is busy. Please wait and try again.',
    device_disconnected: 'Device disconnected. Please reconnect your HiDock.',
    network_error: 'Network error. Check your connection and try again.',
    unknown: 'An unexpected error occurred. Please try again.'
  }
  return messages[type]
}

/**
 * Get recovery action for an error type
 */
export function getRecoveryAction(
  type: LibraryErrorType
): { label: string; action: 'retry' | 'dismiss' | 'settings' | 'device' | 'delete' } | null {
  switch (type) {
    case 'audio_not_found':
      return { label: 'Remove from library', action: 'delete' }
    case 'audio_codec_error':
      return { label: 'Re-download', action: 'retry' }
    case 'audio_permission_denied':
      return { label: 'Open settings', action: 'settings' }
    case 'download_failed':
    case 'download_interrupted':
    case 'download_disk_full':
      return { label: 'Retry download', action: 'retry' }
    case 'transcription_failed':
    case 'transcription_timeout':
      return { label: 'Retry transcription', action: 'retry' }
    case 'transcription_rate_limit':
      return { label: 'Dismiss', action: 'dismiss' }
    case 'device_disconnected':
      return { label: 'Go to Device', action: 'device' }
    case 'network_error':
      return { label: 'Retry', action: 'retry' }
    case 'unknown':
      return { label: 'Dismiss', action: 'dismiss' }
    default:
      return null
  }
}

/**
 * Retry logic with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number; context?: string } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, context = '' } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const parsedError = parseError(error, context)

      // Don't retry non-retryable errors
      if (!parsedError.retryable) {
        throw error
      }

      // Don't retry after max attempts
      if (attempt === maxRetries) {
        throw error
      }

      // Exponential backoff: 1s, 2s, 4s, ...
      const delay = baseDelay * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
