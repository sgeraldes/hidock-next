import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getRowMeta } from '../rowMeta'
import { formatDuration } from '@/lib/utils'
import type { UnifiedRecording } from '@/types/unified-recording'

const DATE = new Date('2026-07-08T19:02:00')
// Fixed "now" two days after DATE so the relative hint is deterministic.
const NOW = new Date('2026-07-10T19:02:00')

function make(filename: string, duration: number, dateRecorded: Date = DATE, location: UnifiedRecording['location'] = 'local-only'): UnifiedRecording {
  return { filename, location, duration, dateRecorded } as UnifiedRecording
}

describe('getRowMeta', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('audio shows date-with-year + time, duration, and a relative hint', () => {
    const meta = getRowMeta(make('a.wav', 2680))
    expect(meta.type).toBe('audio')
    expect(meta.parts).toHaveLength(3)
    // The absolute date part carries the YEAR and the day.
    expect(meta.parts[0]).toContain('2026')
    expect(meta.parts[0]).toMatch(/Jul 8/)
    // Real duration is present, not blank / "Unknown".
    expect(meta.parts).toContain(formatDuration(2680))
    // Relative recency hint at the end.
    expect(meta.parts[meta.parts.length - 1]).toMatch(/ago|just now/)
    expect(meta.Icon).toBeDefined()
  })

  it('shows the correct (older) year for a year-old capture — not this year', () => {
    const lastYear = new Date('2025-08-21T11:14:00')
    const meta = getRowMeta(make('old.wav', 100, lastYear))
    expect(meta.parts[0]).toContain('2025')
    expect(meta.parts[0]).not.toContain('2026')
    // A year-old capture reads "1 yr ago", never like this week's.
    expect(meta.parts[meta.parts.length - 1]).toMatch(/yr ago|mo ago/)
  })

  it('audio without a known duration omits the duration part (no blank / "Unknown")', () => {
    const meta = getRowMeta(make('a.wav', 0))
    expect(meta.type).toBe('audio')
    // [date+time, relative] — duration fragment absent.
    expect(meta.parts).toHaveLength(2)
    expect(meta.parts.join(' ')).not.toContain('Unknown')
    expect(meta.parts.some((p) => /\d+m \d+s|\d+h \d+m|\b\d+s\b/.test(p))).toBe(false)
  })

  it('image shows the type label + date-with-year and NEVER a duration', () => {
    const meta = getRowMeta(make('shot.png', 0))
    expect(meta.type).toBe('image')
    expect(meta.parts[0]).toBe('Image')
    expect(meta.parts[1]).toContain('2026')
    // No "Xm Ys" duration fragment anywhere.
    expect(meta.parts.some((p) => /\d+m \d+s|\d+h \d+m|\b\d+s\b/.test(p))).toBe(false)
  })

  it('pdf shows the type label + date-with-year, no duration', () => {
    const meta = getRowMeta(make('doc.pdf', 0))
    expect(meta.type).toBe('pdf')
    expect(meta.parts[0]).toBe('PDF')
    expect(meta.parts[1]).toContain('2026')
    expect(meta.parts.some((p) => /\d+m \d+s|\d+h \d+m|\b\d+s\b/.test(p))).toBe(false)
  })

  it('note shows the type label + date-with-year', () => {
    const meta = getRowMeta(make('notes.md', 0))
    expect(meta.type).toBe('note')
    expect(meta.parts[0]).toBe('Note')
    expect(meta.parts[1]).toContain('2026')
  })
})
