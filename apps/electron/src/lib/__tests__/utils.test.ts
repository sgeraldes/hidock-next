import { describe, it, expect } from 'vitest'
import { getRelativeTime, formatDateTime, formatDuration, formatBytes, validateId } from '../utils'

describe('getRelativeTime', () => {
  it('should return "Just now" for dates less than 1 minute ago', () => {
    const now = new Date()
    expect(getRelativeTime(now)).toBe('Just now')
    expect(getRelativeTime(new Date(now.getTime() - 30000))).toBe('Just now')
  })

  it('should return minutes ago for dates less than 1 hour ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000)
    expect(getRelativeTime(fiveMinAgo)).toBe('5m ago')
  })

  it('should return hours ago for dates less than 1 day ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600000)
    expect(getRelativeTime(threeHoursAgo)).toBe('3h ago')
  })

  it('should return days ago for dates less than 1 week ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000)
    expect(getRelativeTime(twoDaysAgo)).toBe('2d ago')
  })

  it('should return formatted date for dates over 1 week ago', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000)
    const result = getRelativeTime(twoWeeksAgo)
    // Should be a formatted date string, not relative
    expect(result).not.toContain('ago')
    expect(result).not.toBe('Just now')
  })

  it('should accept string dates', () => {
    const now = new Date().toISOString()
    expect(getRelativeTime(now)).toBe('Just now')
  })
})

describe('formatDateTime', () => {
  it('should format a date with day and time', () => {
    const date = new Date('2026-03-01T14:30:00')
    const result = formatDateTime(date)
    expect(result).toContain('at')
    expect(result).toContain('Mar')
  })

  it('should accept string dates', () => {
    const result = formatDateTime('2026-03-01T14:30:00')
    expect(result).toContain('Mar')
  })
})

describe('formatDuration', () => {
  it('should format seconds only', () => {
    expect(formatDuration(45)).toBe('45s')
  })

  it('should format minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s')
  })

  it('should format hours and minutes', () => {
    expect(formatDuration(3661)).toBe('1h 1m')
  })
})

describe('formatBytes', () => {
  it('should return 0 B for zero', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('should format KB', () => {
    expect(formatBytes(1024)).toBe('1 KB')
  })

  it('should format MB', () => {
    expect(formatBytes(1048576)).toBe('1 MB')
  })
})

describe('validateId', () => {
  it('should accept valid string IDs', () => {
    expect(validateId('abc-123')).toBe(true)
    expect(validateId('uuid-v4-like-id')).toBe(true)
  })

  it('should reject non-string values', () => {
    expect(validateId(123)).toBe(false)
    expect(validateId(null)).toBe(false)
    expect(validateId(undefined)).toBe(false)
  })

  it('should reject empty strings', () => {
    expect(validateId('')).toBe(false)
  })

  it('should reject prototype pollution attempts', () => {
    expect(validateId('__proto__')).toBe(false)
    expect(validateId('constructor')).toBe(false)
  })
})
