import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Loads ambiguous "mention buckets" — bare first names ("Sergio") that denote
 * several distinct real people — and drives per-recording resolution. Unlike the
 * merge queue, resolving a bucket NEVER merges anyone: each recording's mention is
 * pinned to the real person it means, one recording at a time. See the main-process
 * detectAmbiguousName + mention_resolutions.
 */

export interface AmbiguousCandidate {
  id: string
  name: string
}

export interface AmbiguousBucketSummary {
  contactId: string
  name: string
  candidates: AmbiguousCandidate[]
  recordingCount: number
  resolvedCount: number
  pendingCount: number
}

export interface BucketRecording {
  recordingId: string
  title: string
  date: string | null
  meetingId: string | null
  bestGuessId: string | null
  bestGuessName: string | null
  method: 'speaker-map' | 'attendee-context' | 'unclear'
  signal: string
  resolvedContactId: string | null
  resolved: boolean
}

export interface BucketResolution {
  contactId: string
  name: string
  candidates: AmbiguousCandidate[]
  recordings: BucketRecording[]
}

export function useAmbiguousBuckets(enabled = true) {
  const [buckets, setBuckets] = useState<AmbiguousBucketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!enabled) {
      setBuckets([])
      setLoading(false)
      return
    }
    try {
      const res = await window.electronAPI.identity.getAmbiguousBuckets?.()
      if (mounted.current) setBuckets(res?.success && res.data ? (res.data as AmbiguousBucketSummary[]) : [])
    } catch (err) {
      console.error('Failed to load ambiguous buckets:', err)
      if (mounted.current) setBuckets([])
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    load()
  }, [load])

  const fetchResolution = useCallback(async (contactId: string): Promise<BucketResolution | null> => {
    try {
      const res = await window.electronAPI.identity.getBucketResolution?.(contactId)
      return res?.success ? ((res.data as BucketResolution | null) ?? null) : null
    } catch (err) {
      console.error('Failed to fetch bucket resolution:', err)
      return null
    }
  }, [])

  const resolve = useCallback(
    async (recordingId: string, sourceName: string, contactId: string | null, method = 'manual'): Promise<boolean> => {
      try {
        const res = await window.electronAPI.identity.resolveMention?.({ recordingId, sourceName, contactId, method })
        return !!res?.success
      } catch (err) {
        console.error('Failed to resolve mention:', err)
        return false
      }
    },
    []
  )

  return { buckets, loading, reload: load, fetchResolution, resolve }
}
