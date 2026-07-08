import { useEffect, useState } from 'react'
import type { Contact } from '@/types'
import { useUIStore } from '@/store'

/**
 * Shared lookup for a meeting's *known* participants — the transcript-extracted
 * people, speaker assignments, and manual attendee adds stored in
 * `meeting_contacts` (exposed via `contacts.getForMeeting`).
 *
 * The published Outlook ICS feed strips attendees, so `meeting.attendees` is
 * often empty even when the app knows who was there. Hover cards, calendar
 * tooltips, the Today briefing, and the meeting detail page all surface these
 * names, so fetches are deduped through a module-level cache keyed by meeting id
 * to avoid re-fetch storms when several of those render for the same meeting.
 */

const cache = new Map<string, Contact[]>()
const inflight = new Map<string, Promise<Contact[]>>()

function qaLog(...args: unknown[]): void {
  if (useUIStore.getState().qaLogsEnabled) {
    console.log('[QA-MONITOR]', ...args)
  }
}

/**
 * Fetch (and cache) the known participants for a meeting. Never rejects —
 * failures resolve to an empty array so callers can render optimistically.
 */
export async function fetchMeetingParticipants(meetingId: string): Promise<Contact[]> {
  const cached = cache.get(meetingId)
  if (cached) return cached

  const pending = inflight.get(meetingId)
  if (pending) return pending

  const promise = (async () => {
    try {
      const res = await window.electronAPI.contacts.getForMeeting(meetingId)
      const data = res?.success && res.data ? (res.data as Contact[]) : []
      cache.set(meetingId, data)
      return data
    } catch (err) {
      qaLog('fetchMeetingParticipants failed for', meetingId, err)
      return []
    } finally {
      inflight.delete(meetingId)
    }
  })()

  inflight.set(meetingId, promise)
  return promise
}

/**
 * React hook wrapping {@link fetchMeetingParticipants}. Reads synchronously from
 * the cache on first render (so cached meetings paint immediately) and lazily
 * fetches otherwise. Pass a falsy id to render nothing.
 */
export function useMeetingParticipants(meetingId: string | null | undefined): {
  participants: Contact[]
  loading: boolean
} {
  const [participants, setParticipants] = useState<Contact[]>(() =>
    meetingId ? cache.get(meetingId) ?? [] : []
  )
  const [loading, setLoading] = useState<boolean>(() =>
    meetingId ? !cache.has(meetingId) : false
  )

  useEffect(() => {
    if (!meetingId) {
      setParticipants([])
      setLoading(false)
      return
    }

    const cached = cache.get(meetingId)
    if (cached) {
      setParticipants(cached)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    fetchMeetingParticipants(meetingId).then((data) => {
      if (cancelled) return
      setParticipants(data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [meetingId])

  return { participants, loading }
}

/** First name (or email fallback) for a compact participant label. */
export function participantFirstName(contact: Contact): string {
  const source = (contact.name || contact.email || '').trim()
  return source.split(/\s+/)[0] || 'Unknown'
}

/** Display label for a participant chip — full name, falling back to email. */
export function participantLabel(contact: Contact): string {
  return contact.name || contact.email || 'Unknown'
}

/** Test-only: clear the module-level participant cache. */
export function resetMeetingParticipantsCache(): void {
  cache.clear()
  inflight.clear()
}
