/**
 * useStream — the Today page's data hook.
 *
 * Aggregates "moments" from the app's existing data and shapes them into the
 * day-grouped feed plus the right-rail rollups. Today the only live producer is
 * the unified-recordings pipeline (which already yields recording, document AND
 * image moments via file-type classification — the same classification the
 * Library "Images" filter uses). Code/diagram moments have no producer yet; the
 * hook accepts injected `extraMoments` so those features light up automatically
 * once they emit moments to the shared `Moment` shape.
 */

import { useEffect, useMemo, useState } from 'react'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import { useToday } from '@/hooks/useToday'
import { fetchMeetingParticipants, participantLabel } from '@/lib/meeting-participants'
import {
  buildMoments,
  computePeopleToday,
  computeSourceMix,
  computeThreads,
  dayKey,
  groupMomentsByDay
} from './stream'
import type { Moment, MomentDay, MomentPerson, PersonToday, SourceMixEntry, ThreadSummary } from './types'

export interface StreamResult {
  days: MomentDay[]
  moments: Moment[]
  loading: boolean
  error: string | null
  deviceConnected: boolean
  refresh: () => void
  rail: {
    threads: ThreadSummary[]
    people: PersonToday[]
    sourceMix: SourceMixEntry[]
  }
}

export interface UseStreamOptions {
  /** Moments produced by other features (code/diagram/image). Rendered as-is. */
  extraMoments?: Moment[]
}

export function useStream(options: UseStreamOptions = {}): StreamResult {
  const { extraMoments } = options
  const { recordings, loading, error, refresh, deviceConnected } = useUnifiedRecordings()
  const today = useToday()
  const [participantsByMeeting, setParticipantsByMeeting] = useState<Record<string, MomentPerson[]>>({})

  // Meetings tied to TODAY's recordings — the only set the People-today rollup
  // needs. Bounded fetch keeps this cheap regardless of library size.
  const todayMeetingIds = useMemo(() => {
    const key = dayKey(today)
    const ids = new Set<string>()
    for (const r of recordings) {
      if (!r.meetingId) continue
      const d = r.dateRecorded instanceof Date ? r.dateRecorded : new Date(r.dateRecorded)
      if (!isNaN(d.getTime()) && dayKey(d) === key) ids.add(r.meetingId)
    }
    return [...ids].sort()
  }, [recordings, today])

  const meetingIdsKey = todayMeetingIds.join(',')

  useEffect(() => {
    if (todayMeetingIds.length === 0) {
      setParticipantsByMeeting({})
      return
    }
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        todayMeetingIds.map(async (id) => {
          const contacts = await fetchMeetingParticipants(id)
          const people: MomentPerson[] = contacts.map((c) => ({ id: c.id, name: participantLabel(c) }))
          return [id, people] as const
        })
      )
      if (!cancelled) setParticipantsByMeeting(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingIdsKey])

  const moments = useMemo(
    () => buildMoments({ recordings, extra: extraMoments, context: { participantsByMeeting } }),
    [recordings, extraMoments, participantsByMeeting]
  )

  const days = useMemo(() => groupMomentsByDay(moments, today), [moments, today])
  const rail = useMemo(
    () => ({
      threads: computeThreads(moments, today),
      people: computePeopleToday(moments, today),
      sourceMix: computeSourceMix(moments, today)
    }),
    [moments, today]
  )

  return {
    days,
    moments,
    loading,
    error,
    deviceConnected,
    refresh: () => void refresh(),
    rail
  }
}

/** Alias — some call sites read better as `useMoments()`. */
export const useMoments = useStream
