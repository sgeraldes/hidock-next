/**
 * Activity Log Constants and Utilities
 *
 * Shared constants and helper functions for activity log management
 * across service and store layers.
 */

import type { ActivityLogEntry } from '@/services/hidock-device'

/**
 * Maximum number of activity log entries to retain.
 * Enforces bounded memory usage by keeping only the most recent entries.
 */
export const MAX_ACTIVITY_LOG_ENTRIES = 100

/**
 * Generates a unique deduplication key for an activity log entry.
 * The key combines timestamp (millisecond precision) and message content
 * to identify duplicate entries.
 *
 * @param entry Activity log entry
 * @returns Unique key string in format "timestamp-message"
 */
export function createActivityLogKey(entry: ActivityLogEntry): string {
  return `${entry.timestamp.getTime()}-${entry.message}`
}

/**
 * Validates that an activity log entry has all required fields
 * and valid data types.
 *
 * @param entry Value to validate
 * @returns true if entry is a valid ActivityLogEntry
 */
export function isValidActivityLogEntry(entry: unknown): entry is ActivityLogEntry {
  if (!entry || typeof entry !== 'object') return false
  const e = entry as any

  // Check required fields exist
  if (!e.timestamp || !e.message) return false

  // Validate timestamp is a valid Date
  if (!(e.timestamp instanceof Date)) return false
  if (isNaN(e.timestamp.getTime())) return false

  return true
}
