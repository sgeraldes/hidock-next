/**
 * Organization Reconciler
 *
 * Ties the knowledge graph together after calendar syncs and transcriptions:
 *  - auto-links recordings to meetings by time overlap (recordings and
 *    meetings arrive independently — the device downloads audio, the ICS sync
 *    brings meetings, and either can come first)
 *  - creates/updates People (contacts) from meeting attendees and links them
 *    via meeting_contacts
 *  - one-time repair of meetings stored before ICS text unescaping existed
 *    (descriptions with literal "\n" runs)
 */

import { unescapeIcsText } from '@hidock/calendar-sync'
import {
  queryAll,
  queryOne,
  run,
  runInTransaction,
  meetingBaseUid,
  insertIdentitySuggestion,
  getAllRecordingPreassignments,
  getMentionResolution,
  recordMentionResolutionNoSave,
  getAmbiguousBuckets,
  getBucketResolution,
  healRecordingStatusFromTranscripts,
  isProjectDiscoveryRejected,
  filterVisibleEntityIds,
  recordProjectDiscoveryObservation,
  clearProjectDiscoveryObservations,
  getProjectDiscoveryMeetingIds,
  type RecordingPreassignment
} from './database'
import { filterEligibleRecordingIds } from './recording-eligibility'
import { mergeContactsWithGraph } from './knowledge-graph-service'
import { resolveContact, resolveProject } from './entity-resolver'
import { isGenericSpeakerLabel, cleanRole } from './entity-normalize'
import { decideProjectDiscovery, scoreProjectNameCandidate } from './project-discovery-gate'
import { canUpgrade, methodConfidence } from './signal-tiers'
import { LONG_MEETING_MS } from './recording-match-scoring'
import { randomUUID } from 'crypto'

/** Resolver thresholds (INTELLIGENCE.md §2): ≥0.8 auto-link, 0.5–0.8 suggest, <0.5 create. */
const AUTO_LINK_THRESHOLD = 0.8
const SUGGEST_THRESHOLD = 0.5

interface MeetingRow {
  id: string
  subject: string
  start_time: string
  end_time: string
  is_all_day?: number
  attendees?: string
  organizer_name?: string
  organizer_email?: string
  description?: string
  location?: string
}

interface RecordingRow {
  id: string
  filename?: string
  date_recorded: string
  duration_seconds?: number
  file_size?: number
  meeting_id?: string
}

/**
 * correlation_method marking a recording the user explicitly forced STANDALONE
 * (via a live-recording pre-assignment with meeting_id = NULL). Rows with this
 * method are excluded from time-overlap auto-linking on every subsequent pass, so
 * the "don't link me to any meeting" choice sticks after the preassignment row is
 * consumed.
 */
const STANDALONE_METHOD = 'user_preassign_standalone'

/** Estimated duration for recordings without one (seconds). */
const DEFAULT_RECORDING_DURATION = 30 * 60
/** Allow a recording to start this many ms before the meeting does. */
const EARLY_START_TOLERANCE_MS = 15 * 60 * 1000

/**
 * Minimum symmetric fit (intersection-over-union of the two windows) an auto-link
 * winner must clear. Blocks a sliver overlap from silently attributing a recording,
 * and — with the bridge exclusion below — guarantees a tightly-fitting meeting is
 * preferred over a containing all-day event.
 */
export const MIN_AUTO_LINK_FIT = 0.1

export interface AutoLinkWindow {
  id: string
  start: number
  end: number
  isAllDay?: boolean
}

export type AutoLinkDecision =
  | { id: string; fit: number }
  | { id: null; declinedBridge: boolean }

/**
 * Choose the meeting to auto-link a recording to — or decline. Pure so the policy is
 * unit-testable without a database. Rules:
 *   - Score each overlapping meeting by symmetric fit (IoU), NOT raw overlap, so a
 *     tightly-fitting parallel meeting beats a longer one that merely contains the
 *     recording.
 *   - NEVER auto-link to an all-day / ≥4h "bridge" meeting: containment there is a
 *     weak signal with no corroboration available at link time. Such recordings are
 *     left UNLINKED for the dialog / user to place, rather than dumped on the bridge.
 *   - The winner must clear {@link MIN_AUTO_LINK_FIT}.
 * Returns `{ id }` for a link, or `{ id: null, declinedBridge }` when nothing linkable
 * was found (declinedBridge = the only overlaps were bridges we refused to auto-attach).
 */
export function selectAutoLinkMeeting(
  recStart: number,
  recEnd: number,
  windows: AutoLinkWindow[],
  earlyStartToleranceMs = EARLY_START_TOLERANCE_MS
): AutoLinkDecision {
  let best: { id: string; fit: number; overlap: number } | null = null
  let declinedBridge = false

  for (const m of windows) {
    if (!Number.isFinite(m.start) || !Number.isFinite(m.end) || m.end < m.start) continue
    const mStartTol = m.start - earlyStartToleranceMs
    const overlap = Math.max(0, Math.min(recEnd, m.end) - Math.max(recStart, mStartTol))
    if (overlap <= 0) continue

    // Bridge detection uses the REAL duration, not the tolerance-extended window.
    const bridge = m.isAllDay === true || m.end - m.start >= LONG_MEETING_MS
    if (bridge) {
      declinedBridge = true
      continue
    }

    const unionMs = Math.max(recEnd, m.end) - Math.min(recStart, mStartTol)
    const fit = unionMs > 0 ? overlap / unionMs : 0
    if (!best || fit > best.fit || (fit === best.fit && overlap > best.overlap)) {
      best = { id: m.id, fit, overlap }
    }
  }

  if (best && best.fit >= MIN_AUTO_LINK_FIT) return { id: best.id, fit: best.fit }
  // declinedBridge is only meaningful when we found no linkable winner at all.
  return { id: null, declinedBridge: declinedBridge && !best }
}

/**
 * Link unlinked recordings to the meeting they overlap the most.
 * A recording may span several meetings (running late / merged sessions) —
 * it links to the one with the largest overlap; other overlaps stay visible
 * as candidates in recording_meeting_candidates.
 */
export function autoLinkRecordingsToMeetings(): number {
  // Exclude rows the user forced standalone — their choice must survive every
  // reconcile pass, even after the preassignment row is consumed.
  const recordings = queryAll<RecordingRow>(
    `SELECT id, filename, date_recorded, duration_seconds, file_size, meeting_id
     FROM recordings
     WHERE meeting_id IS NULL AND date_recorded IS NOT NULL
       AND deleted_at IS NULL AND COALESCE(personal, 0) = 0
       AND (correlation_method IS NULL OR correlation_method != '${STANDALONE_METHOD}')`
  )
  if (recordings.length === 0) return 0

  // User pre-assignments (attribution chosen IN ADVANCE while the device was still
  // recording), keyed by base filename so a .hda device name matches the .wav/.mp3
  // local name. These WIN over time-overlap: an explicit meeting forces that link;
  // an explicit NULL forces standalone. Each is consumed (deleted) once applied.
  const preassignments = getAllRecordingPreassignments()
  const preassignByBase = new Map<string, RecordingPreassignment>()
  for (const pa of preassignments) {
    preassignByBase.set(baseRecordingName(pa.filename).toLowerCase(), pa)
  }

  const meetings = queryAll<MeetingRow>(
    `SELECT id, subject, start_time, end_time, is_all_day FROM meetings`
  )
  const meetingIds = new Set(meetings.map((m) => m.id))
  const meetingWindows: AutoLinkWindow[] = meetings
    .map((m) => ({
      id: m.id,
      start: new Date(m.start_time).getTime(),
      end: new Date(m.end_time).getTime(),
      isAllDay: (m.is_all_day ?? 0) === 1
    }))
    .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end))

  // Collect the work first, then apply in ONE transaction — per-row run()
  // persists the whole sql.js database to disk on every call.
  const overlapUpdates: Array<{ recordingId: string; meetingId: string }> = []
  const preassignUpdates: Array<{ recordingId: string; meetingId: string }> = []
  const standaloneMarks: string[] = []
  const consumedFilenames = new Set<string>()
  let declinedBridgeCount = 0

  for (const rec of recordings) {
    // Pre-assignment first — it overrides time-overlap for this recording.
    const pa = rec.filename ? preassignByBase.get(baseRecordingName(rec.filename).toLowerCase()) : undefined
    if (pa) {
      consumedFilenames.add(pa.filename)
      if (pa.meeting_id && meetingIds.has(pa.meeting_id)) {
        // Explicit meeting wins over any time overlap.
        preassignUpdates.push({ recordingId: rec.id, meetingId: pa.meeting_id })
        continue
      }
      if (pa.meeting_id === null) {
        // Explicit standalone — block time-overlap linking now and forever.
        standaloneMarks.push(rec.id)
        continue
      }
      // meeting_id points at a meeting that no longer exists — fall through to
      // time-overlap (still consume the stale preassignment).
    }

    const recStart = new Date(rec.date_recorded).getTime()
    if (!Number.isFinite(recStart)) continue
    const recEnd = recStart + (rec.duration_seconds || DEFAULT_RECORDING_DURATION) * 1000

    // Fit-based, bridge-excluding selection: a tightly-fitting meeting wins over a
    // containing all-day event, and an all-day/≥4h bridge is never auto-attached.
    const decision = selectAutoLinkMeeting(recStart, recEnd, meetingWindows)
    if (decision.id === null) {
      if (decision.declinedBridge) declinedBridgeCount++
    } else {
      overlapUpdates.push({ recordingId: rec.id, meetingId: decision.id })
    }
  }

  const hasWork =
    overlapUpdates.length > 0 ||
    preassignUpdates.length > 0 ||
    standaloneMarks.length > 0 ||
    consumedFilenames.size > 0
  if (!hasWork) {
    if (declinedBridgeCount > 0) {
      console.log(
        `[OrgReconciler] Left ${declinedBridgeCount} recording(s) unlinked — only ` +
        `all-day/long "bridge" meetings overlapped (need user/content corroboration)`
      )
    }
    return 0
  }

  let linked = 0
  runInTransaction(() => {
    for (const u of preassignUpdates) {
      run(
        `UPDATE recordings SET meeting_id = ?, correlation_confidence = 1.0, correlation_method = 'user_preassign'
         WHERE id = ? AND meeting_id IS NULL`,
        [u.meetingId, u.recordingId]
      )
      linked++
    }
    for (const id of standaloneMarks) {
      run(
        `UPDATE recordings SET correlation_method = '${STANDALONE_METHOD}'
         WHERE id = ? AND meeting_id IS NULL`,
        [id]
      )
    }
    for (const u of overlapUpdates) {
      run(
        `UPDATE recordings SET meeting_id = ?, correlation_confidence = 0.7, correlation_method = 'time_overlap'
         WHERE id = ? AND meeting_id IS NULL`,
        [u.meetingId, u.recordingId]
      )
      linked++
    }
    // Consume every preassignment we applied (explicit link, standalone, or stale).
    for (const filename of consumedFilenames) {
      run(`DELETE FROM recording_preassignments WHERE filename = ?`, [filename])
    }
  })

  if (linked > 0 || standaloneMarks.length > 0 || declinedBridgeCount > 0) {
    console.log(
      `[OrgReconciler] Auto-linked ${linked} recordings ` +
      `(${preassignUpdates.length} pre-assigned, ${overlapUpdates.length} time-overlap, ` +
      `${standaloneMarks.length} forced standalone, ${declinedBridgeCount} declined-to-bridge)`
    )
  }
  return linked
}

interface AttendeeJson {
  name?: string
  email?: string
}

/**
 * Create/update contacts from meeting attendees + organizers and link them to
 * their meetings. Idempotent — safe to run after every sync.
 */
export function upsertContactsFromMeetings(): { contacts: number; links: number } {
  const meetings = queryAll<MeetingRow>(
    `SELECT id, subject, start_time, attendees, organizer_name, organizer_email FROM meetings`
  )

  let newContacts = 0
  let newLinks = 0

  runInTransaction(() => {
    for (const meeting of meetings) {
      const people: Array<{ name?: string; email: string; role: string }> = []

      if (meeting.organizer_email) {
        people.push({ name: meeting.organizer_name, email: meeting.organizer_email.toLowerCase(), role: 'organizer' })
      }
      if (meeting.attendees) {
        try {
          const parsed = JSON.parse(meeting.attendees) as AttendeeJson[]
          for (const a of parsed) {
            if (a.email) people.push({ name: a.name, email: a.email.toLowerCase(), role: 'attendee' })
          }
        } catch {
          // malformed attendees JSON — skip
        }
      }

      for (const person of people) {
        let contact = queryOne<{ id: string; name: string; meeting_count: number }>(
          `SELECT id, name, meeting_count FROM contacts WHERE LOWER(email) = ?`,
          [person.email]
        )
        if (!contact) {
          const id = randomUUID()
          const now = meeting.start_time || new Date().toISOString()
          run(
            `INSERT INTO contacts (id, name, email, type, first_seen_at, last_seen_at, meeting_count)
             VALUES (?, ?, ?, 'unknown', ?, ?, 0)`,
            [id, person.name || person.email.split('@')[0], person.email, now, now]
          )
          contact = { id, name: person.name || person.email, meeting_count: 0 }
          newContacts++
        } else if (person.name && contact.name === person.email.split('@')[0]) {
          // upgrade email-derived placeholder names when a real name appears
          run(`UPDATE contacts SET name = ? WHERE id = ?`, [person.name, contact.id])
        }

        const existingLink = queryOne<{ meeting_id: string }>(
          `SELECT meeting_id FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?`,
          [meeting.id, contact.id]
        )
        if (!existingLink) {
          // These people come straight from the meeting's calendar organizer/
          // attendee data, so the membership is CALENDAR-authored (structural) —
          // tag it 'calendar' so the non-owner identity boundary treats it as
          // always-eligible, matching the sibling calendar path in database.ts
          // (syncMeetingContacts). Omitting the source left it NULL = legacy =
          // fail-closed suppressed, which would wrongly hide a real calendar
          // contact and (round-30) mis-partition it in mergeDuplicateContacts.
          run(
            `INSERT INTO meeting_contacts (meeting_id, contact_id, role, source) VALUES (?, ?, ?, 'calendar')`,
            [meeting.id, contact.id, person.role]
          )
          newLinks++
        }
      }
    }

    // Refresh meeting counts + last_seen from actual links
    run(`
      UPDATE contacts SET
        meeting_count = (SELECT COUNT(1) FROM meeting_contacts mc WHERE mc.contact_id = contacts.id),
        last_seen_at = COALESCE(
          (SELECT MAX(m.start_time) FROM meeting_contacts mc JOIN meetings m ON m.id = mc.meeting_id
           WHERE mc.contact_id = contacts.id),
          last_seen_at
        )
    `)
  })

  if (newContacts > 0 || newLinks > 0) {
    console.log(`[OrgReconciler] Contacts: +${newContacts} people, +${newLinks} meeting links`)
  }
  return { contacts: newContacts, links: newLinks }
}

/**
 * One-time repair: meetings synced before ICS unescaping still store literal
 * "\n" and "\," sequences. Detect and unescape them in place.
 */
export function repairEscapedMeetingText(): number {
  const rows = queryAll<{ id: string; subject: string; description?: string; location?: string }>(
    `SELECT id, subject, description, location FROM meetings
     WHERE description LIKE '%\\n%' OR subject LIKE '%\\,%' OR location LIKE '%\\,%'`
  )
  let repaired = 0
  runInTransaction(() => {
    for (const row of rows) {
      const subject = unescapeIcsText(row.subject || '')
      const description = row.description ? unescapeIcsText(row.description) : row.description
      const location = row.location ? unescapeIcsText(row.location) : row.location
      if (subject !== row.subject || description !== row.description || location !== row.location) {
        run(`UPDATE meetings SET subject = ?, description = ?, location = ? WHERE id = ?`, [
          subject,
          description ?? null,
          location ?? null,
          row.id
        ])
        repaired++
      }
    }
  })
  if (repaired > 0) console.log(`[OrgReconciler] Unescaped ICS text on ${repaired} meetings`)
  return repaired
}

/**
 * Idempotently link a contact to a meeting and refresh its meeting count/last-seen.
 *
 * v44/round-27 provenance: this helper only ever links AI-EXTRACTED / auto-resolved
 * participants (applyTranscriptEntities + autoSplitAmbiguousBuckets), so a NEW row
 * it writes is TRANSCRIPT-derived — tagged source='transcript' + the source
 * recording id so the non-owner identity surfaces gate it by that recording's
 * eligibility. A NULL sourceRecordingId leaves the row transcript-with-no-recording
 * ⇒ ineligible fail-closed (correct: unprovenanced transcript membership).
 */
function linkContactToMeeting(
  contactId: string,
  meetingId: string | undefined,
  now: string,
  sourceRecordingId?: string | null
): void {
  if (!contactId || !meetingId) return
  const link = queryOne<{ meeting_id: string }>(
    `SELECT meeting_id FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?`,
    [meetingId, contactId]
  )
  if (!link) {
    run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role, source, source_recording_id) VALUES (?, ?, 'attendee', 'transcript', ?)`, [
      meetingId,
      contactId,
      sourceRecordingId ?? null
    ])
  }
  run(
    `UPDATE contacts SET
       meeting_count = (SELECT COUNT(1) FROM meeting_contacts mc WHERE mc.contact_id = contacts.id),
       last_seen_at = ?
     WHERE id = ?`,
    [now, contactId]
  )
}

/**
 * Persist people + project extracted from a transcript by the AI analysis.
 * The published Outlook ICS feed carries no attendee data, so transcripts are
 * the primary source of "who was in this meeting". Projects are matched by
 * name (case-insensitive) or created when the model proposes a new one.
 */
export function applyTranscriptEntities(opts: {
  meetingId?: string
  /** The recording this analysis came from. When present, a stored per-recording
   *  mention resolution is honored, and an attendee-context split is remembered so a
   *  future re-analysis attributes the same mention to the same real person. */
  recordingId?: string
  participants?: Array<{ name: string; role?: string }>
  project?: { name: string; is_new?: boolean }
}): { contacts: number; projectLinked: boolean } {
  let contacts = 0
  let projectLinked = false

  runInTransaction(() => {
    const now = new Date().toISOString()

    // Names of other attendees already on the meeting — evidence for suggestions.
    const meetingAttendeeNames = (): string[] =>
      opts.meetingId
        ? queryAll<{ name: string }>(
            `SELECT c.name FROM meeting_contacts mc JOIN contacts c ON c.id = mc.contact_id WHERE mc.meeting_id = ?`,
            [opts.meetingId]
          )
            .map((r) => r.name)
            .slice(0, 5)
        : []

    for (const rawPerson of opts.participants ?? []) {
      const person = { ...rawPerson, role: cleanRole(rawPerson.role) || undefined }
      const name = (person.name || '').trim()
      if (!name || name.length < 2 || isGenericSpeakerLabel(name)) continue

      let contactId: string | null = null

      // 0. Honor a stored per-recording resolution first (user pick or auto-split) —
      // it overrides the resolver so a re-analysis never re-buckets a settled mention.
      if (opts.recordingId) {
        const decision = getMentionResolution(opts.recordingId, name)
        if (decision.decided) {
          if (decision.contactId) {
            contactId = decision.contactId
          } else {
            // Explicitly marked Unclear — leave it unattributed, do not create.
            continue
          }
          linkContactToMeeting(contactId, opts.meetingId, now, opts.recordingId)
          continue
        }
      }

      // Confidence-scored resolution replaces the old exact-name lookup — this is
      // what stops the duplicate factory (INTELLIGENCE.md §2).
      const res = resolveContact(name, { meetingId: opts.meetingId })

      // Ambiguous bare-first-name bucket ("Sergio" = several real people): keep the
      // mention in the bucket, NEVER auto-link to one surname-bearer and NEVER queue a
      // merge. It gets split per recording via the "Resolve per meeting" surface.
      if (res.ambiguous) {
        if (res.id) {
          contactId = res.id
        } else {
          const id = randomUUID()
          // v45/round-28: a transcript-extracted ENTITY ⇒ source='transcript' +
          // the source recording, so the visible-identity boundary suppresses it
          // on non-owner surfaces once that recording is excluded (ADV27-1).
          // v46/round-31 (ADV29-2): stamp role_source_recording_id = the recording
          // when we set a transcript-derived role, so a non-owner read can blank the
          // role if this recording is later excluded even while the entity stays
          // visible via another eligible recording.
          run(
            `INSERT INTO contacts (id, name, type, role, first_seen_at, last_seen_at, meeting_count, source, source_recording_id, role_source_recording_id, role_origin)
             VALUES (?, ?, 'unknown', ?, ?, ?, 0, 'transcript', ?, ?, ?)`,
            [id, name, person.role ?? null, now, now, opts.recordingId ?? null, person.role ? (opts.recordingId ?? null) : null, person.role ? 'transcript' : null]
          )
          contactId = id
          contacts++
        }
        linkContactToMeeting(contactId, opts.meetingId, now, opts.recordingId)
        continue
      }

      if (res.id && res.confidence >= AUTO_LINK_THRESHOLD) {
        // High confidence — link the existing contact, never create.
        contactId = res.id
        if (person.role) {
          // ADV28-1 (round-30): transcript enrichment must NOT mutate a STRUCTURAL
          // (calendar/user) or legacy contact's DISPLAYED fields. A transcript-derived
          // role written onto a structural entity would show on People + graph detail
          // and could never be revoked when the source recording is later excluded
          // (personal/soft-deleted/value/purged) — the structural entity has no field
          // provenance to reverse. So only fill an EMPTY role on a TRANSCRIPT-
          // provenanced contact, whose whole visibility is already gated by the
          // source recording via filterVisibleEntityIds. Structural/legacy contacts
          // keep only calendar/manual data (fail-closed: no laundering).
          const existing = queryOne<{ role?: string; source?: string | null }>(
            `SELECT role, source FROM contacts WHERE id = ?`,
            [contactId]
          )
          if (existing && !existing.role && existing.source === 'transcript') {
            // v46/round-31 (ADV29-2): record the recording that supplied this role so
            // a non-owner read blanks it if the recording is later excluded, even
            // though the entity stays visible via another eligible recording.
            run(`UPDATE contacts SET role = ?, role_source_recording_id = ?, role_origin = 'transcript' WHERE id = ?`, [
              person.role,
              opts.recordingId ?? null,
              contactId
            ])
          }
        }
        // Remember an attendee-context split so re-analysis attributes it the same way
        // instead of re-running the bucket guess (only meaningful with a recording).
        if (res.method === 'attendee-context' && opts.recordingId) {
          recordMentionResolutionNoSave(opts.recordingId, name, contactId, 'attendee-context', res.confidence)
        }
      } else if (res.id && res.confidence >= SUGGEST_THRESHOLD) {
        // Mid confidence — queue a reviewable suggestion; do NOT create or link.
        // v44/round-27 (ADV26-1): persist the authoritative source recording id so
        // this NON-graph transcript suggestion is revalidated through the recording
        // allowlist at surface + accept (excluded/purged source ⇒ suppressed/refused).
        insertIdentitySuggestion('person', name, res.id, res.confidence, {
          method: res.method,
          meetingId: opts.meetingId,
          coOccurring: meetingAttendeeNames(),
          ...(res.rarity ? { rarity: res.rarity } : {})
        }, opts.recordingId ? [opts.recordingId] : [])
        continue
      } else {
        // Low confidence — genuinely new person.
        const id = randomUUID()
        // v45/round-28: transcript-extracted ENTITY ⇒ source='transcript' + recording (ADV27-1).
        // v46/round-31 (ADV29-2): stamp role_source_recording_id when a transcript role is set.
        run(
          `INSERT INTO contacts (id, name, type, role, first_seen_at, last_seen_at, meeting_count, source, source_recording_id, role_source_recording_id, role_origin)
           VALUES (?, ?, 'unknown', ?, ?, ?, 0, 'transcript', ?, ?, ?)`,
          [id, name, person.role ?? null, now, now, opts.recordingId ?? null, person.role ? (opts.recordingId ?? null) : null, person.role ? 'transcript' : null]
        )
        contactId = id
        contacts++
      }

      if (contactId && opts.meetingId) {
        linkContactToMeeting(contactId, opts.meetingId, now, opts.recordingId)
      }
    }

    const projectName = (opts.project?.name || '').trim()
    if (projectName) {
      const res = resolveProject(projectName, { meetingId: opts.meetingId })
      let projectId: string | null = null

      if (res.id && res.confidence >= AUTO_LINK_THRESHOLD) {
        projectId = res.id
      } else if (res.id && res.confidence >= SUGGEST_THRESHOLD) {
        // v44/round-27 (ADV26-1): persist the source recording id (see person path).
        insertIdentitySuggestion('project', projectName, res.id, res.confidence, {
          method: res.method,
          meetingId: opts.meetingId,
          coOccurring: [],
          ...(res.rarity ? { rarity: res.rarity } : {})
        }, opts.recordingId ? [opts.recordingId] : [])
      } else if (isProjectDiscoveryRejected(projectName)) {
        // Dismissed discovery — a durable tombstone (v41) blocks silent
        // re-creation on re-analysis. Only the AUTO-create path is blocked:
        // if the user manually creates a project with this name, createProject
        // clears the tombstone and resolveProject links to it normally above.
        // Deliberately short-circuits BEFORE the discovery gate: a dismissed name
        // must not even accumulate sightings, or it would climb back into the
        // deferred-suggestion queue the user just cleared.
      } else {
        // F12 discovery gate. The resolver landing here means only "this is not a
        // project I already know" — NOT "this is a project". Require a plausible
        // name AND corroboration across >= 2 distinct sources before minting a
        // row; anything weaker is remembered as a deferred suggestion instead of
        // becoming a zero-item dead-end project.
        //
        // The ledger key must be STABLE across re-processing, so it identifies
        // the CAPTURE (the recording), not the meeting: a recording id never
        // changes, while its meeting_id is assigned late by correlation and
        // rewritten by occurrence merges. Keying on the meeting let one
        // conversation bank two sightings — once as 'r:x' before it was
        // correlated, again as 'm:y' after — manufacturing the very corroboration
        // this gate exists to require. The meeting rides along separately so the
        // count still collapses two recordings of one conversation into one
        // source. With neither id there is nothing to corroborate against, so we
        // neither record nor create.
        const quality = scoreProjectNameCandidate(projectName)
        const sourceKey = opts.recordingId
          ? `r:${opts.recordingId}`
          : opts.meetingId
            ? `m:${opts.meetingId}`
            : null
        // Score 0 is structural noise (a sentence fragment, digit soup) — dropped
        // before it reaches the ledger so the deferred queue stays reviewable.
        const distinctSources =
          quality.score > 0 && sourceKey
            ? recordProjectDiscoveryObservation(projectName, sourceKey, opts.meetingId ?? null, quality.score)
            : 0
        const decision = decideProjectDiscovery({ name: projectName, distinctSources })

        if (decision.action === 'create') {
          const id = randomUUID()
          // origin='discovered' (v42): durable provenance — ONLY rows created here
          // are dismissable via projects:dismissDiscovered (fail-closed elsewhere).
          // source='transcript' + recording (F18/round-28): the project ENTITY is
          // transcript-extracted, so it is suppressed on non-owner surfaces once its
          // source recording is excluded (ADV27-1).
          run(`INSERT INTO projects (id, name, status, origin, source, source_recording_id) VALUES (?, ?, 'active', 'discovered', 'transcript', ?)`, [
            id,
            projectName,
            opts.recordingId ?? null
          ])
          projectId = id

          // Link EVERY meeting whose mention earned this project, not just the one
          // that happened to cross the threshold. The corroborating sightings are
          // the evidence for creating it; dropping them when the ledger is cleared
          // left the graph permanently missing those associations (the first
          // meeting could only ever be linked by reprocessing its transcript).
          // Runs BEFORE the purge, inside applyTranscriptEntities' transaction.
          const corroborating = getProjectDiscoveryMeetingIds(projectName)
          let backfilled = 0
          for (const mid of corroborating) {
            if (mid === opts.meetingId) continue // linked below by the normal path
            run(`INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)`, [mid, id])
            backfilled++
          }

          // The name is settled — stop tracking it as an open discovery question.
          clearProjectDiscoveryObservations(projectName)
          console.log(
            `[OrgReconciler] Discovered project "${projectName}" ` +
              `(name score ${decision.score}, seen in ${decision.distinctSources} sources` +
              `${backfilled > 0 ? `, linked ${backfilled} corroborating meeting(s)` : ''})`
          )
        } else {
          console.log(
            `[OrgReconciler] Withheld project "${projectName}" — ${decision.action} ` +
              `(name score ${decision.score}, ${decision.distinctSources} source(s): ${decision.reasons.join(', ')})`
          )
        }
      }

      if (projectId && opts.meetingId) {
        const link = queryOne<{ meeting_id: string }>(
          `SELECT meeting_id FROM meeting_projects WHERE meeting_id = ? AND project_id = ?`,
          [opts.meetingId, projectId]
        )
        if (!link) {
          // v44 provenance: this project link is AI-extracted from the transcript ⇒
          // 'transcript' + the source recording id (gated by its eligibility).
          run(`INSERT INTO meeting_projects (meeting_id, project_id, source, source_recording_id) VALUES (?, ?, 'transcript', ?)`, [
            opts.meetingId,
            projectId,
            opts.recordingId ?? null
          ])
        }
        projectLinked = true
      }
    }
  })

  return { contacts, projectLinked }
}

interface DuplicateRecordingRow {
  id: string
  filename: string
  file_path?: string | null
  created_at?: string | null
  on_device?: number | null
  on_local?: number | null
  meeting_id?: string | null
  /** Whether a transcript row points at this recording. */
  hasTranscript?: boolean
}

/** Strip a recording audio extension so .hda/.wav/.mp3/.m4a variants group together. */
function baseRecordingName(filename: string): string {
  return (filename || '').replace(/\.(hda|wav|mp3|m4a)$/i, '')
}

/**
 * Choose which row in a duplicate group to keep. Preference order:
 *   1. has a transcript (most expensive to recreate)
 *   2. .wav filename (the downloaded/played format the UI prefers)
 *   3. file_path set (an actual local file exists)
 *   4. most recent created_at
 * Pure so the selection rules can be unit-tested without a database.
 */
export function pickKeeperRecording<T extends DuplicateRecordingRow>(rows: T[]): T {
  const isWav = (r: T) => /\.wav$/i.test(r.filename || '')
  const hasPath = (r: T) => !!(r.file_path && r.file_path.length > 0)
  return [...rows].sort((a, b) => {
    const at = a.hasTranscript ? 1 : 0
    const bt = b.hasTranscript ? 1 : 0
    if (at !== bt) return bt - at
    const aw = isWav(a) ? 1 : 0
    const bw = isWav(b) ? 1 : 0
    if (aw !== bw) return bw - aw
    const ap = hasPath(a) ? 1 : 0
    const bp = hasPath(b) ? 1 : 0
    if (ap !== bp) return bp - ap
    const ac = a.created_at || ''
    const bc = b.created_at || ''
    if (ac !== bc) return ac < bc ? 1 : -1
    return 0
  })[0]
}

/**
 * Collapse legacy duplicate recordings — rows for the same audio that predate
 * markRecordingDownloaded() becoming extension-variant-aware (e.g. a .hda row
 * and a .wav row for the same take, both with file_path set). The Library
 * showed the meeting twice and batch transcription paid to transcribe it twice.
 *
 * For each base-filename group with more than one row we pick a keeper (see
 * pickKeeperRecording), repoint child rows off the losers, fold the losers'
 * lifecycle flags onto the keeper, and delete the loser rows — all in ONE
 * transaction so the whole sql.js DB is persisted once, not per row.
 */
export function mergeDuplicateRecordings(): number {
  const recordings = queryAll<DuplicateRecordingRow>(
    `SELECT id, filename, file_path, created_at, on_device, on_local, meeting_id FROM recordings`
  )
  if (recordings.length === 0) return 0

  // Which recordings already have a transcript — drives keeper selection.
  const withTranscript = new Set(
    queryAll<{ recording_id: string }>(`SELECT recording_id FROM transcripts`).map((t) => t.recording_id)
  )

  const groups = new Map<string, DuplicateRecordingRow[]>()
  for (const rec of recordings) {
    const key = baseRecordingName(rec.filename || rec.id).toLowerCase()
    const list = groups.get(key)
    if (list) list.push(rec)
    else groups.set(key, [rec])
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1)
  if (dupGroups.length === 0) return 0

  // ADV28-3 (round-30) — NEVER merge recordings across an eligibility boundary.
  // This reconcile REPARENTS a loser's knowledge_captures (and transcript / vector
  // rows) onto the keeper. If an ELIGIBLE keeper absorbed a personal / soft-deleted /
  // value-excluded sibling, that sibling's captures would be reparented onto the
  // eligible keeper and pass filterEligibleCaptureIds again ⇒ formerly-excluded
  // content reaches RAG / LLM / display / search (REOPENS the core F16/F17 promise).
  // Fix: partition each duplicate group by the positive recording allowlist and
  // collapse ONLY the ELIGIBLE members among themselves. Excluded recordings are
  // left as separate rows, each still gated by its own recording's exclusion (their
  // captures keep pointing at the excluded recording). This also side-steps a
  // value-flip: reparenting a valuable capture from an excluded sibling could
  // otherwise clear the keeper's value-exclusion. Fail-closed: an eligibility lookup
  // failure ⇒ merge nothing this pass.
  const { eligible: eligibleRecIds, failClosed: eligFailClosed } = filterEligibleRecordingIds(
    dupGroups.flat().map((r) => r.id)
  )

  // vector_embeddings is created lazily by the vector store and may not exist
  // yet; skip it rather than blowing up the whole transaction on a fresh DB.
  const existingTables = new Set(
    queryAll<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((r) => r.name)
  )

  let mergedGroups = 0
  let removedRows = 0

  runInTransaction(() => {
    if (eligFailClosed) return
    for (const group of dupGroups) {
      // Only the eligible members of the group may be collapsed together.
      const eligibleGroup = group.filter((r) => eligibleRecIds.has(r.id))
      if (eligibleGroup.length < 2) continue
      const rows = eligibleGroup.map((r) => ({ ...r, hasTranscript: withTranscript.has(r.id) }))
      const keeper = pickKeeperRecording(rows)
      const losers = rows.filter((r) => r.id !== keeper.id)
      if (losers.length === 0) continue

      // Keeper selection sorts transcript-holders first, so the keeper already
      // owns a transcript whenever the group has one; the repoint branch below
      // is defensive for the inverse case only.
      let keeperHasTranscript = keeper.hasTranscript === true

      for (const loser of losers) {
        if (loser.hasTranscript) {
          // transcripts.recording_id is UNIQUE and the PK is `trans_<recordingId>`.
          if (keeperHasTranscript) {
            run(`DELETE FROM transcripts WHERE recording_id = ?`, [loser.id])
          } else {
            run(`UPDATE transcripts SET id = ?, recording_id = ? WHERE recording_id = ?`, [
              `trans_${keeper.id}`,
              keeper.id,
              loser.id
            ])
            keeperHasTranscript = true
          }
        }

        run(`UPDATE transcription_queue SET recording_id = ? WHERE recording_id = ?`, [keeper.id, loser.id])
        // candidates are UNIQUE(recording_id, meeting_id) — move what won't
        // collide with the keeper's rows, then drop any leftover collisions.
        run(`UPDATE OR IGNORE recording_meeting_candidates SET recording_id = ? WHERE recording_id = ?`, [
          keeper.id,
          loser.id
        ])
        run(`DELETE FROM recording_meeting_candidates WHERE recording_id = ?`, [loser.id])
        if (existingTables.has('vector_embeddings')) {
          run(`UPDATE vector_embeddings SET recording_id = ? WHERE recording_id = ?`, [keeper.id, loser.id])
        }
        run(`UPDATE knowledge_captures SET source_recording_id = ? WHERE source_recording_id = ?`, [
          keeper.id,
          loser.id
        ])
      }

      // Fold lifecycle flags onto the keeper: a merged take is on-device/on-local
      // if ANY variant was, and keeps a meeting link / local file if one exists.
      const onDevice = rows.some((r) => (r.on_device ?? 0) === 1) ? 1 : 0
      const onLocal = rows.some((r) => (r.on_local ?? 0) === 1) ? 1 : 0
      const meetingId = keeper.meeting_id ?? rows.find((r) => r.meeting_id)?.meeting_id ?? null
      const wavPath = rows.find((r) => /\.wav$/i.test(r.filename || '') && r.file_path)?.file_path
      const filePath = keeper.file_path ?? wavPath ?? rows.find((r) => r.file_path)?.file_path ?? null
      // Keep the location badge consistent with the merged on_device/on_local flags.
      const location =
        onDevice && onLocal ? 'both' : onDevice ? 'device-only' : onLocal ? 'local-only' : 'deleted'

      run(`UPDATE recordings SET on_device = ?, on_local = ?, meeting_id = ?, file_path = ?, location = ? WHERE id = ?`, [
        onDevice,
        onLocal,
        meetingId,
        filePath,
        location,
        keeper.id
      ])

      for (const loser of losers) {
        run(`DELETE FROM recordings WHERE id = ?`, [loser.id])
        removedRows++
      }
      mergedGroups++
    }
  })

  if (mergedGroups > 0) {
    console.log(`[OrgReconciler] Merged ${mergedGroups} duplicate recording groups (removed ${removedRows} rows)`)
  }
  return mergedGroups
}

interface DuplicateContactRow {
  id: string
  name: string
  email?: string | null
  role?: string | null
  company?: string | null
  meeting_count?: number | null
  created_at?: string | null
}

/**
 * Choose which contact in a duplicate group to keep. Preference order:
 *   1. has an email (the strongest identity anchor)
 *   2. has a role or company (enriched)
 *   3. most meeting_count (most-connected)
 *   4. oldest created_at (the original record)
 * Pure so the selection rules can be unit-tested without a database.
 */
export function pickKeeperContact<T extends DuplicateContactRow>(rows: T[]): T {
  const notEmpty = (v?: string | null) => !!(v && v.trim())
  const hasEmail = (r: T) => notEmpty(r.email)
  const hasRoleOrCompany = (r: T) => notEmpty(r.role) || notEmpty(r.company)
  return [...rows].sort((a, b) => {
    const ae = hasEmail(a) ? 1 : 0
    const be = hasEmail(b) ? 1 : 0
    if (ae !== be) return be - ae
    const arc = hasRoleOrCompany(a) ? 1 : 0
    const brc = hasRoleOrCompany(b) ? 1 : 0
    if (arc !== brc) return brc - arc
    const am = a.meeting_count ?? 0
    const bm = b.meeting_count ?? 0
    if (am !== bm) return bm - am
    const ac = a.created_at || ''
    const bc = b.created_at || ''
    if (ac !== bc) return ac < bc ? -1 : 1 // oldest first
    return 0
  })[0]
}

/**
 * Auto-merge unambiguous duplicate contacts. Two contacts are merged ONLY when
 * they share a non-empty lower-cased email, OR an exact lower-cased name —
 * never on fuzzy/partial similarity. Email groups are collapsed first, then
 * name groups (recomputed after the email pass), reusing mergeContacts per pair.
 * Returns the number of contacts removed by merging.
 */
export function mergeDuplicateContacts(): number {
  let removed = 0

  const collapseGroups = (keyOf: (c: DuplicateContactRow) => string | null): void => {
    const contacts = queryAll<DuplicateContactRow>(
      'SELECT id, name, email, role, company, meeting_count, created_at FROM contacts'
    )
    const groups = new Map<string, DuplicateContactRow[]>()
    for (const c of contacts) {
      const key = keyOf(c)
      if (!key) continue
      const list = groups.get(key)
      if (list) list.push(c)
      else groups.set(key, [c])
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const keeper = pickKeeperContact(group)
      // ADV28-2 (round-30): partition the group by the visible-identity boundary so
      // an AUTOMATIC startup dedup NEVER folds an excluded/suppressed transcript-only
      // contact's role/company/notes/tags/memberships into a structurally-visible
      // (calendar/manual/eligible-transcript) survivor — that would launder
      // excluded-derived fields onto a visible entity. Merge only pairs on the SAME
      // side of the visibility boundary: two visible contacts dedup as before; two
      // suppressed contacts collapse (the survivor stays suppressed, no leak); a
      // visible↔suppressed pair is left separate. Fail-closed: if visibility can't be
      // determined, fold nothing this pass.
      const { visible, failClosed } = filterVisibleEntityIds('contact', group.map((c) => c.id))
      if (failClosed) continue
      const keeperVisible = visible.has(keeper.id)
      for (const loser of group) {
        if (loser.id === keeper.id) continue
        if (visible.has(loser.id) !== keeperVisible) continue // cross visibility boundary — never launder
        // ADV55-1 (round-57): fold the backing graph person nodes atomically with the
        // relational merge (was bare mergeContacts, which left the loser's graph node +
        // provenance stranded under the deleted loser contact id whenever the
        // post-commit name event no-opped for contact-keyed nodes or graph sync was off).
        mergeContactsWithGraph(keeper.id, loser.id)
        removed++
      }
    }
  }

  collapseGroups((c) => (c.email && c.email.trim() ? c.email.trim().toLowerCase() : null))
  collapseGroups((c) => (c.name && c.name.trim() ? c.name.trim().toLowerCase() : null))

  if (removed > 0) {
    console.log(`[OrgReconciler] Merged ${removed} duplicate contacts (email/name match)`)
  }
  return removed
}

interface DuplicateMeetingRow {
  id: string
  subject: string
  start_time: string
  end_time: string
  is_recurring: number
  recurrence_rule?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/**
 * Choose which row in a duplicate meeting-occurrence group to keep. Preference:
 *   1. has a linked recording (never orphan a recording's attribution)
 *   2. bare-uid id (matches the sync-time remap's canonical target → convergence)
 *   3. oldest created_at (the original record other rows may reference)
 * Pure so the selection rules can be unit-tested without a database.
 */
export function pickKeeperMeeting<T extends { id: string; created_at?: string | null }>(
  rows: T[],
  linkedMeetingIds: Set<string> = new Set()
): T {
  const hasRec = (r: T) => linkedMeetingIds.has(r.id)
  const isBare = (r: T) => !r.id.includes('::')
  return [...rows].sort((a, b) => {
    const ar = hasRec(a) ? 1 : 0
    const br = hasRec(b) ? 1 : 0
    if (ar !== br) return br - ar
    const ab = isBare(a) ? 1 : 0
    const bb = isBare(b) ? 1 : 0
    if (ab !== bb) return bb - ab
    const ac = a.created_at || ''
    const bc = b.created_at || ''
    if (ac !== bc) return ac < bc ? -1 : 1 // oldest first
    return 0
  })[0]
}

/**
 * Collapse duplicate meeting rows that describe the SAME real occurrence of a
 * recurring series. The recurrence-expansion rollout (commit 1e5125c6) changed
 * the occurrence id scheme from a bare `uid` to `uid::slotISO`; for a series
 * whose master DTSTART sits outside the expansion window, the stale
 * pre-expansion bare-uid row and the new `uid::slotISO` row both survived, so the
 * meeting appeared twice on the same slot.
 *
 * Rows group by base uid + start_time; any group with >1 row is a twin set. Keep
 * the row with linked recordings (or the bare-uid / oldest row), repoint every
 * child FK off the losers onto the keeper, refresh the keeper's content from the
 * most recently synced row, then delete the losers. Idempotent — a second run
 * finds no groups. sql.js does not enforce ON DELETE CASCADE, so child rows are
 * repointed explicitly rather than relying on the foreign keys.
 */
export function mergeDuplicateMeetingOccurrences(): number {
  const meetings = queryAll<DuplicateMeetingRow>(
    `SELECT id, subject, start_time, end_time, is_recurring, recurrence_rule, created_at, updated_at FROM meetings`
  )
  if (meetings.length === 0) return 0

  const groups = new Map<string, DuplicateMeetingRow[]>()
  for (const m of meetings) {
    const key = `${meetingBaseUid(m.id)}\u0000${m.start_time}`
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1)
  if (dupGroups.length === 0) return 0

  // Which meetings have a recording linked — drives keeper selection so a
  // recording's meeting_id is never left pointing at a deleted row.
  const linkedMeetingIds = new Set(
    queryAll<{ meeting_id: string }>(
      `SELECT DISTINCT meeting_id FROM recordings WHERE meeting_id IS NOT NULL`
    ).map((r) => r.meeting_id)
  )
  // Some meeting-referencing tables are created lazily; skip any that don't exist
  // yet rather than aborting the whole transaction.
  const existingTables = new Set(
    queryAll<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((r) => r.name)
  )

  let mergedGroups = 0
  let removedRows = 0

  runInTransaction(() => {
    for (const group of dupGroups) {
      const keeper = pickKeeperMeeting(group, linkedMeetingIds)
      const losers = group.filter((r) => r.id !== keeper.id)
      if (losers.length === 0) continue

      for (const loser of losers) {
        // Plain meeting_id columns — straight repoint.
        run(`UPDATE recordings SET meeting_id = ? WHERE meeting_id = ?`, [keeper.id, loser.id])
        if (existingTables.has('knowledge_captures')) {
          run(`UPDATE knowledge_captures SET meeting_id = ? WHERE meeting_id = ?`, [keeper.id, loser.id])
        }
        if (existingTables.has('follow_ups')) {
          run(`UPDATE follow_ups SET scheduled_meeting_id = ? WHERE scheduled_meeting_id = ?`, [
            keeper.id,
            loser.id
          ])
        }
        if (existingTables.has('recording_preassignments')) {
          run(`UPDATE recording_preassignments SET meeting_id = ? WHERE meeting_id = ?`, [keeper.id, loser.id])
        }
        // Discovery ledger (v43): the sightings of the two occurrences describe
        // ONE conversation. Without this repoint the merged-away meeting id
        // survives in the ledger and the distinct-source count double-counts it,
        // which would let a single conversation clear the recurrence bar alone.
        if (existingTables.has('project_discovery_observations')) {
          run(`UPDATE project_discovery_observations SET meeting_id = ? WHERE meeting_id = ?`, [
            keeper.id,
            loser.id
          ])
        }
        // Composite-key link tables — move what won't collide, drop leftovers.
        run(`UPDATE OR IGNORE meeting_contacts SET meeting_id = ? WHERE meeting_id = ?`, [keeper.id, loser.id])
        run(`DELETE FROM meeting_contacts WHERE meeting_id = ?`, [loser.id])
        run(`UPDATE OR IGNORE meeting_projects SET meeting_id = ? WHERE meeting_id = ?`, [keeper.id, loser.id])
        run(`DELETE FROM meeting_projects WHERE meeting_id = ?`, [loser.id])
        run(`UPDATE OR IGNORE recording_meeting_candidates SET meeting_id = ? WHERE meeting_id = ?`, [
          keeper.id,
          loser.id
        ])
        run(`DELETE FROM recording_meeting_candidates WHERE meeting_id = ?`, [loser.id])
      }

      // Refresh the keeper's content from the most recently synced row in the
      // group so the surviving row reflects the latest feed (a stale bare-uid row
      // kept for its FKs otherwise shows pre-expansion subject / is_recurring).
      const best = [...group].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0]
      if (best && best.id !== keeper.id) {
        run(
          `UPDATE meetings SET subject = ?, start_time = ?, end_time = ?, is_recurring = ?,
             recurrence_rule = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [best.subject, best.start_time, best.end_time, best.is_recurring, best.recurrence_rule ?? null, keeper.id]
        )
      }

      for (const loser of losers) {
        run(`DELETE FROM meetings WHERE id = ?`, [loser.id])
        removedRows++
      }
      mergedGroups++
    }
  })

  if (mergedGroups > 0) {
    console.log(
      `[OrgReconciler] Merged ${mergedGroups} duplicate meeting-occurrence groups (removed ${removedRows} rows)`
    )
  }
  return mergedGroups
}

// ---------------------------------------------------------------------------
// BUG A — misbundled-recording repair (gated, idempotent stale-data cleanup)
// ---------------------------------------------------------------------------
//
// The live auto-correlation/occurrence-resolution code (selectAutoLinkMeeting +
// mergeDuplicateMeetingOccurrences) binds a recording to the occurrence whose
// window actually matches its timestamp and never forces it onto a far anchor
// (proven by recording-occurrence-binding.test.ts). But rows written BEFORE that
// policy landed can still point a recording at a meeting weeks away — e.g. a
// July-1 recording bundled onto the May-27 anchor of a recurring series.
//
// This is a STALE-DATA repair, so it is GATED: findMisbundledRecordings() /
// repairMisbundledRecordings({confirm:false}) only REPORT (count + sample); the
// rewrite runs only with confirm:true. It re-points a misbundled recording onto
// the better-matching sibling occurrence of the SAME series (using the exact
// selectAutoLinkMeeting policy) or, when no sibling matches, unlinks it so it
// returns to the candidate pool — never leaving it on a window weeks away.

/** A recording this far outside its linked meeting's window is clearly misbundled. */
export const MISBUNDLE_GAP_MS = 12 * 60 * 60 * 1000
/** Cap the returned sample (never the actual rewrite). */
const MISBUNDLE_SAMPLE_CAP = 25

export interface MisbundledRecording {
  recordingId: string
  filename: string | null
  dateRecorded: string
  currentMeetingId: string
  currentMeetingSubject: string | null
  currentMeetingStart: string
  currentMeetingEnd: string
  /** How far (hours) the recording sits outside its linked meeting's window. */
  gapHours: number
  action: 'rebundle' | 'unlink'
  /** Sibling occurrence to re-point onto (null when unlinking). */
  targetMeetingId: string | null
  targetMeetingStart: string | null
}

export interface MisbundleRepairReport {
  /** true = report only (no rewrite happened). */
  dryRun: boolean
  /** Total affected recordings (never truncated). */
  totalCount: number
  /** How many rows were rewritten (0 on a dry run). */
  applied: number
  /** First {@link MISBUNDLE_SAMPLE_CAP} affected bundles for review. */
  sample: MisbundledRecording[]
  /** true when totalCount exceeded the sample cap. */
  sampleTruncated: boolean
}

/** 0 when the two windows overlap; otherwise the gap to the nearest edge (ms). */
function windowGapMs(recStart: number, recEnd: number, mStart: number, mEnd: number): number {
  if (recEnd >= mStart && recStart <= mEnd) return 0
  return recEnd < mStart ? mStart - recEnd : recStart - mEnd
}

/**
 * Find recordings whose date_recorded sits far outside their linked meeting's
 * window (> gapThresholdMs). For each, resolve the intended target: the
 * better-matching sibling occurrence of the same series (selectAutoLinkMeeting
 * policy) → 'rebundle'; otherwise 'unlink'. Pure read — never mutates.
 */
export function findMisbundledRecordings(gapThresholdMs = MISBUNDLE_GAP_MS): MisbundledRecording[] {
  const recordings = queryAll<RecordingRow>(
    `SELECT id, filename, date_recorded, duration_seconds, meeting_id
       FROM recordings
      WHERE meeting_id IS NOT NULL AND date_recorded IS NOT NULL AND deleted_at IS NULL`
  )
  if (recordings.length === 0) return []

  const meetings = queryAll<MeetingRow>(`SELECT id, subject, start_time, end_time, is_all_day FROM meetings`)
  const byId = new Map(meetings.map((m) => [m.id, m]))

  // Group occurrences by base uid so a misbundled recording can be re-pointed onto
  // a sibling occurrence of the SAME recurring series (never a different series).
  const siblingsByBase = new Map<string, AutoLinkWindow[]>()
  for (const m of meetings) {
    const start = new Date(m.start_time).getTime()
    const end = new Date(m.end_time).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const base = meetingBaseUid(m.id)
    const list = siblingsByBase.get(base) ?? []
    list.push({ id: m.id, start, end, isAllDay: (m.is_all_day ?? 0) === 1 })
    siblingsByBase.set(base, list)
  }

  const out: MisbundledRecording[] = []
  for (const rec of recordings) {
    const m = rec.meeting_id ? byId.get(rec.meeting_id) : undefined
    if (!m) continue // dangling FK — handled by pre-migration cleanup, not here
    const recStart = new Date(rec.date_recorded).getTime()
    const mStart = new Date(m.start_time).getTime()
    const mEnd = new Date(m.end_time).getTime()
    if (!Number.isFinite(recStart) || !Number.isFinite(mStart) || !Number.isFinite(mEnd)) continue
    const recEnd = recStart + (rec.duration_seconds || DEFAULT_RECORDING_DURATION) * 1000

    const gap = windowGapMs(recStart, recEnd, mStart, mEnd)
    if (gap <= gapThresholdMs) continue // within tolerance — leave it alone

    // Re-point only onto a sibling occurrence of the same series, chosen by the
    // exact live auto-link policy (fit-based, bridge-excluding). No sibling → unlink.
    const base = meetingBaseUid(m.id)
    const siblings = (siblingsByBase.get(base) ?? []).filter((w) => w.id !== m.id)
    const decision = siblings.length > 0 ? selectAutoLinkMeeting(recStart, recEnd, siblings) : { id: null }
    const target = decision.id ? byId.get(decision.id) : undefined

    out.push({
      recordingId: rec.id,
      filename: rec.filename ?? null,
      dateRecorded: rec.date_recorded,
      currentMeetingId: m.id,
      currentMeetingSubject: m.subject ?? null,
      currentMeetingStart: m.start_time,
      currentMeetingEnd: m.end_time,
      gapHours: Math.round((gap / 3_600_000) * 10) / 10,
      action: target ? 'rebundle' : 'unlink',
      targetMeetingId: target?.id ?? null,
      targetMeetingStart: target?.start_time ?? null
    })
  }
  return out
}

/**
 * Gated repair for BUG A. With `confirm` falsy (default), returns a dry-run report
 * (totalCount + a capped sample) and rewrites NOTHING. With `confirm: true`, applies
 * the rewrite in one transaction: rebundle onto the matching sibling occurrence, or
 * unlink when none matches. Every change is logged (the merge-path journaling
 * pattern). Idempotent — a second confirmed run finds nothing.
 */
export function repairMisbundledRecordings(
  opts: { confirm?: boolean; gapThresholdMs?: number } = {}
): MisbundleRepairReport {
  const confirm = opts.confirm === true
  const found = findMisbundledRecordings(opts.gapThresholdMs)
  const totalCount = found.length
  const sample = found.slice(0, MISBUNDLE_SAMPLE_CAP)
  const sampleTruncated = totalCount > sample.length
  if (sampleTruncated) {
    console.log(
      `[OrgReconciler] Misbundle repair: ${totalCount} affected; sample capped at ${sample.length} ` +
      `(the confirmed rewrite still processes all ${totalCount}).`
    )
  }

  if (!confirm || totalCount === 0) {
    return { dryRun: true, totalCount, applied: 0, sample, sampleTruncated }
  }

  let applied = 0
  runInTransaction(() => {
    for (const item of found) {
      if (item.action === 'rebundle' && item.targetMeetingId) {
        run(
          `UPDATE recordings SET meeting_id = ?, correlation_confidence = 0.7, correlation_method = 'repair_rebundle'
             WHERE id = ? AND meeting_id = ?`,
          [item.targetMeetingId, item.recordingId, item.currentMeetingId]
        )
        console.log(
          `[OrgReconciler] Misbundle repair: rebundled ${item.recordingId} (${item.filename ?? '?'}) ` +
          `${item.currentMeetingId} → ${item.targetMeetingId} (was ${item.gapHours}h outside window)`
        )
      } else {
        run(
          `UPDATE recordings SET meeting_id = NULL, correlation_confidence = NULL, correlation_method = 'repair_unbundled'
             WHERE id = ? AND meeting_id = ?`,
          [item.recordingId, item.currentMeetingId]
        )
        console.log(
          `[OrgReconciler] Misbundle repair: unlinked ${item.recordingId} (${item.filename ?? '?'}) ` +
          `from ${item.currentMeetingId} (was ${item.gapHours}h outside; no sibling occurrence matched)`
        )
      }
      applied++
    }
  })

  console.log(`[OrgReconciler] Misbundle repair applied: ${applied}/${totalCount} recording(s) re-pointed or unlinked.`)
  return { dryRun: false, totalCount, applied, sample, sampleTruncated }
}

/**
 * Auto-split ambiguous mention buckets: for each bucket ("Sergio" = several real
 * people), walk its recordings and, where the signal is unambiguous — the transcript
 * names exactly one candidate as a speaker, or exactly one candidate is present in the
 * linked meeting — pin that recording's mention to the real person. Recordings with no
 * signal (or a tie) are left for the user's "Resolve per meeting" review.
 *
 * UPGRADE-ONLY and re-runnable (see signal-tiers.ts): a recording is (re)resolved only
 * when the available signal OUTRANKS any existing stored resolution — a 'manual' user
 * pick is never overwritten, and equal/lower signals are left alone (idempotent). This
 * is what lets a re-sweep upgrade transcript-derived guesses to 'attendee-email' once
 * the M365 connector backfills real calendar attendees.
 */
export function autoSplitAmbiguousBuckets(): { buckets: number; resolved: number } {
  const buckets = getAmbiguousBuckets()
  let resolvedTotal = 0
  const now = new Date().toISOString()
  for (const b of buckets) {
    const res = getBucketResolution(b.contactId)
    if (!res) continue
    const toResolve = res.recordings.filter(
      (r) => r.method !== 'unclear' && r.bestGuessId && canUpgrade(r.resolvedMethod, r.method)
    )
    if (toResolve.length === 0) continue
    runInTransaction(() => {
      for (const r of toResolve) {
        recordMentionResolutionNoSave(r.recordingId, res.name, r.bestGuessId as string, r.method, methodConfidence(r.method))
        linkContactToMeeting(r.bestGuessId as string, r.meetingId ?? undefined, now, r.recordingId)
        resolvedTotal++
      }
    })
  }
  if (resolvedTotal > 0) {
    console.log(`[OrgReconciler] Auto-split ${resolvedTotal} bucket mentions across ${buckets.length} buckets`)
  }
  return { buckets: buckets.length, resolved: resolvedTotal }
}

/** Full reconciliation pass — run after calendar syncs and at startup. */
export function reconcileOrganization(): void {
  try {
    repairEscapedMeetingText()
  } catch (e) {
    console.error('[OrgReconciler] text repair failed:', e)
  }
  try {
    mergeDuplicateMeetingOccurrences()
  } catch (e) {
    console.error('[OrgReconciler] duplicate meeting-occurrence merge failed:', e)
  }
  try {
    mergeDuplicateRecordings()
  } catch (e) {
    console.error('[OrgReconciler] duplicate recording merge failed:', e)
  }
  try {
    autoLinkRecordingsToMeetings()
  } catch (e) {
    console.error('[OrgReconciler] recording auto-link failed:', e)
  }
  try {
    upsertContactsFromMeetings()
  } catch (e) {
    console.error('[OrgReconciler] contacts upsert failed:', e)
  }
  try {
    mergeDuplicateContacts()
  } catch (e) {
    console.error('[OrgReconciler] duplicate contact merge failed:', e)
  }
  try {
    autoSplitAmbiguousBuckets()
  } catch (e) {
    console.error('[OrgReconciler] ambiguous-bucket auto-split failed:', e)
  }
  try {
    // BUG B self-heal: advance recordings.status for rows with a joined transcript
    // whose status drifted (never advanced past its insert-time default).
    healRecordingStatusFromTranscripts()
  } catch (e) {
    console.error('[OrgReconciler] recording status self-heal failed:', e)
  }
}
