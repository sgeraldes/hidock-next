import { describe, it, expect } from 'vitest'
import { getRowMeta } from '../rowMeta'
import { formatDuration } from '@/lib/utils'
import type { UnifiedRecording } from '@/types/unified-recording'

const DATE = new Date('2026-07-08T19:02:00')

function make(filename: string, duration: number, location: UnifiedRecording['location'] = 'local-only'): UnifiedRecording {
  return { filename, location, duration, dateRecorded: DATE } as UnifiedRecording
}

describe('getRowMeta', () => {
  it('audio shows date, time and duration', () => {
    const meta = getRowMeta(make('a.wav', 2680))
    expect(meta.type).toBe('audio')
    expect(meta.parts).toHaveLength(3)
    expect(meta.parts).toContain(formatDuration(2680))
    expect(meta.Icon).toBeDefined()
  })

  it('audio without a known duration omits the duration part', () => {
    const meta = getRowMeta(make('a.wav', 0))
    expect(meta.type).toBe('audio')
    expect(meta.parts).toHaveLength(2)
    expect(meta.parts.join(' ')).not.toContain('s')
  })

  it('image shows the type label + date and NEVER a duration', () => {
    const meta = getRowMeta(make('shot.png', 0))
    expect(meta.type).toBe('image')
    expect(meta.parts[0]).toBe('Image')
    expect(meta.parts).toHaveLength(2)
    // No "Xm Ys" duration fragment anywhere.
    expect(meta.parts.some((p) => /\d+m \d+s|\d+h \d+m|\b\d+s\b/.test(p))).toBe(false)
  })

  it('pdf shows the type label + date, no duration', () => {
    const meta = getRowMeta(make('doc.pdf', 0))
    expect(meta.type).toBe('pdf')
    expect(meta.parts[0]).toBe('PDF')
    expect(meta.parts).toHaveLength(2)
  })

  it('note shows the type label + date', () => {
    const meta = getRowMeta(make('notes.md', 0))
    expect(meta.type).toBe('note')
    expect(meta.parts[0]).toBe('Note')
  })
})
