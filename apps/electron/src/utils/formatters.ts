/**
 * Common formatting utilities used across components.
 */

/**
 * Format seconds remaining into a human-readable ETA string.
 *
 * @param seconds - Seconds remaining (null or <= 0 returns empty string)
 * @param verbose - If true, includes "remaining" suffix (e.g., "5m 30s remaining")
 */
export function formatEta(seconds: number | null, verbose = false): string {
  if (seconds === null || seconds <= 0) return ''
  const suffix = verbose ? ' remaining' : ''

  if (seconds < 60) return `${seconds}s${suffix}`

  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (verbose && secs > 0) return `${mins}m ${secs}s${suffix}`
    return `${mins}m${suffix}`
  }

  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m${suffix}` : `${hours}h${suffix}`
}

/**
 * C-004: Format byte count into human-readable string (e.g., "1.5 MB", "128 KB").
 * Shared utility to replace duplicate formatBytes/formatFileSize implementations.
 *
 * @param bytes - Number of bytes
 */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * C-004: Format duration in seconds to "m:ss" string.
 * Shared utility to replace duplicate formatDuration implementations.
 *
 * @param seconds - Duration in seconds
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
