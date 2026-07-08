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
  mergeContacts,
  insertIdentitySuggestion,
  getAllRecordingPreassignments,
  type RecordingPreassignment
} from './database'
import { resolveContact, resolveProject } from './entity-resolver'
import { isGenericSpeakerLabel } from './entity-normalize'
import { randomUUID } from 'crypto'

/** Resolver thresholds (INTELLIGENCE.md §2): ≥0.8 auto-link, 0.5–0.8 suggest, <0.5 create. */
const AUTO_LINK_THRESHOLD = 0.8
const SUGGEST_THRESHOLD = 0.5

interface MeetingRow {
  id: string
  subject: string
  start_time: string
  end_time: string
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

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
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
    `SELECT id, subject, start_time, end_time FROM meetings`
  )
  const meetingIds = new Set(meetings.map((m) => m.id))
  const meetingWindows = meetings
    .map((m) => ({
      id: m.id,
      start: new Date(m.start_time).getTime(),
      end: new Date(m.end_time).getTime()
    }))
    .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end))

  // Collect the work first, then apply in ONE transaction — per-row run()
  // persists the whole sql.js database to disk on every call.
  const overlapUpdates: Array<{ recordingId: string; meetingId: string }> = []
  const preassignUpdates: Array<{ recordingId: string; meetingId: string }> = []
  const standaloneMarks: string[] = []
  const consumedFilenames = new Set<string>()

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

    let best: { id: string; overlap: number } | null = null
    for (const m of meetingWindows) {
      const o = overlapMs(recStart, recEnd, m.start - EARLY_START_TOLERANCE_MS, m.end)
      if (o > 0 && (!best || o > best.overlap)) {
        best = { id: m.id, overlap: o }
      }
    }
    if (best) overlapUpdates.push({ recordingId: rec.id, meetingId: best.id })
  }

  const hasWork =
    overlapUpdates.length > 0 ||
    preassignUpdates.length > 0 ||
    standaloneMarks.length > 0 ||
    consumedFilenames.size > 0
  if (!hasWork) return 0

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

  if (linked > 0 || standaloneMarks.length > 0) {
    console.log(
      `[OrgReconciler] Auto-linked ${linked} recordings ` +
      `(${preassignUpdates.length} pre-assigned, ${overlapUpdates.length} time-overlap, ` +
      `${standaloneMarks.length} forced standalone)`
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
          run(
            `INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)`,
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
 * Persist people + project extracted from a transcript by the AI analysis.
 * The published Outlook ICS feed carries no attendee data, so transcripts are
 * the primary source of "who was in this meeting". Projects are matched by
 * name (case-insensitive) or created when the model proposes a new one.
 */
export function applyTranscriptEntities(opts: {
  meetingId?: string
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

    for (const person of opts.participants ?? []) {
      const name = (person.name || '').trim()
      if (!name || name.length < 2 || isGenericSpeakerLabel(name)) continue

      // Confidence-scored resolution replaces the old exact-name lookup — this is
      // what stops the duplicate factory (INTELLIGENCE.md §2).
      const res = resolveContact(name, { meetingId: opts.meetingId })
      let contactId: string | null = null

      if (res.id && res.confidence >= AUTO_LINK_THRESHOLD) {
        // High confidence — link the existing contact, never create.
        contactId = res.id
        if (person.role) {
          const existing = queryOne<{ role?: string }>(`SELECT role FROM contacts WHERE id = ?`, [contactId])
          if (existing && !existing.role) run(`UPDATE contacts SET role = ? WHERE id = ?`, [person.role, contactId])
        }
      } else if (res.id && res.confidence >= SUGGEST_THRESHOLD) {
        // Mid confidence — queue a reviewable suggestion; do NOT create or link.
        insertIdentitySuggestion('person', name, res.id, res.confidence, {
          method: res.method,
          meetingId: opts.meetingId,
          coOccurring: meetingAttendeeNames(),
          ...(res.rarity ? { rarity: res.rarity } : {})
        })
        continue
      } else {
        // Low confidence — genuinely new person.
        const id = randomUUID()
        run(
          `INSERT INTO contacts (id, name, type, role, first_seen_at, last_seen_at, meeting_count)
           VALUES (?, ?, 'unknown', ?, ?, ?, 0)`,
          [id, name, person.role ?? null, now, now]
        )
        contactId = id
        contacts++
      }

      if (contactId && opts.meetingId) {
        const link = queryOne<{ meeting_id: string }>(
          `SELECT meeting_id FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?`,
          [opts.meetingId, contactId]
        )
        if (!link) {
          run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, 'attendee')`, [
            opts.meetingId,
            contactId
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
    }

    const projectName = (opts.project?.name || '').trim()
    if (projectName) {
      const res = resolveProject(projectName, { meetingId: opts.meetingId })
      let projectId: string | null = null

      if (res.id && res.confidence >= AUTO_LINK_THRESHOLD) {
        projectId = res.id
      } else if (res.id && res.confidence >= SUGGEST_THRESHOLD) {
        insertIdentitySuggestion('project', projectName, res.id, res.confidence, {
          method: res.method,
          meetingId: opts.meetingId,
          coOccurring: [],
          ...(res.rarity ? { rarity: res.rarity } : {})
        })
      } else {
        const id = randomUUID()
        run(`INSERT INTO projects (id, name, status) VALUES (?, ?, 'active')`, [id, projectName])
        projectId = id
      }

      if (projectId && opts.meetingId) {
        const link = queryOne<{ meeting_id: string }>(
          `SELECT meeting_id FROM meeting_projects WHERE meeting_id = ? AND project_id = ?`,
          [opts.meetingId, projectId]
        )
        if (!link) {
          run(`INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)`, [opts.meetingId, projectId])
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

  // vector_embeddings is created lazily by the vector store and may not exist
  // yet; skip it rather than blowing up the whole transaction on a fresh DB.
  const existingTables = new Set(
    queryAll<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((r) => r.name)
  )

  let mergedGroups = 0
  let removedRows = 0

  runInTransaction(() => {
    for (const group of dupGroups) {
      const rows = group.map((r) => ({ ...r, hasTranscript: withTranscript.has(r.id) }))
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
      for (const loser of group) {
        if (loser.id === keeper.id) continue
        mergeContacts(keeper.id, loser.id)
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

/** Full reconciliation pass — run after calendar syncs and at startup. */
export function reconcileOrganization(): void {
  try {
    repairEscapedMeetingText()
  } catch (e) {
    console.error('[OrgReconciler] text repair failed:', e)
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
}
