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
