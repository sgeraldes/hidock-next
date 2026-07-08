import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/ui/toaster'
import { parseEvidence, type SuggestionEvidence } from './evidenceToPhrases'
import { mentionKey, type MentionResult } from './mentionEvidence'
import type { PersonContext } from './personContext'

export { parseEvidence, type SuggestionEvidence }
export type { MentionResult } from './mentionEvidence'
export type { PersonContext } from './personContext'

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

/** Pre-merge blast radius: link counts on each side (from identity:getMergeImpact). */
export interface MergeImpact {
  keeper: number
  loser: number
}

/** A compact profile for one side of a suggestion (keeper or candidate/loser). */
export interface MiniProfile {
  id: string
  kind: 'person' | 'project'
  name: string
  role?: string
  company?: string
  email?: string
  meetingCount?: number
  description?: string
}

/** All the ids a suggestion needs resolved: its keeper (target) and its loser. */
function idsFor(s: IdentitySuggestion): Array<{ id: string; kind: 'person' | 'project' }> {
  const out: Array<{ id: string; kind: 'person' | 'project' }> = [{ id: s.target_id, kind: s.kind }]
  const ev = parseEvidence(s.evidence)
  if (ev.loserId && ev.loserId !== s.target_id) out.push({ id: ev.loserId, kind: s.kind })
  return out
}

/** Reject after `ms` if the promise hasn't settled — guards a hung/never-resolving IPC lookup. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

async function fetchProfile(id: string, kind: 'person' | 'project'): Promise<MiniProfile | null> {
  try {
    if (kind === 'person') {
      const r = await window.electronAPI.contacts.getById(id)
      const c = r.success ? (r.data?.contact as unknown as Record<string, unknown> | undefined) : undefined
      if (!c) return null
      return {
        id,
        kind,
        name: (c.name as string) ?? '',
        role: (c.role as string) || undefined,
        company: (c.company as string) || undefined,
        email: (c.email as string) || undefined,
        meetingCount: (c.meeting_count as number) ?? undefined
      }
    }
    const r = await window.electronAPI.projects.getById(id)
    const p = r.success ? (r.data?.project as unknown as Record<string, unknown> | undefined) : undefined
    if (!p) return null
    return {
      id,
      kind,
      name: (p.name as string) ?? '',
      description: (p.description as string) || undefined
    }
  } catch {
    return null
  }
}

/**
 * Loads the pending identity-suggestion queue and exposes optimistic accept/reject.
 * Both sides of each suggestion (keeper + candidate) are resolved lazily to compact
 * profiles and cached by id, so cards can show side-by-side mini-profiles and make
 * clear which entity survives. Accepting a discovery pairing performs a real merge:
 * the success toast offers a time-boxed Undo, and the queue is refetched because the
 * merge may have superseded sibling suggestions in the backend.
 */
export function useIdentitySuggestions() {
  const [suggestions, setSuggestions] = useState<IdentitySuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<Record<string, MiniProfile>>({})
  const [mentions, setMentions] = useState<Record<string, MentionResult>>({})
  const [impacts, setImpacts] = useState<Record<string, MergeImpact>>({})
  const [contexts, setContexts] = useState<Record<string, PersonContext>>({})
  const resolving = useRef<Set<string>>(new Set())
  const resolvingMentions = useRef<Set<string>>(new Set())
  const resolvingImpacts = useRef<Set<string>>(new Set())
  const resolvingContexts = useRef<Set<string>>(new Set())

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await window.electronAPI.identity.getSuggestions('pending')
      setSuggestions(res.success && res.data ? (res.data as IdentitySuggestion[]) : [])
    } catch (err) {
      console.error('Failed to load identity suggestions:', err)
      setSuggestions([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Lazily resolve keeper + loser profiles (once per id).
  useEffect(() => {
    const wanted = new Map<string, 'person' | 'project'>()
    for (const s of suggestions) {
      for (const { id, kind } of idsFor(s)) {
        if (!(id in profiles) && !resolving.current.has(id)) wanted.set(id, kind)
      }
    }
    if (wanted.size === 0) return
    for (const id of wanted.keys()) resolving.current.add(id)
    let cancelled = false
    ;(async () => {
      const updates: Record<string, MiniProfile> = {}
      await Promise.all(
        [...wanted].map(async ([id, kind]) => {
          const profile = await fetchProfile(id, kind)
          if (profile) updates[id] = profile
        })
      )
      if (!cancelled && Object.keys(updates).length > 0) {
        setProfiles((prev) => ({ ...prev, ...updates }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [suggestions, profiles])

  // Lazily fetch primary-source mention evidence for each distinct name — the
  // candidate (loser) name and its keeper's display name — so the card can show
  // transcript excerpts and flag co-presence. Cached by normalized name.
  useEffect(() => {
    const names = new Map<string, string>() // key → original name
    const want = (name: string | undefined) => {
      const raw = (name || '').trim()
      if (!raw) return
      const key = mentionKey(raw)
      if (!(key in mentions) && !resolvingMentions.current.has(key)) names.set(key, raw)
    }
    for (const s of suggestions) {
      want(s.candidate_name)
      want(profiles[s.target_id]?.name || parseEvidence(s.evidence).keeperName)
    }
    if (names.size === 0) return
    for (const key of names.keys()) resolvingMentions.current.add(key)
    let cancelled = false
    ;(async () => {
      const updates: Record<string, MentionResult> = {}
      await Promise.all(
        [...names].map(async ([key, raw]) => {
          try {
            // 5s guard: a hung transcript lookup must not leave the card stuck on
            // "checking transcripts…" forever — surface a distinct error state instead.
            const res = await withTimeout(window.electronAPI.identity.getMentionSnippets(raw, 2), 5000)
            updates[key] = res.success
              ? res.data
                ? { ...res.data, error: false }
                : { snippets: [], recordingIds: [], error: false }
              : { snippets: [], recordingIds: [], error: true }
          } catch {
            updates[key] = { snippets: [], recordingIds: [], error: true }
          }
        })
      )
      if (!cancelled && Object.keys(updates).length > 0) {
        setMentions((prev) => ({ ...prev, ...updates }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [suggestions, profiles, mentions])

  // Lazily fetch the pre-merge blast radius for each discovery suggestion (one that
  // pairs two existing entities). Keyed by suggestion id.
  useEffect(() => {
    const pending = suggestions.filter((s) => {
      if (s.id in impacts || resolvingImpacts.current.has(s.id)) return false
      const ev = parseEvidence(s.evidence)
      return !!ev.loserId && ev.loserId !== s.target_id
    })
    if (pending.length === 0) return
    for (const s of pending) resolvingImpacts.current.add(s.id)
    let cancelled = false
    ;(async () => {
      const updates: Record<string, MergeImpact> = {}
      await Promise.all(
        pending.map(async (s) => {
          const ev = parseEvidence(s.evidence)
          try {
            const res = await window.electronAPI.identity.getMergeImpact({
              kind: s.kind === 'person' ? 'contact' : 'project',
              keeperId: s.target_id,
              loserId: ev.loserId!
            })
            if (res.success && res.data) updates[s.id] = res.data
          } catch {
            /* leave unresolved — card omits the impact line */
          }
        })
      )
      if (!cancelled && Object.keys(updates).length > 0) {
        setImpacts((prev) => ({ ...prev, ...updates }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [suggestions, impacts])

  // Lazily fetch graph-neighborhood context for each PERSON side of a suggestion —
  // the keeper (by target id) and the candidate (by loser id, else its name) — so the
  // card can render both sides' co-attendees/topics with shared entries highlighted.
  // Cached per key so each person hits the graph once.
  useEffect(() => {
    const wanted = new Set<string>()
    for (const s of suggestions) {
      if (s.kind !== 'person') continue
      const ev = parseEvidence(s.evidence)
      for (const k of [s.target_id, ev.loserId || s.candidate_name]) {
        const key = (k || '').trim()
        if (key && !(key in contexts) && !resolvingContexts.current.has(key)) wanted.add(key)
      }
    }
    if (wanted.size === 0) return
    for (const k of wanted) resolvingContexts.current.add(k)
    let cancelled = false
    ;(async () => {
      const updates: Record<string, PersonContext> = {}
      await Promise.all(
        [...wanted].map(async (k) => {
          try {
            const res = await window.electronAPI.identity.getPersonContext?.(k)
            updates[k] = res?.success && res.data ? res.data : { people: [], topics: [] }
          } catch {
            updates[k] = { people: [], topics: [] }
          }
        })
      )
      if (!cancelled && Object.keys(updates).length > 0) {
        setContexts((prev) => ({ ...prev, ...updates }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [suggestions, contexts])

  // Backward-compatible map of target_id → display name (used by the Today card).
  const targetNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const [id, p] of Object.entries(profiles)) map[id] = p.name
    return map
  }, [profiles])

  const accept = useCallback(
    async (id: string) => {
      const snapshot = suggestions
      const accepted = suggestions.find((s) => s.id === id)
      setSuggestions((prev) => prev.filter((s) => s.id !== id)) // optimistic
      try {
        const res = await window.electronAPI.identity.acceptSuggestion(id)
        if (!res.success) throw new Error((res as { error?: string }).error || 'Failed')

        const journalId = res.data?.mergeJournalId
        if (journalId && accepted) {
          const unmerge =
            accepted.kind === 'person' ? window.electronAPI.contacts.unmerge : window.electronAPI.projects.unmerge
          toast.success('Identities merged', 'Kept the primary; the duplicate became an alias.', {
            duration: 10000,
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  const undo = await unmerge(journalId)
                  if (!undo.success) throw new Error('unmerge failed')
                  toast.info('Merge undone', 'The separate records were restored.')
                } catch {
                  toast.error('Undo failed', 'The records could not be separated again.')
                } finally {
                  load(true)
                }
              }
            }
          })
        } else {
          toast.success('Identity confirmed', 'The name was linked and will be remembered.')
        }

        // The merge may have superseded sibling suggestions in the backend — refetch.
        load(true)
      } catch (err) {
        setSuggestions(snapshot) // rollback
        toast.error('Failed to accept suggestion', err instanceof Error ? err.message : 'Unknown error')
      }
    },
    [suggestions, load]
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

  // Third door: fold the reviewed duplicate (loserId) into a DIFFERENT chosen keeper
  // than the suggestion proposed. Performs a real contact merge, offers the same
  // time-boxed Undo (via the newest merge-journal entry), retires the now-moot
  // suggestion, and refetches.
  const mergeInto = useCallback(
    async (suggestionId: string, keeperId: string, loserId: string, keeperName: string) => {
      const snapshot = suggestions
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId)) // optimistic
      try {
        const res = await window.electronAPI.contacts.merge({ keeperId, loserId })
        if (!res.success) throw new Error((res as { error?: { message?: string } }).error?.message || 'Failed')

        // The merge does not return its journal id — read the newest open entry for undo.
        let journalId: string | null = null
        try {
          const j = await window.electronAPI.identity.getMergeJournal({ kind: 'contact', keeperId })
          journalId = j.success && j.data && j.data.length > 0 ? j.data[0].id : null
        } catch {
          /* undo simply unavailable */
        }

        // Retire the original suggestion so it never re-surfaces (best-effort).
        window.electronAPI.identity.rejectSuggestion(suggestionId).catch(() => {})

        toast.success(
          'Merged into a different person',
          `Records were folded into ${keeperName}.`,
          journalId
            ? {
                duration: 10000,
                action: {
                  label: 'Undo',
                  onClick: async () => {
                    try {
                      const undo = await window.electronAPI.contacts.unmerge(journalId as string)
                      if (!undo.success) throw new Error('unmerge failed')
                      toast.info('Merge undone', 'The separate records were restored.')
                    } catch {
                      toast.error('Undo failed', 'The records could not be separated again.')
                    } finally {
                      load(true)
                    }
                  }
                }
              }
            : undefined
        )
        load(true)
      } catch (err) {
        setSuggestions(snapshot) // rollback
        toast.error('Failed to merge', err instanceof Error ? err.message : 'Unknown error')
      }
    },
    [suggestions, load]
  )

  return {
    suggestions,
    loading,
    targetNames,
    profiles,
    mentions,
    impacts,
    contexts,
    reload: load,
    accept,
    reject,
    mergeInto
  }
}
