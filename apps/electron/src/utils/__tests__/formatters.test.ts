/**
 * Tests for formatting utilities (C-004)
 */
import { describe, it, expect } from 'vitest'
import { formatEta, formatBytes, formatDuration } from '../formatters'

describe('formatEta', () => {
  it('returns empty string for null', () => {
    expect(formatEta(null)).toBe('')
  })

  it('returns empty string for 0 or negative', () => {
    expect(formatEta(0)).toBe('')
    expect(formatEta(-5)).toBe('')
  })

  it('formats seconds under 60', () => {
    expect(formatEta(30)).toBe('30s')
    expect(formatEta(1)).toBe('1s')
    expect(formatEta(59)).toBe('59s')
  })

  it('formats minutes', () => {
    expect(formatEta(60)).toBe('1m')
    expect(formatEta(120)).toBe('2m')
    expect(formatEta(3599)).toBe('59m')
  })

  it('formats minutes with seconds in verbose mode', () => {
    expect(formatEta(90, true)).toBe('1m 30s remaining')
    expect(formatEta(60, true)).toBe('1m remaining')
  })

  it('formats hours', () => {
    expect(formatEta(3600)).toBe('1h')
    expect(formatEta(7200)).toBe('2h')
    expect(formatEta(5400)).toBe('1h 30m')
  })

  it('formats hours in verbose mode', () => {
    expect(formatEta(3600, true)).toBe('1h remaining')
    expect(formatEta(5400, true)).toBe('1h 30m remaining')
  })

  it('handles seconds with verbose suffix', () => {
    expect(formatEta(45, true)).toBe('45s remaining')
  })
})

describe('formatBytes (C-004)', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048575)).toBe('1024.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(1572864)).toBe('1.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB')
    expect(formatBytes(1610612736)).toBe('1.5 GB')
  })

  it('handles negative values', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(-1024)).toBe('0 B')
  })
})

describe('formatDuration (C-004)', () => {
  it('formats zero duration', () => {
    expect(formatDuration(0)).toBe('0:00')
  })

  it('formats seconds only', () => {
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(59)).toBe('0:59')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(90)).toBe('1:30')
    expect(formatDuration(125)).toBe('2:05')
  })

  it('formats large durations', () => {
    expect(formatDuration(3600)).toBe('60:00')
    expect(formatDuration(3661)).toBe('61:01')
  })

  it('handles negative values gracefully', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })

  it('handles fractional seconds', () => {
    expect(formatDuration(90.7)).toBe('1:30')
  })
})
