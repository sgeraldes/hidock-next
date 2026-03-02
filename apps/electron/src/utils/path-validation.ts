/**
 * Path Validation Utilities
 * SECURITY: Prevents directory traversal attacks when accessing device files
 */

/**
 * Validates a device file path to prevent directory traversal attacks.
 *
 * SECURITY CONTEXT:
 * HiDock devices allow accessing files by path. Without validation, malicious
 * filenames like "../../../etc/passwd" could potentially access files outside
 * the intended recording directory on the device.
 *
 * @param path - The file path to validate
 * @returns true if the path is safe, false otherwise
 *
 * @example
 * validateDevicePath("REC001.wav") // true
 * validateDevicePath("../../../etc/passwd") // false
 * validateDevicePath("folder/file.wav") // false (no subdirectories allowed)
 */
export function validateDevicePath(path: string): boolean {
  // Reject empty or null paths
  if (!path || typeof path !== 'string') {
    return false
  }

  // Reject paths containing directory traversal attempts
  if (path.includes('..') || path.includes('/') || path.includes('\\')) {
    return false
  }

  // Reject paths with null bytes (common injection attack)
  if (path.includes('\0')) {
    return false
  }

  // Only allow alphanumeric characters, underscores, hyphens, and dots
  // Typical recording filename format: REC_YYYYMMDD_HHMMSS.wav or similar
  const safePattern = /^[a-zA-Z0-9_\-\.]+$/
  if (!safePattern.test(path)) {
    return false
  }

  // Reject paths that are just dots or start with a dot (hidden files)
  if (path === '.' || path === '..' || path.startsWith('.')) {
    return false
  }

  // Reject paths that are too long (prevent buffer overflow attacks)
  const MAX_FILENAME_LENGTH = 255 // Standard filesystem limit
  if (path.length > MAX_FILENAME_LENGTH) {
    return false
  }

  return true
}

/**
 * Sanitizes a device file path by removing dangerous characters.
 * If the path cannot be sanitized safely, returns null.
 *
 * @param path - The file path to sanitize
 * @returns Sanitized path or null if unsafe
 */
export function sanitizeDevicePath(path: string): string | null {
  if (!path || typeof path !== 'string') {
    return null
  }

  // Remove any directory components
  const filename = path.split('/').pop()?.split('\\').pop()
  if (!filename) {
    return null
  }

  // Remove dangerous characters
  const sanitized = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_')

  // Validate the sanitized result
  if (!validateDevicePath(sanitized)) {
    return null
  }

  return sanitized
}

/**
 * Validates a batch of device file paths.
 *
 * @param paths - Array of file paths to validate
 * @returns Object with valid paths and rejected paths
 */
export function validateDevicePaths(paths: string[]): {
  valid: string[]
  rejected: Array<{ path: string; reason: string }>
} {
  const valid: string[] = []
  const rejected: Array<{ path: string; reason: string }> = []

  for (const path of paths) {
    if (validateDevicePath(path)) {
      valid.push(path)
    } else {
      let reason = 'Invalid path format'
      if (path.includes('..')) {
        reason = 'Directory traversal attempt detected'
      } else if (path.includes('/') || path.includes('\\')) {
        reason = 'Subdirectories not allowed'
      } else if (path.length > 255) {
        reason = 'Path too long'
      }
      rejected.push({ path, reason })
    }
  }

  return { valid, rejected }
}
