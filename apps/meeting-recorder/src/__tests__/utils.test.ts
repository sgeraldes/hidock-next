import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cn,
  formatDuration,
  formatElapsedTime,
  formatBytes,
  getRelativeTime,
  isSameDay,
  isToday
} from '../lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    const condition = false as boolean
    expect(cn('foo', condition && 'bar', 'baz')).toBe('foo baz')
  })

  it('merges tailwind classes correctly (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(45000)).toBe('45s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(3661000)).toBe('1h 1m')
  })

  it('formats zero as 0s', () => {
    expect(formatDuration(0)).toBe('0s')
  })
})

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
  })
})

describe('isSameDay', () => {
  it('returns true for same day', () => {
    const a = new Date('2026-02-24T10:00:00')
    const b = new Date('2026-02-24T22:00:00')
    expect(isSameDay(a, b)).toBe(true)
  })

  it('returns false for different days', () => {
    const a = new Date('2026-02-24T10:00:00')
    const b = new Date('2026-02-25T10:00:00')
    expect(isSameDay(a, b)).toBe(false)
  })
})

describe('isToday', () => {
  it('returns true for today', () => {
    expect(isToday(new Date())).toBe(true)
  })

  it('returns false for yesterday', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(isToday(yesterday)).toBe(false)
  })
})

describe('formatElapsedTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-24T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats elapsed time from a start date', () => {
    const startedAt = new Date('2026-02-24T11:58:30')
    expect(formatElapsedTime(startedAt)).toBe('1m 30s')
  })

  it('accepts string date', () => {
    const startedAt = '2026-02-24T11:59:15'
    expect(formatElapsedTime(startedAt)).toBe('45s')
  })
})

describe('getRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-24T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "Just now" for < 1 minute ago', () => {
    const d = new Date('2026-02-24T11:59:30')
    expect(getRelativeTime(d)).toBe('Just now')
  })

  it('returns minutes ago', () => {
    const d = new Date('2026-02-24T11:55:00')
    expect(getRelativeTime(d)).toBe('5m ago')
  })

  it('returns hours ago', () => {
    const d = new Date('2026-02-24T10:00:00')
    expect(getRelativeTime(d)).toBe('2h ago')
  })
})
