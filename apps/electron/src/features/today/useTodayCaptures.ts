import { useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { getSourceType, type LibrarySourceType } from '@/features/library/utils/sourceType'
import type { UnifiedRecording } from '@/types/unified-recording'

/**
 * A non-recording knowledge moment captured on the current day.
 *
 * The Today agenda already surfaces the day's audio recordings (via the ribbon
 * and the follow-ups digest). This hook adds the OTHER things captured today —
 * clipboard screenshots, imported PDFs, notes, data files — so the agenda tells
 * the whole story of the day, not just its meetings.
 */
export interface TodayCapture {
  /** UnifiedRecording id — used to deep-link into the Library (selectedId). */
  id: string
  /** Human title (capture title, falling back to the filename). */
  title: string
  /** Derived artifact kind. Never `audio` — those are the agenda's recordings. */
  type: Exclude<LibrarySourceType, 'audio'>
  /** When it was captured/added (local time). */
  date: Date
}

/** True when both dates fall on the same calendar day in the local timezone. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** A recording is "captured today" when its recorded/added date is the current local day. */
function capturedToday(rec: UnifiedRecording, today: Date): boolean {
  const d = rec.dateRecorded
  return d instanceof Date && !isNaN(d.getTime()) && isSameLocalDay(d, today)
}

/**
 * Today's non-recording captures, newest first.
 *
 * Reuses the SAME unified-recordings source the Library reads (the store slice
 * populated by `useUnifiedRecordings`) plus `getSourceType`, so there is a single
 * source of truth. We deliberately read the store slice rather than re-running the
 * device-fetching hook: the Layout's OperationsPanel already mounts
 * `useUnifiedRecordings` app-wide, so the data is present on every page without
 * Today triggering its own USB/device side effects.
 *
 * Filtering:
 *  - scoped strictly to the CURRENT local day (never a multi-day history), and
 *  - audio recordings are excluded — the agenda already shows those, so we never
 *    duplicate a recording here.
 *
 * @param nowInput optional clock override (tests); defaults to `new Date()`.
 */
export function useTodayCaptures(nowInput?: Date): TodayCapture[] {
  const recordings = useAppStore((s) => s.unifiedRecordings) as UnifiedRecording[]
  // Anchor the day-boundary once per render to a stable millisecond value so the
  // memo below doesn't thrash on every `new Date()` identity.
  const todayMs = nowInput ? nowInput.getTime() : Date.now()

  return useMemo(() => {
    const today = new Date(todayMs)
    const out: TodayCapture[] = []
    for (const rec of recordings) {
      const type = getSourceType(rec)
      if (type === 'audio') continue // agenda already shows recordings — no duplicates
      if (!capturedToday(rec, today)) continue
      out.push({
        id: rec.id,
        title: rec.title || rec.filename || 'Untitled',
        type,
        date: rec.dateRecorded
      })
    }
    // Newest first — mirrors the follow-ups digest ordering.
    out.sort((a, b) => b.date.getTime() - a.date.getTime())
    return out
  }, [recordings, todayMs])
}
