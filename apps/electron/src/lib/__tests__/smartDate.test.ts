/**
 * smartDate — honest rendering of the UNKNOWN_DATE (epoch) sentinel.
 *
 * Part of the #58 "months-apart bundling" fix: undated recordings carry the Unix
 * epoch sentinel, and every date surface must render it as "Unknown date" (never
 * "Jan 1, 1970" and never a fabricated today), with no misleading relative hint.
 */
import { describe, it, expect } from 'vitest'
import { formatSmartDate, formatRelativeDate, formatSmartDateWithRelative } from '../smartDate'

describe('smartDate — epoch sentinel is treated as "no date"', () => {
  it('formatSmartDate renders the epoch as "Unknown date", not 1970', () => {
    expect(formatSmartDate(new Date(0))).toBe('Unknown date')
    expect(formatSmartDate(new Date(0), { time: true })).toBe('Unknown date')
    expect(formatSmartDate(0)).toBe('Unknown date')
  })

  it('formatSmartDate honors a custom fallback for the epoch', () => {
    expect(formatSmartDate(new Date(0), { fallback: '—' })).toBe('—')
  })

  it('formatRelativeDate returns null for the epoch (no "56 yr ago")', () => {
    expect(formatRelativeDate(new Date(0))).toBeNull()
  })

  it('formatSmartDateWithRelative collapses the epoch to "Unknown date"', () => {
    expect(formatSmartDateWithRelative(new Date(0))).toBe('Unknown date')
  })

  it('still renders real dates normally (regression guard)', () => {
    const real = new Date('2025-05-13T16:04:05')
    expect(formatSmartDate(real, { time: false })).toBe('May 13, 2025')
    expect(formatRelativeDate(real)).not.toBeNull()
  })
})
