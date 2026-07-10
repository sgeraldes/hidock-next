import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTodayCaptures, isSameLocalDay } from '../useTodayCaptures'
import { useAppStore } from '@/store/useAppStore'
import type { UnifiedRecording } from '@/types/unified-recording'

/** Build a minimal UnifiedRecording good enough for getSourceType + the hook. */
function rec(overrides: Partial<UnifiedRecording> & { id: string; filename: string; dateRecorded: Date }): UnifiedRecording {
  return {
    size: 0,
    duration: 0,
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/x',
    syncStatus: 'synced',
    ...overrides
  } as UnifiedRecording
}

function seed(recordings: UnifiedRecording[]) {
  useAppStore.setState({ unifiedRecordings: recordings })
}

const NOON_TODAY = (() => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return d
})()

function todayAt(hours: number, minutes = 0): Date {
  const d = new Date(NOON_TODAY)
  d.setHours(hours, minutes, 0, 0)
  return d
}

function daysAgo(n: number): Date {
  const d = new Date(NOON_TODAY)
  d.setDate(d.getDate() - n)
  return d
}

describe('useTodayCaptures', () => {
  beforeEach(() => {
    seed([])
  })

  it('surfaces today\'s non-recording captures (screenshot, pdf, note)', () => {
    seed([
      rec({ id: 'img', filename: 'Screenshot 2026-07-10 14-05-09.png', title: 'Screenshot 2026-07-10 14-05-09.png', dateRecorded: todayAt(14, 5) }),
      rec({ id: 'pdf', filename: 'Q3-plan.pdf', title: 'Q3 plan', dateRecorded: todayAt(9, 30) }),
      rec({ id: 'note', filename: 'ideas.md', dateRecorded: todayAt(11) })
    ])

    const { result } = renderHook(() => useTodayCaptures(NOON_TODAY))

    // Newest first: img 14:05 › note 11:00 › pdf 09:30.
    expect(result.current.map((c) => c.id)).toEqual(['img', 'note', 'pdf'])
    expect(result.current.find((c) => c.id === 'img')!.type).toBe('image')
    expect(result.current.find((c) => c.id === 'pdf')!.type).toBe('pdf')
    expect(result.current.find((c) => c.id === 'note')!.type).toBe('note')
    // Title falls back to filename when no capture title.
    expect(result.current.find((c) => c.id === 'note')!.title).toBe('ideas.md')
  })

  it('excludes audio recordings — the agenda already shows those (no duplication)', () => {
    seed([
      rec({ id: 'audio-local', filename: '2025-07-10_1400.wav', dateRecorded: todayAt(14) }),
      rec({ id: 'audio-device', filename: 'REC1.hda', location: 'device-only', deviceFilename: 'REC1.hda', dateRecorded: todayAt(15) } as Partial<UnifiedRecording> & { id: string; filename: string; dateRecorded: Date }),
      rec({ id: 'img', filename: 'shot.png', dateRecorded: todayAt(13) })
    ])

    const { result } = renderHook(() => useTodayCaptures(NOON_TODAY))

    expect(result.current.map((c) => c.id)).toEqual(['img'])
  })

  it('is strictly current-day scoped — yesterday\'s captures are excluded', () => {
    seed([
      rec({ id: 'today-img', filename: 'today.png', dateRecorded: todayAt(10) }),
      rec({ id: 'old-img', filename: 'old.png', dateRecorded: daysAgo(1) }),
      rec({ id: 'older-pdf', filename: 'old.pdf', dateRecorded: daysAgo(3) })
    ])

    const { result } = renderHook(() => useTodayCaptures(NOON_TODAY))

    expect(result.current.map((c) => c.id)).toEqual(['today-img'])
  })

  it('returns nothing when there is nothing non-recording captured today', () => {
    seed([
      rec({ id: 'audio', filename: 'x.wav', dateRecorded: todayAt(9) }),
      rec({ id: 'old', filename: 'old.png', dateRecorded: daysAgo(2) })
    ])

    const { result } = renderHook(() => useTodayCaptures(NOON_TODAY))

    expect(result.current).toEqual([])
  })
})

describe('isSameLocalDay', () => {
  it('matches same calendar day, rejects different days', () => {
    expect(isSameLocalDay(todayAt(1), todayAt(23))).toBe(true)
    expect(isSameLocalDay(todayAt(12), daysAgo(1))).toBe(false)
  })
})
