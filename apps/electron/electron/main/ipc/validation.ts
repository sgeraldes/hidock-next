/**
 * Input validation utilities for IPC handlers
 * Prevents injection attacks and invalid data from reaching services
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validate recording ID format (UUID)
 */
export function validateRecordingId(id: unknown): string {
  if (typeof id !== 'string' || !id) {
    throw new ValidationError('Recording ID must be a non-empty string')
  }
  // UUID format: 8-4-4-4-12 hex digits
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ValidationError('Recording ID must be a valid UUID')
  }
  return id
}

/**
 * Validate array of recording IDs
 */
export function validateRecordingIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    throw new ValidationError('Recording IDs must be an array')
  }
  if (ids.length === 0) {
    throw new ValidationError('Recording IDs array cannot be empty')
  }
  if (ids.length > 1000) {
    throw new ValidationError('Too many recording IDs (max 1000)')
  }
  return ids.map((id, index) => {
    try {
      return validateRecordingId(id)
    } catch (error) {
      throw new ValidationError(`Invalid recording ID at index ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  })
}

/**
 * Validate quality level
 */
export function validateQualityLevel(quality: unknown): 'high' | 'medium' | 'low' {
  if (typeof quality !== 'string') {
    throw new ValidationError('Quality level must be a string')
  }
  if (!['high', 'medium', 'low'].includes(quality)) {
    throw new ValidationError('Quality level must be one of: high, medium, low')
  }
  return quality as 'high' | 'medium' | 'low'
}

/**
 * Validate storage tier
 */
export function validateStorageTier(tier: unknown): 'hot' | 'warm' | 'cold' | 'archive' {
  if (typeof tier !== 'string') {
    throw new ValidationError('Storage tier must be a string')
  }
  if (!['hot', 'warm', 'cold', 'archive'].includes(tier)) {
    throw new ValidationError('Storage tier must be one of: hot, warm, cold, archive')
  }
  return tier as 'hot' | 'warm' | 'cold' | 'archive'
}

/**
 * Validate optional string parameter
 */
export function validateOptionalString(value: unknown, maxLength = 10000): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new ValidationError('Value must be a string')
  }
  if (value.length > maxLength) {
    throw new ValidationError(`String too long (max ${maxLength} characters)`)
  }
  return value
}

/**
 * Validate boolean parameter
 */
export function validateBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError('Value must be a boolean')
  }
  return value
}

/**
 * Validate number parameter
 */
export function validateNumber(value: unknown, min?: number, max?: number): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new ValidationError('Value must be a valid number')
  }
  if (min !== undefined && value < min) {
    throw new ValidationError(`Value must be at least ${min}`)
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(`Value must be at most ${max}`)
  }
  return value
}

/**
 * Validate min age override object
 */
export function validateMinAgeOverride(override: unknown): Partial<Record<'hot' | 'warm' | 'cold' | 'archive', number>> | undefined {
  if (override === undefined || override === null) {
    return undefined
  }
  if (typeof override !== 'object' || Array.isArray(override)) {
    throw new ValidationError('Min age override must be an object')
  }

  const result: Partial<Record<'hot' | 'warm' | 'cold' | 'archive', number>> = {}
  const validTiers = ['hot', 'warm', 'cold', 'archive']

  for (const [key, value] of Object.entries(override)) {
    if (!validTiers.includes(key)) {
      throw new ValidationError(`Invalid tier in override: ${key}`)
    }
    if (typeof value !== 'number' || isNaN(value) || value < 0) {
      throw new ValidationError(`Min age for ${key} must be a non-negative number`)
    }
    result[key as 'hot' | 'warm' | 'cold' | 'archive'] = value
  }

  return result
}
