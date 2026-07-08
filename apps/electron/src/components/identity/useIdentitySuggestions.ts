import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/toaster'

/**
 * A row from `identity:getSuggestions` — the resolver's 0.5–0.8 confidence band
 * surfaced for human review. Mirrors the main-process `IdentitySuggestion` shape.
 */
export interface IdentitySuggestion {
  id: string
  kind: 'person' | 'project'
  candidate_name: string
  target_id: string
  confidence: number | null
  evidence: string | null
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
}

/** Parsed contents of a suggestion's `evidence` JSON blob (best-effort). */
export interface SuggestionEvidence {
  method?: string
  meetingId?: string
  coOccurring?: string[]
}

/** Safely parse the evidence JSON string; never throws. */
export function parseEvidence(raw: string | null | undefined): SuggestionEvidence {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as SuggestionEvidence) : {}
  } catch {
    return {}
  }
}

/**
 * Loads the pending identity-suggestion queue and exposes optimistic accept/reject.
 * Target entity names are resolved lazily (contacts/projects getById) and cached
 * by target_id so cards can render "Is 'Sebas' the same as Sebastián?".
 */
export function useIdentitySuggestions() {
  const [suggestions, setSuggestions] = useState<IdentitySuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [targetNames, setTargetNames] = useState<Record<string, string>>({})
  const resolving = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.identity.getSuggestions('pending')
      setSuggestions(res.success && res.data ? (res.data as IdentitySuggestion[]) : [])
    } catch (err) {
      console.error('Failed to load identity suggestions:', err)
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Lazily resolve the canonical name of each target entity (once per id).
  useEffect(() => {
    const toResolve = suggestions.filter(
      (s) => !(s.target_id in targetNames) && !resolving.current.has(s.target_id)
    )
    if (toResolve.length === 0) return
    toResolve.forEach((s) => resolving.current.add(s.target_id))
    let cancelled = false
    ;(async () => {
      const updates: Record<string, string> = {}
      await Promise.all(
        toResolve.map(async (s) => {
          try {
            if (s.kind === 'person') {
              const r = await window.electronAPI.contacts.getById(s.target_id)
              if (r.success && r.data?.contact) updates[s.target_id] = (r.data.contact as { name: string }).name
            } else {
              const r = await window.electronAPI.projects.getById(s.target_id)
              if (r.success && r.data?.project) updates[s.target_id] = (r.data.project as { name: string }).name
            }
          } catch {
            /* leave unresolved — card falls back to a neutral label */
          }
        })
      )
      if (!cancelled && Object.keys(updates).length > 0) {
        setTargetNames((prev) => ({ ...prev, ...updates }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [suggestions, targetNames])

  const accept = useCallback(
    async (id: string) => {
      const snapshot = suggestions
      setSuggestions((prev) => prev.filter((s) => s.id !== id)) // optimistic
      try {
        const res = await window.electronAPI.identity.acceptSuggestion(id)
        if (!res.success) throw new Error((res as { error?: { message?: string } }).error?.message || 'Failed')
        toast.success('Identity confirmed', 'The name was linked and will be remembered.')
      } catch (err) {
        setSuggestions(snapshot) // rollback
        toast.error('Failed to accept suggestion', err instanceof Error ? err.message : 'Unknown error')
      }
    },
    [suggestions]
  )

  const reject = useCallback(
    async (id: string) => {
      const snapshot = suggestions
      setSuggestions((prev) => prev.filter((s) => s.id !== id)) // optimistic
      try {
        const res = await window.electronAPI.identity.rejectSuggestion(id)
        if (!res.success) throw new Error((res as { error?: { message?: string } }).error?.message || 'Failed')
        toast.info('Suggestion dismissed', "We won't ask about this pairing again.")
      } catch (err) {
        setSuggestions(snapshot) // rollback
        toast.error('Failed to reject suggestion', err instanceof Error ? err.message : 'Unknown error')
      }
    },
    [suggestions]
  )

  return { suggestions, loading, targetNames, reload: load, accept, reject }
}
