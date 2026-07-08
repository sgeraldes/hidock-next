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
import { queryAll, queryOne, run, runInTransaction } from './database'
import { randomUUID } from 'crypto'

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
  date_recorded: string
  duration_seconds?: number
  file_size?: number
  meeting_id?: string
}

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
  const recordings = queryAll<RecordingRow>(
    `SELECT id, date_recorded, duration_seconds, file_size, meeting_id
     FROM recordings
     WHERE meeting_id IS NULL AND date_recorded IS NOT NULL`
  )
  if (recordings.length === 0) return 0

  const meetings = queryAll<MeetingRow>(
    `SELECT id, subject, start_time, end_time FROM meetings`
  )
  if (meetings.length === 0) return 0

  const meetingWindows = meetings
    .map((m) => ({
      id: m.id,
      start: new Date(m.start_time).getTime(),
      end: new Date(m.end_time).getTime()
    }))
    .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end))

  let linked = 0
  for (const rec of recordings) {
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

    if (best) {
      run(
        `UPDATE recordings SET meeting_id = ?, correlation_confidence = 0.7, correlation_method = 'time_overlap'
         WHERE id = ? AND meeting_id IS NULL`,
        [best.id, rec.id]
      )
      linked++
    }
  }

  if (linked > 0) console.log(`[OrgReconciler] Auto-linked ${linked} recordings to meetings by time overlap`)
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
  if (repaired > 0) console.log(`[OrgReconciler] Unescaped ICS text on ${repaired} meetings`)
  return repaired
}

/** Full reconciliation pass — run after calendar syncs and at startup. */
export function reconcileOrganization(): void {
  try {
    repairEscapedMeetingText()
  } catch (e) {
    console.error('[OrgReconciler] text repair failed:', e)
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
}
