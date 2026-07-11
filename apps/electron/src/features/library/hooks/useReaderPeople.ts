/**
 * useReaderPeople
 *
 * Loads and derives the two DISTINCT people lists the reader shows:
 *
 *  - Participants (who actually spoke): the linked meeting's canonical contacts
 *    PLUS the transcript's speakers, each resolved through the SAME speaker map
 *    the transcript viewer uses (label→contact bindings, per-turn overrides,
 *    splits). Because the resolution is shared, renaming a speaker — in the
 *    transcript OR in a Participants chip — updates this list.
 *
 *  - Invited (who was calendar-invited): meeting.attendees, resolved to contacts
 *    where possible, with a flag for the ones we can map to a transcript speaker.
 *
 * The hook itself never navigates, so it is safe to call unconditionally from
 * SourceReader (above its early return) to keep hook order stable; the chip UIs
 * that DO navigate are mounted conditionally by the caller.
 *
 * Cross-panel freshness: a speaker change made in a Participants chip emits on
 * `speakerBus` and re-reads the map immediately. To also catch corrections made
 * in the transcript panel (which we don't own and can't have emit), the hook
 * re-reads on window focus / tab visibility, and — only while at least one
 * un-named "Speaker N" remains — on a short, self-terminating interval.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StoredSegment } from '../components/TranscriptViewer'
import type { AssignScope } from '../components/SpeakerAssignPopover'
import {
  resolveParticipants,
  isRawSpeakerLabel,
  type SpeakerSplit,
  type SpeakerAssignment,
  type ResolvedSpeaker,
} from '../utils/resolveParticipants'
import { emitSpeakerChange, onSpeakerChange } from '../utils/speakerBus'
import { parseAttendees, type Contact, type MeetingAttendee } from '@/types'
import type { Person } from '@/types/knowledge'
import { toast } from '@/components/ui/toaster'

export interface ParticipantChip {
  /** Stable dedupe/react key. */
  key: string
  /** Display name (person name when resolved, else the effective label). */
  name: string
  /** Resolved contact id, when this participant maps to a known person. */
  contactId?: string
  /** The effective speaker label — assign key + fallback for unresolved chips. */
  effectiveLabel: string
  /** First turn index (the assign popover's turn context). */
  firstTurnIndex: number
  /** Turns attributed to this participant (0 for a contact who has no turns). */
  turnCount: number
  /** The self-ID pass suspects the underlying label is two people. */
  mergeSuspected: boolean
}

interface UseReaderPeopleArgs {
  meetingId?: string
  attendees?: string | null
  recordingId?: string
  segments?: StoredSegment[]
}

interface ReaderPeople {
  participants: ParticipantChip[]
  invited: MeetingAttendee[]
  /**
   * Resolves a raw diarization label AT A SPECIFIC TURN to the participant chip
   * key that represents it — replaying the SAME split/override/label-binding
   * logic resolveParticipants uses. Per-turn (not a flat label map) so a base
   * label split into multiple people yields DIFFERENT keys on each side of the
   * split boundary. A label resolved to a linked meeting contact maps to that
   * contact's `mc:` chip key, so its chip swatch and waveform bars share one
   * color. Feeds `deriveSpeakerRanges` (whose turn indices are computed over the
   * same expanded, text-filtered turn list).
   */
  resolveRangeKey: (baseLabel: string, turnIndex: number) => { key: string; name: string } | undefined
  /** All contacts, for the assign popover's picker (loaded lazily). */
  allContacts: Person[]
  /** Resolve a calendar attendee to a linked meeting contact, if known. */
  resolveAttendee: (a: MeetingAttendee) => Contact | undefined
  /** Whether an invited attendee maps to someone who actually spoke. */
  attendeeSpoke: (a: MeetingAttendee, contactId?: string) => boolean
  /** Lazily load all contacts for the picker. */
  ensureAllContacts: () => void
  /** Assign a speaker (label everywhere, or a single turn) to a contact/new name. */
  assignSpeaker: (
    effectiveLabel: string,
    turnIndex: number,
    scope: AssignScope,
    payload: { contactId?: string; newName?: string }
  ) => void
  /** Clear a speaker's (label) assignment. */
  unassignSpeaker: (effectiveLabel: string, turnIndex: number) => void
}

const emptyMap = <K, V>() => new Map<K, V>()

export function useReaderPeople({ meetingId, attendees, recordingId, segments }: UseReaderPeopleArgs): ReaderPeople {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [speakerMap, setSpeakerMap] = useState<Map<string, SpeakerAssignment>>(emptyMap())
  const [turnOverrides, setTurnOverrides] = useState<Map<number, SpeakerAssignment>>(emptyMap())
  const [splits, setSplits] = useState<SpeakerSplit[]>([])
  const [mergeHints, setMergeHints] = useState<Set<string>>(new Set())
  const [allContacts, setAllContacts] = useState<Person[]>([])
  const [allContactsLoaded, setAllContactsLoaded] = useState(false)

  // Canonical contacts for the linked meeting (the meeting_contacts join). Same
  // IPC MeetingDetail uses; no new read path.
  useEffect(() => {
    let cancelled = false
    if (!meetingId) {
      setContacts([])
      return
    }
    ;(async () => {
      try {
        const res = await window.electronAPI.contacts.getForMeeting(meetingId)
        if (!cancelled) setContacts(res.success ? res.data : [])
      } catch (err) {
        console.error('Failed to load meeting contacts:', err)
        if (!cancelled) setContacts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [meetingId])

  // Re-read the resolved speaker map (label bindings + per-turn overrides +
  // splits + merge hints). All optional-chained so a partial electronAPI (tests,
  // older builds) simply yields empty maps rather than throwing.
  const reloadSpeakerData = useCallback(async () => {
    if (!recordingId) {
      setSpeakerMap(emptyMap())
      setTurnOverrides(emptyMap())
      setSplits([])
      setMergeHints(new Set())
      return
    }
    try {
      const res = await window.electronAPI.transcripts?.getSpeakerMap?.({ recordingId })
      if (res?.success) {
        const next = new Map<string, SpeakerAssignment>()
        for (const row of res.data) next.set(row.speaker_label, { contactId: row.contact_id, name: row.name })
        setSpeakerMap(next)
      }
    } catch { /* non-fatal */ }
    try {
      const res = await window.electronAPI.turnSpeakers?.getOverrides?.({ recordingId })
      if (res?.success) {
        const next = new Map<number, SpeakerAssignment>()
        for (const row of res.data) next.set(row.turn_index, { contactId: row.contact_id, name: row.name })
        setTurnOverrides(next)
      }
    } catch { /* non-fatal */ }
    try {
      const res = await window.electronAPI.turnSpeakers?.getSplits?.({ recordingId })
      if (res?.success) {
        setSplits(res.data.map((r) => ({ baseLabel: r.base_label, fromIndex: r.from_turn_index, derivedLabel: r.derived_label })))
      }
    } catch { /* non-fatal */ }
    try {
      const res = await window.electronAPI.turnSpeakers?.getMergeHints?.({ recordingId })
      if (res?.success) setMergeHints(new Set(res.data.map((h) => h.label)))
    } catch { /* non-fatal */ }
  }, [recordingId])

  useEffect(() => {
    reloadSpeakerData()
  }, [reloadSpeakerData])

  // The distinct speakers who actually spoke, with all corrections applied.
  const resolved = useMemo<ResolvedSpeaker[]>(
    () => resolveParticipants(segments, { splits, speakerMap, turnOverrides, mergeHints }),
    [segments, splits, speakerMap, turnOverrides, mergeHints]
  )

  // Meeting-contact identity keys (id + name/email), used to avoid listing a
  // person twice (once as a meeting contact, once as a resolved speaker).
  const contactKeys = useMemo(() => {
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const c of contacts) {
      ids.add(c.id)
      const n = (c.name || '').trim().toLowerCase()
      if (n) names.add(n)
      const e = (c.email || '').trim().toLowerCase()
      if (e) names.add(e)
    }
    return { ids, names }
  }, [contacts])

  const participants = useMemo<ParticipantChip[]>(() => {
    // 1) Meeting contacts — always shown, clickable to their page.
    const contactChips: ParticipantChip[] = contacts.map((c) => ({
      key: `mc:${c.id}`,
      name: c.name || c.email || 'Unknown',
      contactId: c.id,
      effectiveLabel: c.name || c.email || 'Unknown',
      firstTurnIndex: 0,
      turnCount: 0,
      mergeSuspected: false,
    }))
    // 2) Resolved transcript speakers not already represented by a meeting contact.
    const speakerChips: ParticipantChip[] = resolved
      .filter((r) => {
        if (r.contactId && contactKeys.ids.has(r.contactId)) return false
        if (contactKeys.names.has(r.name.trim().toLowerCase())) return false
        return true
      })
      .map((r) => ({
        key: r.key,
        name: r.name,
        contactId: r.contactId,
        effectiveLabel: r.effectiveLabel,
        firstTurnIndex: r.firstTurnIndex,
        turnCount: r.turnCount,
        mergeSuspected: r.mergeSuspected,
      }))
    return [...contactChips, ...speakerChips]
  }, [contacts, resolved, contactKeys])

  // Precomputed lookup structures for the per-turn range-key resolver, built
  // ONCE per splits/contacts change (not per turn): split boundaries grouped by
  // base label and sorted by fromIndex (→ binary search per turn), and a
  // name/email → contact map (→ O(1) meeting-contact fold instead of a linear
  // scan over contacts for every turn).
  const rangeKeyIndex = useMemo(() => {
    const splitsByBase = new Map<string, SpeakerSplit[]>()
    for (const s of splits) {
      const arr = splitsByBase.get(s.baseLabel)
      if (arr) arr.push(s)
      else splitsByBase.set(s.baseLabel, [s])
    }
    for (const arr of splitsByBase.values()) arr.sort((a, b) => a.fromIndex - b.fromIndex)

    const contactByNameKey = new Map<string, Contact>()
    for (const c of contacts) {
      const n = (c.name || '').trim().toLowerCase()
      if (n && !contactByNameKey.has(n)) contactByNameKey.set(n, c)
      const e = (c.email || '').trim().toLowerCase()
      if (e && !contactByNameKey.has(e)) contactByNameKey.set(e, c)
    }
    return { splitsByBase, contactByNameKey }
  }, [splits, contacts])

  // Per-TURN color-key resolver for the waveform ranges. It replays the exact
  // identity resolution resolveParticipants applies to each turn — effective
  // (possibly split-derived) label, then per-turn override ?? label binding —
  // and then the `participants` fold: an identity that is (or matches by
  // name/email) a linked meeting contact keys as that contact's `mc:` chip.
  // Being per-turn (not a flat label map) is what keeps a split base label from
  // collapsing: "Speaker 1" before the split and "Speaker 1 · B" after it hit
  // DIFFERENT bindings and therefore different keys/colors — matching their
  // distinct chips. deriveSpeakerRanges passes turn indices computed over the
  // SAME expanded, text-filtered turn list, so boundaries line up exactly.
  // Per-turn cost is O(log splits) + O(1) map lookups via rangeKeyIndex, so a
  // 1000+-turn transcript resolves all its ranges in a few milliseconds.
  const resolveRangeKey = useCallback(
    (baseLabel: string, turnIndex: number): { key: string; name: string } | undefined => {
      const base = baseLabel.trim()
      if (!base) return undefined

      // Effective label: the latest split boundary at/before this turn, via
      // binary search over this base's sorted boundaries (same result as
      // resolveParticipants' effectiveLabelFor, without the per-turn scan).
      let effective = base
      const bounds = rangeKeyIndex.splitsByBase.get(base)
      if (bounds && bounds.length > 0) {
        let lo = 0
        let hi = bounds.length - 1
        let found = -1
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          if (bounds[mid].fromIndex <= turnIndex) {
            found = mid
            lo = mid + 1
          } else {
            hi = mid - 1
          }
        }
        if (found >= 0) effective = bounds[found].derivedLabel
      }

      const assigned = turnOverrides.get(turnIndex) ?? speakerMap.get(effective)
      const contactId = assigned?.contactId
      const name = assigned?.name ?? effective

      // Fold into a linked meeting contact where the participants list does.
      if (contactId && contactKeys.ids.has(contactId)) {
        return { key: `mc:${contactId}`, name }
      }
      const byName = rangeKeyIndex.contactByNameKey.get(name.trim().toLowerCase())
      if (byName) return { key: `mc:${byName.id}`, name: byName.name || byName.email || name }
      return { key: contactId ? `c:${contactId}` : `l:${effective}`, name }
    },
    [rangeKeyIndex, turnOverrides, speakerMap, contactKeys]
  )

  // Keys of people who actually spoke — to flag invited attendees who spoke.
  const spoke = useMemo(() => {
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const r of resolved) {
      if (r.contactId) ids.add(r.contactId)
      const n = r.name.trim().toLowerCase()
      if (n) names.add(n)
    }
    return { ids, names }
  }, [resolved])

  // Keep the map fresh across panels. Own-panel edits emit on the bus; transcript
  // edits are picked up on focus/visibility, and — only while an un-named speaker
  // remains (a correction may be pending) — on a short self-terminating poll.
  const hasUnnamed = useMemo(() => participants.some((p) => !p.contactId && isRawSpeakerLabel(p.name)), [participants])
  useEffect(() => {
    if (!recordingId) return
    const off = onSpeakerChange((id) => {
      if (!id || id === recordingId) reloadSpeakerData()
    })
    const refresh = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') reloadSpeakerData()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    let interval: ReturnType<typeof setInterval> | undefined
    if (hasUnnamed) {
      interval = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') reloadSpeakerData()
      }, 2500)
    }
    return () => {
      off()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      if (interval) clearInterval(interval)
    }
  }, [recordingId, hasUnnamed, reloadSpeakerData])

  const ensureAllContacts = useCallback(async () => {
    if (allContactsLoaded) return
    try {
      const res = await window.electronAPI.contacts?.getAll?.()
      if (res?.success) setAllContacts(res.data.contacts)
    } catch { /* non-fatal: picker shows empty, create-new still works */ } finally {
      setAllContactsLoaded(true)
    }
  }, [allContactsLoaded])

  const assignSpeaker = useCallback(
    async (
      effectiveLabel: string,
      turnIndex: number,
      scope: AssignScope,
      payload: { contactId?: string; newName?: string }
    ) => {
      if (!recordingId) return
      try {
        if (scope === 'turn') {
          const res = await window.electronAPI.turnSpeakers?.setOverride?.({ recordingId, turnIndex, ...payload })
          if (!res?.success) return toast.error('Failed to assign speaker')
          toast.success('Turn assigned', `This turn is now ${res.data.name}.`)
        } else {
          // 'everywhere' (and 'fromHere', which the participant chip never offers)
          // both bind the whole label from the Participants view.
          const res = await window.electronAPI.transcripts?.assignSpeaker?.({ recordingId, speakerLabel: effectiveLabel, ...payload })
          if (!res?.success) return toast.error('Failed to assign speaker')
          toast.success('Speaker assigned', `${effectiveLabel} is now ${res.data.name}.`)
        }
        setAllContactsLoaded(false)
        await reloadSpeakerData()
        emitSpeakerChange(recordingId)
      } catch (err) {
        toast.error('Failed to assign speaker', err instanceof Error ? err.message : undefined)
      }
    },
    [recordingId, reloadSpeakerData]
  )

  const unassignSpeaker = useCallback(
    async (effectiveLabel: string, _turnIndex: number) => {
      if (!recordingId) return
      try {
        const res = await window.electronAPI.transcripts?.unassignSpeaker?.({ recordingId, speakerLabel: effectiveLabel })
        if (!res?.success) return toast.error('Failed to unassign speaker')
        toast.success('Speaker unassigned')
        await reloadSpeakerData()
        emitSpeakerChange(recordingId)
      } catch (err) {
        toast.error('Failed to unassign speaker', err instanceof Error ? err.message : undefined)
      }
    },
    [recordingId, reloadSpeakerData]
  )

  const invited = useMemo(() => parseAttendees(attendees), [attendees])

  const resolveAttendee = useCallback(
    (a: MeetingAttendee): Contact | undefined => {
      const email = a.email?.trim().toLowerCase()
      const name = a.name?.trim().toLowerCase()
      return contacts.find(
        (c) =>
          (!!email && c.email?.trim().toLowerCase() === email) ||
          (!!name && c.name?.trim().toLowerCase() === name)
      )
    },
    [contacts]
  )

  const attendeeSpoke = useCallback(
    (a: MeetingAttendee, contactId?: string): boolean => {
      if (contactId && spoke.ids.has(contactId)) return true
      const name = a.name?.trim().toLowerCase()
      if (name && spoke.names.has(name)) return true
      const email = a.email?.trim().toLowerCase()
      if (email && spoke.names.has(email)) return true
      return false
    },
    [spoke]
  )

  return {
    participants,
    invited,
    resolveRangeKey,
    allContacts,
    resolveAttendee,
    attendeeSpoke,
    ensureAllContacts,
    assignSpeaker,
    unassignSpeaker,
  }
}
