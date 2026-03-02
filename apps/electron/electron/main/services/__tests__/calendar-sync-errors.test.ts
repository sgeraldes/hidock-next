import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B-CAL-004: Unit tests for categorizeCalendarError
 * Ensures errors are categorized correctly for user-facing messages.
 */

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    getName: vi.fn().mockReturnValue('test'),
  }
}))

// Mock file-storage (depends on Electron app)
vi.mock('../file-storage', () => ({
  getCachePath: vi.fn().mockReturnValue('/tmp/cache'),
}))

// Mock config (depends on Electron app)
vi.mock('../config', () => ({
  getConfig: vi.fn().mockReturnValue({
    calendar: { icsUrl: '', syncEnabled: false, syncIntervalMinutes: 15, lastSyncAt: null }
  }),
  updateConfig: vi.fn(),
}))

// Mock database
vi.mock('../database', () => ({
  upsertMeetingsBatch: vi.fn(),
}))

describe('categorizeCalendarError', () => {
  let categorizeCalendarError: typeof import('../calendar-sync').categorizeCalendarError

  beforeEach(async () => {
    const mod = await import('../calendar-sync')
    categorizeCalendarError = mod.categorizeCalendarError
  })

  describe('network errors', () => {
    it('should categorize fetch TypeError', () => {
      const result = categorizeCalendarError(new TypeError('Failed to fetch'))
      expect(result.category).toBe('network')
    })

    it('should categorize ECONNREFUSED errors', () => {
      const result = categorizeCalendarError(new Error('connect ECONNREFUSED 127.0.0.1:443'))
      expect(result.category).toBe('network')
    })

    it('should categorize ENOTFOUND errors', () => {
      const result = categorizeCalendarError(new Error('getaddrinfo ENOTFOUND calendar.example.com'))
      expect(result.category).toBe('network')
    })

    it('should categorize ETIMEDOUT errors', () => {
      const result = categorizeCalendarError(new Error('connect ETIMEDOUT'))
      expect(result.category).toBe('network')
    })

    it('should categorize HTTP status errors', () => {
      const result = categorizeCalendarError(new Error('Failed to fetch calendar: 500 Internal Server Error'))
      expect(result.category).toBe('network')
    })

    it('should categorize ERR_NETWORK errors', () => {
      const result = categorizeCalendarError(new Error('ERR_NETWORK'))
      expect(result.category).toBe('network')
    })
  })

  describe('parse errors', () => {
    it('should categorize ICAL parse errors', () => {
      const result = categorizeCalendarError(new Error('ICAL parse error: unexpected token'))
      expect(result.category).toBe('parse')
    })

    it('should categorize SyntaxError messages', () => {
      const result = categorizeCalendarError(new Error('SyntaxError: Unexpected end of input'))
      expect(result.category).toBe('parse')
    })

    it('should categorize invalid ical errors', () => {
      const result = categorizeCalendarError(new Error('invalid ical body'))
      expect(result.category).toBe('parse')
    })

    it('should categorize Unexpected token errors', () => {
      const result = categorizeCalendarError(new Error('Unexpected token < in JSON'))
      expect(result.category).toBe('parse')
    })
  })

  describe('database errors', () => {
    it('should categorize database error messages', () => {
      const result = categorizeCalendarError(new Error('Database error: SQLITE_CONSTRAINT'))
      expect(result.category).toBe('database')
    })

    it('should categorize sqlite constraint errors', () => {
      const result = categorizeCalendarError(new Error('SQLITE_BUSY: database is locked'))
      expect(result.category).toBe('database')
    })

    it('should categorize constraint violation errors', () => {
      const result = categorizeCalendarError(new Error('UNIQUE constraint failed: meetings.id'))
      expect(result.category).toBe('database')
    })
  })

  describe('validation errors', () => {
    it('should categorize URL validation errors', () => {
      const result = categorizeCalendarError(new Error('Only HTTP/HTTPS URLs are allowed'))
      expect(result.category).toBe('validation')
    })

    it('should categorize HTTPS requirement errors', () => {
      const result = categorizeCalendarError(new Error('HTTPS is required for calendar URLs'))
      expect(result.category).toBe('validation')
    })

    it('should categorize blocked URL errors', () => {
      const result = categorizeCalendarError(new Error('This URL is blocked for security reasons'))
      expect(result.category).toBe('validation')
    })

    it('should categorize Private IP errors', () => {
      const result = categorizeCalendarError(new Error('Private IP addresses are not allowed'))
      expect(result.category).toBe('validation')
    })
  })

  describe('unknown errors', () => {
    it('should categorize generic errors as unknown', () => {
      const result = categorizeCalendarError(new Error('Something went wrong'))
      expect(result.category).toBe('unknown')
    })

    it('should handle non-Error objects', () => {
      const result = categorizeCalendarError('a string error')
      expect(result.category).toBe('unknown')
      expect(result.message).toBe('a string error')
    })

    it('should handle null/undefined', () => {
      const result = categorizeCalendarError(null)
      expect(result.category).toBe('unknown')
    })
  })

  describe('message preservation', () => {
    it('should preserve the original error message for Error instances', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:443')
      const result = categorizeCalendarError(error)
      expect(result.message).toBe('connect ECONNREFUSED 127.0.0.1:443')
    })

    it('should stringify non-Error objects', () => {
      const result = categorizeCalendarError(42)
      expect(result.message).toBe('42')
    })
  })
})
