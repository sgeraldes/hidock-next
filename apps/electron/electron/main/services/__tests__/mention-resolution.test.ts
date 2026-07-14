/**
 * Ambiguous mention buckets + per-recording resolution — integration.
 *
 * Exercises the real database.ts (real sql.js engine) end to end: a bare first name
 * ("Sergio") linked to recordings of two different people is detected as a bucket,
 * getBucketResolution surfaces the per-recording best guess, resolveMention pins a
 * mention to a real person, and autoSplitAmbiguousBuckets auto-resolves the
 * unambiguous recordings.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-mention-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  getAmbiguousBuckets,
  getBucketResolution,
  getMentionResolution,
  resolveMention
} from '../database'
import { autoSplitAmbiguousBuckets } from '../org-reconciler'

function contact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count)
     VALUES (?, ?, 'unknown', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)`,
    [id, name]
  )
}
function meeting(id: string): void {
  run(
    `INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`,
    [id, `Meeting ${id}`]
  )
}
function recording(id: string, meetingId: string): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, status, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', 'complete', ?)`,
    [id, `${id}.wav`, meetingId]
  )
}
function attend(meetingId: string, contactId: string): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, 'attendee')`, [meetingId, contactId])
}

describe('ambiguous mention buckets', () => {
  beforeAll(async () => {
    await initializeDatabase()

    // Two real Sergios + a bare "Sergio" bucket linked to three meetings.
    contact('c-sh', 'Sergio Hurtado')
    contact('c-sr', 'Sergio Reyes')
    contact('c-bucket', 'Sergio')

    // m1: only Hurtado attends → decidable to c-sh.
    meeting('m1'); recording('r1', 'm1'); attend('m1', 'c-bucket'); attend('m1', 'c-sh')
    // m2: only Reyes attends → decidable to c-sr.
    meeting('m2'); recording('r2', 'm2'); attend('m2', 'c-bucket'); attend('m2', 'c-sr')
    // m3: both attend → ambiguous, left for the user.
    meeting('m3'); recording('r3', 'm3'); attend('m3', 'c-bucket'); attend('m3', 'c-sh'); attend('m3', 'c-sr')
  })

  afterAll(() => {
    closeDatabase()
    if (existsSync(dbPath)) unlinkSync(dbPath)
  })

  it('detects the bare-first-name bucket with its real candidates', () => {
    const buckets = getAmbiguousBuckets()
    const sergio = buckets.find((b) => b.contactId === 'c-bucket')
    expect(sergio).toBeTruthy()
    expect(sergio!.candidates.map((c) => c.id).sort()).toEqual(['c-sh', 'c-sr'])
    expect(sergio!.recordingCount).toBe(3)
    expect(sergio!.pendingCount).toBe(3)
  })

  it('surfaces a per-recording best guess from attendee context', () => {
    const res = getBucketResolution('c-bucket')!
    expect(res).toBeTruthy()
    const byRec = Object.fromEntries(res.recordings.map((r) => [r.recordingId, r]))
    expect(byRec['r1'].bestGuessId).toBe('c-sh')
    expect(byRec['r1'].method).toBe('attendee-context')
    expect(byRec['r2'].bestGuessId).toBe('c-sr')
    expect(byRec['r3'].method).toBe('unclear') // both attended
  })

  it('resolveMention pins a mention and links the real person to the meeting', () => {
    resolveMention('r3', 'Sergio', 'c-sh', 'manual', 1.0)
    const decision = getMentionResolution('r3', 'Sergio')
    expect(decision).toEqual({ decided: true, contactId: 'c-sh' })
    const link = queryOne<{ contact_id: string }>(
      `SELECT contact_id FROM meeting_contacts WHERE meeting_id = 'm3' AND contact_id = 'c-sh'`
    )
    expect(link?.contact_id).toBe('c-sh')
  })

  it('auto-splits the unambiguous recordings and leaves ties alone', () => {
    const result = autoSplitAmbiguousBuckets()
    expect(result.resolved).toBeGreaterThanOrEqual(2) // r1 → Hurtado, r2 → Reyes
    expect(getMentionResolution('r1', 'Sergio')).toEqual({ decided: true, contactId: 'c-sh' })
    expect(getMentionResolution('r2', 'Sergio')).toEqual({ decided: true, contactId: 'c-sr' })

    // Re-running is idempotent — nothing new to resolve.
    expect(autoSplitAmbiguousBuckets().resolved).toBe(0)
  })

  it('a fully-resolved bucket reports zero pending', () => {
    const buckets = getAmbiguousBuckets()
    const sergio = buckets.find((b) => b.contactId === 'c-bucket')!
    expect(sergio.resolvedCount).toBe(3)
    expect(sergio.pendingCount).toBe(0)
  })

  it('never overwrites the manual r3 decision on re-sweep', () => {
    autoSplitAmbiguousBuckets()
    expect(getMentionResolution('r3', 'Sergio')).toEqual({ decided: true, contactId: 'c-sh' })
    const r3 = getBucketResolution('c-bucket')!.recordings.find((r) => r.recordingId === 'r3')!
    expect(r3.resolvedMethod).toBe('manual')
  })

  it('upgrades a transcript-attendee guess to attendee-email when calendar attendees arrive', () => {
    // Before: r1 was resolved via transcript co-presence (attendee-context).
    const before = getBucketResolution('c-bucket')!.recordings.find((r) => r.recordingId === 'r1')!
    expect(before.resolvedMethod).toBe('attendee-context')

    // M365 backfills real calendar attendees on m1 → the signal is now calendar-backed.
    run(`UPDATE meetings SET organizer_email = 'sergio.hurtado@acme.com' WHERE id = 'm1'`)
    const result = autoSplitAmbiguousBuckets()
    expect(result.resolved).toBeGreaterThanOrEqual(1)

    const after = getBucketResolution('c-bucket')!.recordings.find((r) => r.recordingId === 'r1')!
    expect(after.meetingHasCalendarAttendees).toBe(true)
    expect(after.resolvedMethod).toBe('attendee-email') // upgraded
    expect(after.resolvedContactId).toBe('c-sh') // same person, stronger signal
  })
})
