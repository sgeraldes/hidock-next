import { useEffect, useState } from 'react'
import { useUIStore } from '@/store'

/**
 * Shared lookup for a meeting's *recording intelligence* — whether the meeting
 * was recorded, whether that recording was transcribed, and the transcript
 * length. This is the assistant-first payload for a meeting hover card: it tells
 * the user something the calendar surface can't ("this one has a searchable
 * transcript"), so it's net-new by construction.
 *
 * Like {@link ../lib/meeting-participants}, fetches are deduped through a
 * module-level cache keyed by meeting id, so the several surfaces that hover the
 * same meeting (Today rows, PersonDetail timeline, Chat sources) share one round
 * trip.
 */

export interface MeetingRecordingIntel {
  recorded: boolean
  transcribed: boolean
  /** Combined transcript word count across transcribed recordings, when known. */
  wordCount?: number
}

const EMPTY: MeetingRecordingIntel = { recorded: false, transcribed: false }

const cache = new Map<string, MeetingRecordingIntel>()
const inflight = new Map<string, Promise<MeetingRecordingIntel>>()

function qaLog(...args: unknown[]): void {
  if (useUIStore.getState().qaLogsEnabled) {
    console.log('[QA-MONITOR]', ...args)
  }
}

/**
 * Fetch (and cache) the recording intelligence for a meeting. Never rejects —
 * failures resolve to the empty state so callers can render optimistically.
 */
export async function fetchMeetingRecordingIntel(meetingId: string): Promise<MeetingRecordingIntel> {
  const cached = cache.get(meetingId)
  if (cached) return cached

  const pending = inflight.get(meetingId)
  if (pending) return pending

  const promise = (async () => {
    try {
      const recs = (await window.electronAPI.recordings.getForMeeting(meetingId)) ?? []
      const recorded = recs.length > 0
      const transcribedRecs = recs.filter((r: { status?: string }) => r?.status === 'transcribed')
      const transcribed = transcribedRecs.length > 0

      let wordCount: number | undefined
      if (transcribed) {
        try {
          const map = await window.electronAPI.transcripts.getByRecordingIds(
            transcribedRecs.map((r: { id: string }) => r.id)
          )
          const total = Object.values(map ?? {}).reduce(
            (sum: number, t: { word_count?: number } | null) => sum + (t?.word_count ?? 0),
            0
          )
          if (total > 0) wordCount = total
        } catch (err) {
          qaLog('fetchMeetingRecordingIntel transcript lookup failed for', meetingId, err)
        }
      }

      const intel: MeetingRecordingIntel = { recorded, transcribed, wordCount }
      cache.set(meetingId, intel)
      return intel
    } catch (err) {
      qaLog('fetchMeetingRecordingIntel failed for', meetingId, err)
      cache.set(meetingId, EMPTY)
      return EMPTY
    } finally {
      inflight.delete(meetingId)
    }
  })()

  inflight.set(meetingId, promise)
  return promise
}

/**
 * Synchronous read of the intel cache — for a hover-card suppression pre-check
 * that must decide *before* mounting. Returns undefined when the meeting hasn't
 * been fetched yet (unknown).
 */
export function getCachedMeetingRecordingIntel(
  meetingId: string | null | undefined
): MeetingRecordingIntel | undefined {
  return meetingId ? cache.get(meetingId) : undefined
}

/**
 * React hook wrapping {@link fetchMeetingRecordingIntel}. Reads synchronously
 * from the cache on first render and lazily fetches otherwise. Pass a falsy id
 * to render nothing.
 */
export function useMeetingRecordingIntel(meetingId: string | null | undefined): {
  intel: MeetingRecordingIntel | null
  loading: boolean
} {
  const [intel, setIntel] = useState<MeetingRecordingIntel | null>(() =>
    meetingId ? cache.get(meetingId) ?? null : null
  )
  const [loading, setLoading] = useState<boolean>(() => (meetingId ? !cache.has(meetingId) : false))

  useEffect(() => {
    if (!meetingId) {
      setIntel(null)
      setLoading(false)
      return
    }

    const cached = cache.get(meetingId)
    if (cached) {
      setIntel(cached)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    fetchMeetingRecordingIntel(meetingId).then((data) => {
      if (cancelled) return
      setIntel(data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [meetingId])

  return { intel, loading }
}

/** Test-only: clear the module-level intel cache. */
export function resetMeetingRecordingIntelCache(): void {
  cache.clear()
  inflight.clear()
}
